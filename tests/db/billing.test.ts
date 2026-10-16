import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0062: Walkup's own subscription billing. RLS on every table,
 * service-role-only webhook functions, platform-admin-only comps, and the
 * launch backfill that comps every existing association.
 */

const DOUG = "dddd0000-0000-0000-0000-0000000000ff";
const T = (iso: string) => new Date(iso).toISOString();

async function addPlatformAdmin(db: PGlite) {
  await db.query(`insert into auth.users (id, email) values ($1, 'doug@example.test')`, [DOUG]);
  await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Doug')`, [DOUG]);
}

describe("billing (0062): backfill", () => {
  it("comps every association that existed before the migration, with no trial; a new one gets a trial and no comp", async () => {
    const db = await freshDb({ before: "0062" });
    const f = await seed(db);
    await applyMigrations(db, { from: "0062" });

    const accounts = await db.query<{ association_id: string; trial_ends_at: string | null }>(
      `select association_id, trial_ends_at from public.billing_accounts order by 1`,
    );
    expect(accounts.rows.map((r) => r.association_id).sort()).toEqual([f.damen, f.hoyne].sort());
    expect(accounts.rows.every((r) => r.trial_ends_at === null)).toBe(true);
    const comps = await db.query<{ association_id: string; kind: string }>(
      `select association_id, kind from public.billing_comps where revoked_at is null order by 1`,
    );
    expect(comps.rows).toEqual([
      { association_id: f.damen, kind: "early_access" },
      { association_id: f.hoyne, kind: "early_access" },
    ].sort((a, b) => a.association_id.localeCompare(b.association_id)));

    await db.query(
      `insert into public.associations (id, legal_name, display_name, state_code) values ('33333333-3333-3333-3333-333333333333', 'New HOA', 'New', 'IL')`,
    );
    const fresh = await db.query<{ days: number }>(
      `select extract(day from trial_ends_at - now())::int as days from public.billing_accounts where association_id = '33333333-3333-3333-3333-333333333333'`,
    );
    expect(fresh.rows[0].days).toBeGreaterThanOrEqual(29);
    const freshComps = await db.query(`select 1 from public.billing_comps where association_id = '33333333-3333-3333-3333-333333333333'`);
    expect(freshComps.rows).toHaveLength(0);
    await db.close();
  });
});

describe("billing (0062): access and functions", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    // Bo is also a board member (not admin) for these tests.
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1, $2, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );
    await addPlatformAdmin(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("lets the board read its own billing row, and nobody else read any billing table", async () => {
    const read = (user: string) =>
      asUser(db, user, async () => (await db.query<{ association_id: string }>(`select association_id from public.billing_accounts`)).rows.map((r) => r.association_id));
    expect(await read(f.cyUser)).toEqual([f.damen]); // board admin
    expect(await read(f.boUser)).toEqual([f.damen]); // board member
    expect(await read(f.adaUser)).toEqual([]); // owner
    expect(await read(f.niaUser)).toEqual([]); // accountant
    expect(await read(f.zaraUser)).toEqual([]); // owner elsewhere

    await db.query(`insert into public.billing_comps (association_id, kind, reason) values ($1, 'friend', 'secret note')`, [f.damen]);
    for (const user of [f.cyUser, f.boUser, f.adaUser, DOUG]) {
      const comps = await asUser(db, user, () => db.query(`select * from public.billing_comps`)).catch(() => ({ rows: [] }));
      expect(comps.rows, user).toHaveLength(0);
      const events = await asUser(db, user, () => db.query(`select * from public.billing_webhook_events`)).catch(() => ({ rows: [] }));
      expect(events.rows, user).toHaveLength(0);
    }
  });

  it("refuses direct writes to billing tables from signed-in users", async () => {
    await expect(
      asUser(db, f.cyUser, () => db.query(`update public.billing_accounts set subscription_status = 'active'`)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, f.cyUser, () => db.query(`insert into public.billing_comps (association_id, kind, reason) values ($1, 'other', 'me')`, [f.damen])),
    ).rejects.toThrow(/permission denied/);
  });

  it("billing_status returns facts to the board only, never the comp reason", async () => {
    await db.query(`insert into public.billing_comps (association_id, kind, reason, expires_on) values ($1, 'friend', 'secret note', '2099-01-01')`, [f.damen]);
    const status = (user: string) =>
      asUser(db, user, async () => (await db.query<Record<string, unknown>>(`select * from public.billing_status($1)`, [f.damen])).rows);
    const [row] = await status(f.cyUser);
    expect(row.comp_active).toBe(true);
    expect(row.comp_kind).toBe("friend");
    expect(row.unit_count).toBe(3);
    expect(JSON.stringify(row)).not.toContain("secret note");
    expect(await status(f.boUser)).toHaveLength(1);
    expect(await status(f.adaUser)).toHaveLength(0);
    expect(await status(f.niaUser)).toHaveLength(0);
  });

  it("only a platform admin at AAL2 can grant, end and extend; history is kept", async () => {
    const grant = (user: string, aal: "aal1" | "aal2" = "aal2") =>
      asUser(db, user, () => db.query(`select public.billing_grant_comp($1, 'pilot', 'Pilot building', null)`, [f.damen]), { aal });
    await expect(grant(f.cyUser)).rejects.toThrow(/platform admin/);
    await grant(DOUG);
    await asUser(db, DOUG, () => db.query(`select public.billing_grant_comp($1, 'friend', 'Friend of Doug', '2099-12-31')`, [f.damen]));
    const all = await db.query<{ kind: string; revoked: boolean }>(
      `select kind, revoked_at is not null as revoked from public.billing_comps where association_id = $1 order by granted_at, revoked_at nulls last`,
      [f.damen],
    );
    expect(all.rows).toEqual([{ kind: "pilot", revoked: true }, { kind: "friend", revoked: false }]);
    await expect(
      asUser(db, DOUG, () => db.query(`select public.billing_grant_comp($1, 'friend', '   ', null)`, [f.damen])),
    ).rejects.toThrow(/reason is required/);

    await expect(asUser(db, f.cyUser, () => db.query(`select public.billing_revoke_comp($1)`, [f.damen]))).rejects.toThrow(/platform admin/);
    await asUser(db, DOUG, () => db.query(`select public.billing_revoke_comp($1)`, [f.damen]));
    const active = await db.query(`select 1 from public.billing_comps where association_id = $1 and revoked_at is null`, [f.damen]);
    expect(active.rows).toHaveLength(0);

    await expect(
      asUser(db, f.cyUser, () => db.query(`select public.billing_extend_trial($1, current_date + 60)`, [f.damen])),
    ).rejects.toThrow(/platform admin/);
    await asUser(db, DOUG, () => db.query(`select public.billing_extend_trial($1, current_date + 60)`, [f.damen]));
    const trial = await db.query<{ days: number }>(`select extract(day from trial_ends_at - now())::int as days from public.billing_accounts where association_id = $1`, [f.damen]);
    expect(trial.rows[0].days).toBeGreaterThanOrEqual(59);

    await expect(asUser(db, f.cyUser, () => db.query(`select * from public.billing_admin_overview()`))).rejects.toThrow(/platform admin/);
    const overview = await asUser(db, DOUG, () => db.query<{ association_id: string; past_comps: number }>(`select * from public.billing_admin_overview()`));
    expect(overview.rows.map((r) => r.association_id).sort()).toEqual([f.damen, f.hoyne].sort());
  });

  it("platform admin functions refuse a session that has not finished two-step sign-in", async () => {
    // Only where 0025's session_is_aal2() exists, as it does under PGlite.
    await expect(
      asUser(db, DOUG, () => db.query(`select public.billing_grant_comp($1, 'pilot', 'x', null)`, [f.damen]), { aal: "aal1" }),
    ).rejects.toThrow(/platform admin/);
  });

  it("keeps the webhook functions to the service role", async () => {
    const calls = [
      `select public.billing_claim_event('evt_1', 'x', now())`,
      `select public.billing_finish_event('evt_1', 'applied', null)`,
      `select public.billing_link_checkout('${f.damen}', 'cus_1', 'sub_1', null, now())`,
      `select public.billing_record_payment('cus_1', true, now())`,
    ];
    for (const sql of calls) {
      await expect(asUser(db, f.cyUser, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
      await expect(asUser(db, DOUG, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    // apply is executable by authenticated but refuses anyone but a platform admin.
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(`select public.billing_apply_subscription('sub_1', 'cus_1', $1, 'active', 'starter', 'price_1', 'month', now(), false, now())`, [f.damen]),
      ),
    ).rejects.toThrow(/platform admin/);
  });

  it("claims an event once, lets a failed one be claimed again", async () => {
    const claim = () => asService(db, async () => (await db.query<{ ok: boolean }>(`select public.billing_claim_event('evt_A', 'invoice.paid', now()) as ok`)).rows[0].ok);
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await asService(db, () => db.query(`select public.billing_finish_event('evt_A', 'applied', $1)`, [f.damen]));
    expect(await claim()).toBe(false);
    await asService(db, () => db.query(`select public.billing_finish_event('evt_A', 'failed', null)`));
    expect(await claim()).toBe(true);
  });

  it("links checkout, applies subscriptions in any order, ignores stale events, records payments", async () => {
    const svc = <R,>(sql: string, params: unknown[] = []) => asService(db, async () => (await db.query<{ r: R }>(sql, params)).rows[0].r);
    const apply = (status: string, created: string, assoc: string | null = f.damen) =>
      svc<string>(
        `select public.billing_apply_subscription('sub_A', 'cus_A', $1, $2, 'starter', 'price_s', 'month', '2026-12-01', false, $3) as r`,
        [assoc, status, created],
      );

    // subscription.created before checkout.session.completed: found by metadata.
    expect(await apply("incomplete", T("2026-10-01T00:00:00Z"))).toBe("applied");
    expect(await apply("active", T("2026-10-01T00:01:00Z"))).toBe("applied");
    // An older event arrives late: ignored.
    expect(await apply("incomplete", T("2026-10-01T00:00:30Z"))).toBe("stale");
    expect(
      await svc<string>(`select public.billing_link_checkout($1, 'cus_A', 'sub_A', now(), now()) as r`, [f.damen]),
    ).toBe("applied");
    const row = await db.query<{ subscription_status: string; stripe_customer_id: string; terms: boolean }>(
      `select subscription_status, stripe_customer_id, terms_accepted_at is not null as terms from public.billing_accounts where association_id = $1`,
      [f.damen],
    );
    expect(row.rows[0]).toEqual({ subscription_status: "active", stripe_customer_id: "cus_A", terms: true });

    // The same customer cannot be linked to a second association.
    await expect(svc(`select public.billing_link_checkout($1, 'cus_A', 'sub_B', null, now()) as r`, [f.hoyne])).rejects.toThrow(/another association/);
    // A subscription for an unknown association is not applied anywhere.
    expect(
      await svc<string>(
        `select public.billing_apply_subscription('sub_Z', 'cus_Z', null, 'active', 'starter', 'price_s', 'month', now(), false, now()) as r`,
      ),
    ).toBe("unknown");

    // Payment failure sets once, paid clears.
    expect(await svc<string>(`select public.billing_record_payment('cus_A', false, '2026-10-05') as r`)).toBe("applied");
    expect(await svc<string>(`select public.billing_record_payment('cus_A', false, '2026-10-06') as r`)).toBe("ignored");
    const failed = await db.query<{ d: string }>(`select payment_failed_at::date::text as d from public.billing_accounts where association_id = $1`, [f.damen]);
    expect(failed.rows[0].d).toBe("2026-10-05");
    expect(await svc<string>(`select public.billing_record_payment('cus_A', true, '2026-10-07') as r`)).toBe("applied");
    expect(await svc<string>(`select public.billing_record_payment('cus_nobody', true, now()) as r`)).toBe("unknown");
  });

  it("is SECURITY DEFINER with a pinned search_path everywhere, and never touches the books", async () => {
    const { rows } = await db.query<{ proname: string; prosecdef: boolean; cfg: string[] | null; src: string }>(
      `select proname, prosecdef, proconfig as cfg, prosrc as src from pg_proc where proname like 'billing\\_%'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(11);
    for (const r of rows) {
      expect(r.prosecdef, r.proname).toBe(true);
      expect(r.cfg, r.proname).toEqual(['search_path=""']);
      expect(r.src, r.proname).not.toMatch(/journal_entries|journal_lines|\bpayments\b|bank_|assessment_charges|post_journal_entry|record_expense/);
    }
  });
});
