import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const EXPENSE = "acc00000-0000-0000-0000-00000000e001";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY2026 = "f1500000-0000-0000-0000-000000000001";

describe("income_statement_lines (0034)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);

    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into accounts (id, association_id, code, name, type, is_exempt_expenditure)
         values ($1::uuid, $2::uuid, '5000', 'Utilities', 'expense', true)`,
        [EXPENSE, f.damen],
      );

      // Income: debit Cash, credit Income — 500.
      await db.query(
        `select public.post_journal_entry(
           $1::uuid, $2::uuid, '2026-04-15'::date, 'April assessments', 'assessment',
           $3::jsonb)`,
        [
          f.damen,
          FY2026,
          JSON.stringify([
            { account_id: CASH, fund_id: OPERATING, debit: 500 },
            { account_id: INCOME, fund_id: OPERATING, credit: 500 },
          ]),
        ],
      );

      // Expense: debit Expense, credit Cash — 200.
      await db.query(
        `select public.post_journal_entry(
           $1::uuid, $2::uuid, '2026-04-20'::date, 'April utilities', 'expense',
           $3::jsonb)`,
        [
          f.damen,
          FY2026,
          JSON.stringify([
            { account_id: EXPENSE, fund_id: OPERATING, debit: 200 },
            { account_id: CASH, fund_id: OPERATING, credit: 200 },
          ]),
        ],
      );
    });
  });
  afterEach(async () => {
    await db.close();
  });

  it("signs income and expense lines to their natural positive direction", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{
        account_type: string;
        amount: string;
      }>(
        `select account_type, amount from public.income_statement_lines
          where association_id = $1::uuid and entry_date >= '2026-04-01'
          order by entry_date`,
        [f.damen],
      );
      expect(rows).toEqual([
        { account_type: "income", amount: "500.00" },
        { account_type: "expense", amount: "200.00" },
      ]);
    });
  });

  it("gives an owner-only caller nothing back (financial detail, not governance)", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(
        `select * from public.income_statement_lines where association_id = $1::uuid`,
        [f.damen],
      );
      expect(rows).toHaveLength(0);
    });
  });
});
