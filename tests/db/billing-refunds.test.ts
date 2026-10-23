import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0087: a yearly refund request, or the stay offer, inside 14 days of the charge. Board admin only, once at
 * a time, and only Doug (a platform admin) can see all of them and mark one handled.
 */

const DOUG = "dddd0000-0000-0000-0000-0000000000ff";

describe("billing refund requests (0087)", () => {
  let db: PGlite;
  let f: Fixture;

  /** A paid yearly plan whose period began `daysAgo` days ago (the period ends a year after it began). */
  const yearlyPlan = (daysAgo: number) =>
    db.query(
      `update public.billing_accounts
          set subscription_status = 'active', billing_interval = 'year', plan_key = 'starter',
              current_period_end = now() - ($2 || ' days')::interval + interval '1 year'
        where association_id = $1`,
      [f.damen, String(daysAgo)],
    );

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(`insert into auth.users (id, email) values ($1, 'doug@example.test')`, [DOUG]);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Doug')`, [DOUG]);
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1, $2, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  const request = (user: string, kind = "refund", reason: string | null = "Not what we needed") =>
    asUser(db, user, () => db.query<{ id: string }>(`select public.billing_request_refund($1, $2, $3) as id`, [f.damen, kind, reason]));

  it("lets a board admin ask inside the 14 days, and records who, when and for which charge", async () => {
    await yearlyPlan(5);
    const eligible = await asUser(db, f.cyUser, async () => (await db.query<{ eligible: boolean; until: string }>(`select * from public.billing_refund_eligibility($1)`, [f.damen])).rows[0]);
    expect(eligible.eligible).toBe(true);
    await request(f.cyUser);
    const rows = await db.query<{ kind: string; status: string; plan_key: string; requested_by: string }>(`select kind, status, plan_key, requested_by from public.billing_refund_requests`);
    expect(rows.rows).toEqual([{ kind: "refund", status: "open", plan_key: "starter", requested_by: f.cyUser }]);
    const after = await asUser(db, f.cyUser, async () => (await db.query<{ eligible: boolean; open_kind: string }>(`select * from public.billing_refund_eligibility($1)`, [f.damen])).rows[0]);
    expect(after).toMatchObject({ eligible: false, open_kind: "refund" });
  });

  it("refuses everyone but a board admin, a second open request, a monthly plan and a charge older than 14 days", async () => {
    await yearlyPlan(5);
    await expect(request(f.boUser)).rejects.toThrow(/board admin/); // board member
    await expect(request(f.adaUser)).rejects.toThrow(/board admin/); // owner
    await expect(request(f.cyUser, "other")).rejects.toThrow(/refund or the offer/);
    await request(f.cyUser, "offer", null);
    await expect(request(f.cyUser)).rejects.toThrow(/already open/);

    await db.query(`delete from public.billing_refund_requests`);
    await yearlyPlan(15);
    await expect(request(f.cyUser)).rejects.toThrow(/14 days/);
    await db.query(`update public.billing_accounts set billing_interval = 'month', current_period_end = now() + interval '10 days' where association_id = $1`, [f.damen]);
    await expect(request(f.cyUser)).rejects.toThrow(/yearly plans/);
  });

  it("shows a request to its building's board and to Doug only, and lets only Doug mark it handled", async () => {
    await yearlyPlan(2);
    const id = (await request(f.cyUser)).rows[0].id;
    const readTable = (user: string) => asUser(db, user, async () => (await db.query(`select id from public.billing_refund_requests`)).rows.length);
    expect(await readTable(f.cyUser)).toBe(1);
    expect(await readTable(f.adaUser)).toBe(0);
    await expect(asUser(db, f.cyUser, () => db.query(`update public.billing_refund_requests set status = 'done'`))).rejects.toThrow(/permission denied/);

    await expect(asUser(db, f.cyUser, () => db.query(`select * from public.billing_admin_refunds()`))).rejects.toThrow(/platform admin/);
    const all = await asUser(db, DOUG, async () => (await db.query<{ display_name: string; status: string }>(`select display_name, status from public.billing_admin_refunds()`)).rows);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("open");

    await expect(asUser(db, f.cyUser, () => db.query(`select public.billing_resolve_refund($1, 'done')`, [id]))).rejects.toThrow(/platform admin/);
    await asUser(db, DOUG, () => db.query(`select public.billing_resolve_refund($1, 'done')`, [id]));
    const handled = await db.query<{ status: string; handled_by: string }>(`select status, handled_by from public.billing_refund_requests`);
    expect(handled.rows[0]).toEqual({ status: "done", handled_by: DOUG });
    // A building can ask again once the last one is handled.
    await request(f.cyUser, "offer", null);
  });
});
