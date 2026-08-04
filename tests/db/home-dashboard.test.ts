import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY = "f1500000-0000-0000-0000-000000000001";

describe("home dashboard (0017)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("refuses a board task from an owner-only caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `insert into public.board_tasks (association_id, title) values ($1::uuid, 'Call the roofer')`,
          [f.damen],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("lets the board add and complete a task; an owner sees none of it", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into public.board_tasks (association_id, title, detail) values ($1::uuid, 'Get a snow contract', 'Before November')`,
        [f.damen],
      );
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from public.board_tasks`,
      );
      expect(rows[0].n).toBe(1);

      // completed_by arrives as a literal from the client, the way PostgREST
      // sends it — auth.uid() is never written into client-side SQL.
      await db.query(
        `update public.board_tasks set completed_at = now(), completed_by = $1::uuid
          where title = 'Get a snow contract'`,
        [f.cyUser],
      );
      const { rows: done } = await db.query<{ completed: boolean }>(
        `select completed_at is not null as completed from public.board_tasks`,
      );
      expect(done[0].completed).toBe(true);
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select * from public.board_tasks`);
      expect(rows).toHaveLength(0);
    });
  });

  it("lets only board_admin set the reserve target", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(
        `update public.associations set reserve_target = 50000 returning id`,
      );
      expect(rows).toHaveLength(0); // policy filtered every row from the update
    });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query(
        `update public.associations set reserve_target = 50000 returning reserve_target::text`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ reserve_target: "50000.00" });
    });
  });

  it("monthly_cash_activity reflects a recorded payment, as text, and hides from owners", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_payment(
           $1::uuid, $2::uuid, $3::uuid, '2026-01-05'::date, 300,
           $4::uuid, $5::uuid, $6::uuid, 'check', null,
           jsonb_build_array(jsonb_build_object('charge_id', $7::text, 'amount', 300)))`,
        [f.damen, f.unit1, FY, OPERATING, CASH, AR, f.adaCharge],
      );

      const { rows } = await db.query<{
        month: string;
        fund_kind: string;
        inflow: string;
        outflow: string;
        visible_lines: number;
      }>(`select month::text, fund_kind, inflow, outflow, visible_lines
            from public.monthly_cash_activity`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        month: "2026-01-01",
        fund_kind: "operating",
        inflow: "300.00",
        outflow: "0.00",
        visible_lines: 1,
      });
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select * from public.monthly_cash_activity`);
      expect(rows).toHaveLength(0);
    });
  });

  it("monthly_dues_collection buckets by due month and knows late from on-time", async () => {
    await asUser(db, f.cyUser, async () => {
      // Received Jan 5 against a Jan 1 due date: collected, but not on time.
      await db.query(
        `select public.record_payment(
           $1::uuid, $2::uuid, $3::uuid, '2026-01-05'::date, 300,
           $4::uuid, $5::uuid, $6::uuid, null, null,
           jsonb_build_array(jsonb_build_object('charge_id', $7::text, 'amount', 300)))`,
        [f.damen, f.unit1, FY, OPERATING, CASH, AR, f.adaCharge],
      );

      const { rows } = await db.query<{
        month: string;
        charged: string;
        collected: string;
        collected_on_time: string;
        charge_count: number;
      }>(`select month::text, charged, collected, collected_on_time, charge_count
            from public.monthly_dues_collection`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        month: "2026-01-01",
        charged: "1250.00",
        collected: "300.00",
        collected_on_time: "0.00",
        charge_count: 2,
      });
    });
  });

  it("monthly_spending_by_account groups expenses and hides from owners", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into public.accounts
           (association_id, code, name, type, is_cash_account, is_exempt_expenditure)
         values ($1::uuid, '5020', 'Repairs & Maintenance', 'expense', false, true)`,
        [f.damen],
      );
      const { rows: acct } = await db.query<{ id: string }>(
        `select id from public.accounts where code = '5020'`,
      );

      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-02-10'::date, 120.50,
           $3::uuid, $4::uuid, $5::uuid, null, true, false, 'Hallway plaster')`,
        [f.damen, FY, OPERATING, CASH, acct[0].id],
      );

      const { rows } = await db.query<{
        month: string;
        account_name: string;
        total: string;
        expense_count: number;
      }>(`select month::text, account_name, total, expense_count
            from public.monthly_spending_by_account`);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        month: "2026-02-01",
        account_name: "Repairs & Maintenance",
        total: "120.50",
        expense_count: 1,
      });
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select * from public.monthly_spending_by_account`);
      expect(rows).toHaveLength(0);
    });
  });
});
