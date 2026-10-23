import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0084: the notices the Terms promise (DECISIONS #44). The notice periods are enforced where the dates
 * are set, notices are made once, and only the building's board can read them.
 */

const DOUG = "dddd0000-0000-0000-0000-0000000000ff";

describe("billing notices (0084)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(`insert into auth.users (id, email) values ($1, 'doug@example.test')`, [DOUG]);
    await db.query(`insert into public.platform_admins (user_id, note) values ($1, 'Doug')`, [DOUG]);
  });
  afterEach(async () => {
    await db.close();
  });

  const asDoug = <T,>(fn: () => Promise<T>) => asUser(db, DOUG, fn);

  /** A building on early access with no end date, as every launch-day building is. */
  const onEarlyAccess = (assoc: string) =>
    asDoug(() => db.query(`select public.billing_grant_comp($1, 'early_access', 'Joined during early access', null)`, [assoc]));

  it("makes early access end no sooner than 90 days out, and a founding comp at least 30", async () => {
    await expect(
      asDoug(() => db.query(`select public.billing_end_early_access($1, current_date + 90)`, [f.damen])),
    ).rejects.toThrow(/no early-access comp/);
    await onEarlyAccess(f.damen);
    await expect(
      asDoug(() => db.query(`select public.billing_end_early_access($1, current_date + 89)`, [f.damen])),
    ).rejects.toThrow(/at least 90 days/);
    await asDoug(() => db.query(`select public.billing_end_early_access($1, current_date + 90)`, [f.damen]));
    const comp = await db.query<{ days: number }>(
      `select (expires_on - current_date)::int as days from public.billing_comps where association_id = $1 and revoked_at is null`,
      [f.damen],
    );
    expect(comp.rows[0].days).toBe(90);

    await expect(
      asDoug(() => db.query(`select public.billing_grant_comp($1, 'early_access', 'Soon', current_date + 30)`, [f.damen])),
    ).rejects.toThrow(/at least 90 days/);
    await expect(
      asDoug(() => db.query(`select public.billing_grant_comp($1, 'founding', 'Founding offer', current_date + 10)`, [f.damen])),
    ).rejects.toThrow(/at least 30 days/);
    await expect(
      asDoug(() => db.query(`select public.billing_grant_comp($1, 'founding', 'Founding offer', null)`, [f.damen])),
    ).rejects.toThrow(/at least 30 days/);
    await asDoug(() => db.query(`select public.billing_grant_comp($1, 'founding', 'Founding offer', current_date + 365)`, [f.damen]));
  });

  it("lets only a platform admin schedule a price change, at least 30 days ahead, one notice per building", async () => {
    await expect(
      asUser(db, f.cyUser, () => db.query(`select public.billing_schedule_price_change(current_date + 60, 'Starter goes to $21')`)),
    ).rejects.toThrow(/platform admin/);
    await expect(
      asDoug(() => db.query(`select public.billing_schedule_price_change(current_date + 29, 'Too soon')`)),
    ).rejects.toThrow(/at least 30 days/);
    await expect(
      asDoug(() => db.query(`select public.billing_schedule_price_change(current_date + 60, '   ')`)),
    ).rejects.toThrow(/Say what is changing/);
    const first = await asDoug(() => db.query<{ n: number }>(`select public.billing_schedule_price_change(current_date + 60, 'Starter goes to $21') as n`));
    expect(first.rows[0].n).toBe(2); // damen and hoyne
    const again = await asDoug(() => db.query<{ n: number }>(`select public.billing_schedule_price_change(current_date + 60, 'Starter goes to $21') as n`));
    expect(again.rows[0].n).toBe(0);
  });

  it("turns comp end dates into notices once, and never for a comp with no end date", async () => {
    await onEarlyAccess(f.damen);
    await asDoug(() => db.query(`select public.billing_end_early_access($1, current_date + 120)`, [f.damen]));
    const run = () => asService(db, async () => (await db.query<{ n: number }>(`select public.billing_generate_comp_notices(current_date) as n`)).rows[0].n);
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    const n = await db.query<{ kind: string; association_id: string }>(`select kind, association_id from public.billing_notices`);
    expect(n.rows).toEqual([{ kind: "early_access_end", association_id: f.damen }]);

    await asDoug(() => db.query(`select public.billing_grant_comp($1, 'founding', 'Founding offer', current_date + 365)`, [f.hoyne]));
    expect(await run()).toBe(1);
    const kinds = await db.query<{ kind: string }>(`select kind from public.billing_notices order by kind`);
    expect(kinds.rows.map((r) => r.kind)).toEqual(["early_access_end", "founding_charge"]);
  });

  it("shows a notice to its building's board only", async () => {
    await asDoug(() => db.query(`select public.billing_schedule_price_change(current_date + 45, 'Prices change')`));
    const read = (user: string, assoc: string) =>
      asUser(db, user, async () => (await db.query<{ kind: string }>(`select kind from public.billing_notices_for($1)`, [assoc])).rows.map((r) => r.kind));
    expect(await read(f.cyUser, f.damen)).toEqual(["price_change"]);
    expect(await read(f.adaUser, f.damen)).toEqual([]); // owner
    expect(await read(f.niaUser, f.damen)).toEqual([]); // accountant
    expect(await read(f.cyUser, f.hoyne)).toEqual([]); // another building
    const direct = await asUser(db, f.adaUser, () => db.query(`select * from public.billing_notices`));
    expect(direct.rows).toHaveLength(0);
    await expect(asUser(db, f.cyUser, () => db.query(`update public.billing_notices set effective_on = current_date`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, f.cyUser, () => db.query(`select * from public.billing_notice_deliveries`))).rejects.toThrow(/permission denied/);
  });

  it("emails each active board admin once, retries a failure up to three times, and records the first send", async () => {
    await asDoug(() => db.query(`select public.billing_schedule_price_change(current_date + 45, 'Prices change')`));
    const claim = () => asService(db, async () => (await db.query<{ delivery_id: string; to_email: string; attempts: number }>(`select * from public.billing_notice_claim(10)`)).rows);

    const first = await claim();
    expect(first.map((r) => r.to_email)).toEqual(["cy@example.test"]); // damen's only board admin; hoyne has none with an address
    expect(first[0].attempts).toBe(1);
    // A claimed delivery is not handed out again within ten minutes.
    expect(await claim()).toHaveLength(0);

    await db.query(`update public.billing_notice_deliveries set last_attempt_at = now() - interval '11 minutes'`);
    const mark = (ok: boolean) =>
      asService(db, () => db.query(`select public.billing_notice_mark($1, $2, $3)`, [first[0].delivery_id, ok, ok ? null : "Resend said no"]));
    await mark(false);
    const retry = await claim();
    expect(retry).toHaveLength(1);
    expect(retry[0].attempts).toBe(2);

    await mark(true);
    const notice = await db.query<{ emailed_at: string | null }>(`select emailed_at from public.billing_notices where association_id = $1`, [f.damen]);
    expect(notice.rows[0].emailed_at).not.toBeNull();
    await db.query(`update public.billing_notice_deliveries set last_attempt_at = now() - interval '11 minutes'`);
    expect(await claim()).toHaveLength(0);
  });

  it("keeps the service functions away from signed-in users", async () => {
    for (const call of [
      `select public.billing_generate_comp_notices(current_date)`,
      `select * from public.billing_notice_candidates()`,
      `select * from public.billing_notice_claim(5)`,
    ]) {
      await expect(asUser(db, f.cyUser, () => db.query(call)), call).rejects.toThrow(/permission denied/);
    }
  });

  it("opens a read-only notice once per lapse and refuses a malformed key", async () => {
    const open = (key: string) =>
      asService(db, async () => (await db.query<{ ok: boolean }>(`select public.billing_open_read_only_notice($1, current_date + 7, $2) as ok`, [f.damen, key])).rows[0].ok);
    const key = `read_only:${f.damen}:2026-10-01`;
    expect(await open(key)).toBe(true);
    expect(await open(key)).toBe(false);
    await expect(open("read_only:oops")).rejects.toThrow(/bad notice key/);
  });
});
