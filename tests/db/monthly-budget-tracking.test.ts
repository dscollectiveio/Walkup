import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FISCAL_YEAR = "f1500000-0000-0000-0000-000000000001";
const REPAIRS = "acc00000-0000-0000-0000-000000005020";

describe("monthly_expense_actuals (0028)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);

    await db.exec(`
      insert into accounts (id, association_id, code, name, type, is_exempt_expenditure)
      values ('${REPAIRS}', '${f.damen}', '5020', 'Repairs', 'expense', true)
      on conflict do nothing;
    `);
  });
  afterEach(async () => {
    await db.close();
  });

  it("sums expenses by account and calendar month, keyed by account_id and fund_id", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-01-15'::date, 100, $3::uuid, $4::uuid, $5::uuid)`,
        [f.damen, FISCAL_YEAR, OPERATING, CASH, REPAIRS],
      );
      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-01-28'::date, 50, $3::uuid, $4::uuid, $5::uuid)`,
        [f.damen, FISCAL_YEAR, OPERATING, CASH, REPAIRS],
      );
      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-02-05'::date, 30, $3::uuid, $4::uuid, $5::uuid)`,
        [f.damen, FISCAL_YEAR, OPERATING, CASH, REPAIRS],
      );

      const { rows } = await db.query<{
        month: string;
        account_id: string;
        fund_id: string;
        total: string;
      }>(
        `select month::text, account_id, fund_id, total
           from public.monthly_expense_actuals
          where association_id = $1::uuid and account_id = $2::uuid
          order by month`,
        [f.damen, REPAIRS],
      );

      expect(rows).toEqual([
        { month: "2026-01-01", account_id: REPAIRS, fund_id: OPERATING, total: "150.00" },
        { month: "2026-02-01", account_id: REPAIRS, fund_id: OPERATING, total: "30.00" },
      ]);
    });
  });

  it("hides it from an owner, matching expenses' own board+accountant-only RLS", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-01-15'::date, 100, $3::uuid, $4::uuid, $5::uuid)`,
        [f.damen, FISCAL_YEAR, OPERATING, CASH, REPAIRS],
      );
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from public.monthly_expense_actuals where association_id = $1::uuid`,
        [f.damen],
      );
      expect(rows[0].n).toBe(0);
    });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from public.monthly_expense_actuals where association_id = $1::uuid`,
        [f.damen],
      );
      expect(rows[0].n).toBeGreaterThan(0);
    });
  });

  it("does not leak another association's expenses", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_expense(
           $1::uuid, $2::uuid, '2026-01-15'::date, 100, $3::uuid, $4::uuid, $5::uuid)`,
        [f.damen, FISCAL_YEAR, OPERATING, CASH, REPAIRS],
      );
    });

    await asUser(db, f.zaraUser, async () => {
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from public.monthly_expense_actuals where association_id = $1::uuid`,
        [f.damen],
      );
      expect(rows[0].n).toBe(0);
    });
  });
});
