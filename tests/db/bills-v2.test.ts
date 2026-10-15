import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { Fixture } from "./fixtures";
import { BILL_CASES } from "../fixtures/bill-cases";
import { EXTRA, addExpenses, chicagoToday, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * Migration 0053 bills v2 (repairs-spec §3.8, tests §17.2 `bills-v2`, and
 * insurance-spec R-2): pause, payments, mark paid once per period, and the
 * premium bill that advances by its policy's own schedule.
 */
describe("bills v2 (0053)", () => {
  let db: PGlite;
  let f: Fixture;
  let bill: string;
  let today: string;
  const { q, one, rows, count } = queries(() => db);

  beforeEach(async () => {
    ({ db, f } = await seededDb());
    bill = (await one<{ id: string }>(null, `select id from public.recurring_bills where name = 'Gas'`)).id;
    await q(null, `update public.recurring_bills set due_day = 31, next_due_on = '2026-01-31' where id = $1::uuid`, [bill]);
    today = await chicagoToday(db);
  });
  afterEach(async () => {
    await db.close();
  });

  const pay = (user: string, dueOn: string | null, paidOn: string, billId = bill, amount: string | null = "98.40") =>
    q<{ payment_id: string; bill_next_due_on: string | null }>(
      user,
      `select payment_id, bill_next_due_on::text from public.mark_bill_paid($1::uuid, $2::date, $3::date, $4::numeric, ' Paid online ')`,
      [billId, dueOn, paidOn, amount],
    );
  const billRow = (id = bill) =>
    one<{ next: string | null; last_paid: string | null; is_active: boolean; paused_at: string | null }>(
      null,
      `select next_due_on::text as next, last_paid_on::text as last_paid, is_active, paused_at from public.recurring_bills where id = $1::uuid`,
      [id],
    );

  it("1. bill_next_due matches the shared case table", async () => {
    for (const c of BILL_CASES) {
      const r = await one<{ d: string }>(null, `select public.bill_next_due($1::date, $2::public.bill_frequency, $3::smallint)::text as d`, [
        c.from,
        c.frequency,
        c.dueDay,
      ]);
      expect(r.d, `${c.from} ${c.frequency} day ${c.dueDay}`).toBe(c.expected);
    }
  });

  it("1b. a bill left without a due day keeps the day of its first due date (REVIEW-4 #14: no drift to the 28th)", async () => {
    const id = (await one<{ id: string }>(null,
      `insert into public.recurring_bills (association_id, name, account_id, fund_id, frequency, typical_amount, next_due_on)
       values ($1::uuid, 'Water', 'acc00000-0000-0000-0000-000000001000', 'ffff0000-0000-0000-0000-000000000001', 'monthly', 80, '2026-01-31') returning id`,
      [f.damen])).id;
    expect((await one<{ due_day: number }>(null, `select due_day from public.recurring_bills where id = $1::uuid`, [id])).due_day).toBe(31);
    const seen: string[] = [];
    let due = "2026-01-31";
    for (let i = 0; i < 4; i++) {
      due = (await pay(f.cyUser, due, due, id)).rows[0].bill_next_due_on as string;
      seen.push(due);
    }
    expect(seen).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("2. mark_bill_paid records a payment, advances next due by the frequency onto due_day, and sets last_paid_on", async () => {
    const r = (await pay(f.cyUser, "2026-01-31", "2026-02-02")).rows[0];
    expect(r.bill_next_due_on).toBe("2026-02-28");
    expect(await billRow()).toMatchObject({ next: "2026-02-28", last_paid: "2026-02-02" });
    const p = await one<{ due_on: string; paid_on: string; amount: string; note: string; created_by: string }>(
      null,
      `select due_on::text, paid_on::text, amount::text, note, created_by from public.recurring_bill_payments where id = $1::uuid`,
      [r.payment_id],
    );
    expect(p).toEqual({ due_on: "2026-01-31", paid_on: "2026-02-02", amount: "98.40", note: "Paid online", created_by: f.cyUser });
    // The next period, then an earlier paid date: last_paid_on keeps the latest.
    expect((await pay(f.cyUser, "2026-02-28", "2026-01-30")).rows[0].bill_next_due_on).toBe("2026-03-31");
    expect(await billRow()).toMatchObject({ next: "2026-03-31", last_paid: "2026-02-02" });
  });

  it("3. mark_bill_paid refuses owners and accountants; the accountant can read payments", async () => {
    expect((await pgError(pay(f.adaUser, "2026-01-31", "2026-02-02"))).code).toBe("42501");
    expect((await pgError(pay(f.niaUser, "2026-01-31", "2026-02-02"))).code).toBe("42501");
    expect((await pgError(pay(f.zaraUser, "2026-01-31", "2026-02-02"))).code).toBe("42501");
    await pay(f.cyUser, "2026-01-31", "2026-02-02");
    expect(await rows(f.niaUser, `select id from public.recurring_bill_payments`)).toHaveLength(1);
    expect(await rows(f.adaUser, `select id from public.recurring_bill_payments`)).toEqual([]);
    await expect(
      q(f.niaUser, `insert into public.recurring_bill_payments (association_id, bill_id, paid_on) values ($1::uuid, $2::uuid, '2026-02-02')`, [f.damen, bill]),
    ).rejects.toThrow(/row-level security/);
  });

  it("4. bill payments refuse another association's bill", async () => {
    await addExpenses(db, f);
    const hoyneBill = await one<{ id: string }>(
      null,
      `insert into public.recurring_bills (association_id, name, account_id, fund_id) values ($1::uuid, 'Hoyne water', $2::uuid, $3::uuid) returning id`,
      [f.hoyne, EXTRA.hoyneAccount, EXTRA.hoyneFund],
    );
    const e = await pgError(
      q(f.cyUser, `insert into public.recurring_bill_payments (association_id, bill_id, paid_on) values ($1::uuid, $2::uuid, '2026-02-02')`, [f.damen, hoyneBill.id]),
    );
    expect(e.code).toBe("42501");
  });

  it("5. pausing keeps the bill readable with paused_at set", async () => {
    await q(f.cyUser, `update public.recurring_bills set paused_at = now(), paused_note = 'Seasonal contract' where id = $1::uuid`, [bill]);
    const r = await one<{ paused: boolean; paused_note: string; touched: boolean }>(
      f.niaUser,
      `select paused_at is not null as paused, paused_note, updated_at > now() - interval '1 minute' as touched from public.recurring_bills where id = $1::uuid`,
      [bill],
    );
    expect(r).toEqual({ paused: true, paused_note: "Seasonal contract", touched: true });
  });

  it("6. mark_bill_paid is once per period", async () => {
    await pay(f.cyUser, "2026-01-31", "2026-02-02");
    const again = await pgError(pay(f.cyUser, "2026-01-31", "2026-02-02"));
    expect(again.code).toBe("23505");
    expect(again.message).toMatch(/already marked paid/);
    expect(await billRow()).toMatchObject({ next: "2026-02-28" });
    expect(await count(`select 1 from public.recurring_bill_payments`)).toBe(1);

    expect((await pgError(pay(f.cyUser, "2026-02-28", "1999-12-31"))).code).toBe("22023");
    expect((await pgError(pay(f.cyUser, "2026-02-28", "2099-01-01"))).code).toBe("22023");
    expect((await pgError(pay(f.cyUser, "2026-02-28", today, bill, "-5"))).code).toBe("22023");

    await q(f.cyUser, `update public.recurring_bills set paused_at = now() where id = $1::uuid`, [bill]);
    expect((await pgError(pay(f.cyUser, "2026-02-28", today))).code).toBe("22023");
    await q(f.cyUser, `update public.recurring_bills set paused_at = null, is_active = false where id = $1::uuid`, [bill]);
    expect((await pgError(pay(f.cyUser, "2026-02-28", today))).code).toBe("22023");

    // The unique index is the backstop for a direct insert.
    expect(
      (await pgError(
        q(f.cyUser, `insert into public.recurring_bill_payments (association_id, bill_id, paid_on, due_on) values ($1::uuid, $2::uuid, $3::date, '2026-01-31')`, [
          f.damen,
          bill,
          today,
        ]),
      )).code,
    ).toBe("23505");
  });

  it("6b. a bill with no next due date covers the day it was paid", async () => {
    await q(null, `update public.recurring_bills set next_due_on = null where id = $1::uuid`, [bill]);
    // One month on, landing on due_day 31 (clamped to April's last day).
    expect((await pay(f.cyUser, null, "2026-03-05")).rows[0].bill_next_due_on).toBe("2026-04-30");
  });

  it("7. who recorded a payment is the caller", async () => {
    const r = await one<{ created_by: string }>(
      f.cyUser,
      `insert into public.recurring_bill_payments (association_id, bill_id, paid_on, created_by) values ($1::uuid, $2::uuid, '2026-02-02', $3::uuid) returning created_by`,
      [f.damen, bill, f.boUser],
    );
    expect(r.created_by).toBe(f.cyUser);
    expect(await count(`select 1 from public.audit_log where table_name = 'recurring_bill_payments'`)).toBe(1);
  });

  describe("a bill that tracks an insurance premium (insurance-spec R-2)", () => {
    const POLICY = "ab000000-0000-0000-0000-0000000000a1";
    const SUCCESSOR = "ab000000-0000-0000-0000-0000000000a2";

    beforeEach(async () => {
      await q(
        null,
        `insert into public.insurance_policies (id, association_id, coverage, carrier_name, effective_from, effective_to, annual_premium, payment_schedule)
         values ($1::uuid, $2::uuid, 'property', 'Lakeside Mutual', '2026-03-01', '2027-03-01', 4000.00, 'quarterly')`,
        [POLICY, f.damen],
      );
      // Monthly on the bill, so the generic step (2026-07-01) and the policy's
      // quarterly schedule (2026-09-01) give different answers.
      await q(null, `update public.recurring_bills set insurance_policy_id = $2::uuid, frequency = 'monthly', due_day = null, next_due_on = '2026-06-01' where id = $1::uuid`, [
        bill,
        POLICY,
      ]);
    });

    it("advances by the policy's own installments, not the bill's frequency", async () => {
      const r = (await pay(f.cyUser, "2026-06-01", today)).rows[0];
      expect(r.bill_next_due_on).toBe("2026-09-01");
      expect(await billRow()).toMatchObject({ next: "2026-09-01", last_paid: today, is_active: true });
    });

    it("retires once the renewal's bill has taken over, and reports no next date", async () => {
      await q(
        null,
        `insert into public.insurance_policies (id, association_id, coverage, carrier_name, effective_from, effective_to, annual_premium, payment_schedule)
         values ($1::uuid, $2::uuid, 'property', 'Lakeside Mutual', '2027-03-01', '2028-03-01', 4200.00, 'quarterly')`,
        [SUCCESSOR, f.damen],
      );
      await q(null, `update public.insurance_policies set replaced_by_policy_id = $2::uuid, replaced_at = now() where id = $1::uuid`, [POLICY, SUCCESSOR]);
      await q(null, `update public.recurring_bills set next_due_on = '2026-12-01' where id = $1::uuid`, [bill]);
      const r = (await pay(f.cyUser, "2026-12-01", today)).rows[0];
      expect(r.bill_next_due_on).toBeNull();
      expect(await billRow()).toMatchObject({ is_active: false, last_paid: today });
      expect(await count(`select 1 from public.recurring_bill_payments where bill_id = $1::uuid and due_on = '2026-12-01'`, [bill])).toBe(1);
    });
  });
});
