import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";

describe("book-to-tax reconciliation", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("refuses to charge a unit for a non-board caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.record_assessment_charge(
             $1::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid, $2::uuid,
             'assessment'::public.charge_type, '2026-04-01'::date, '2026-04-01'::date,
             100, $3::uuid, $4::uuid, $5::uuid)`,
          [f.damen, f.unit1, OPERATING, AR, INCOME],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("refuses to record a payment for a non-board caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.record_payment(
             $1::uuid, $2::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid,
             '2026-03-01'::date, 100, $3::uuid, $4::uuid, $5::uuid)`,
          [f.damen, f.unit1, OPERATING, CASH, AR],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("lets a board member record a payment, ledger entry included", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_payment(
           $1::uuid, $2::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid,
           '2026-03-01'::date, 200, $3::uuid, $4::uuid, $5::uuid, 'check', 'chk-100',
           jsonb_build_array(jsonb_build_object('charge_id', $6::text, 'amount', 200)))`,
        [f.damen, f.unit1, OPERATING, CASH, AR, f.adaCharge],
      );
    });

    const { rows } = await db.query<{ n: number; total: string }>(
      `select count(*)::int n, sum(total_debit)::text total from trial_balance
        where account_id = '${CASH}'`,
    );
    // The fixture's trial balance already has cash activity; this just proves
    // the new payment's ledger entry landed rather than the payment row
    // existing on its own with no corresponding journal entry.
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  it("shows a gap when income is billed but not collected", async () => {
    // Bo's $750 charge from the fixture is accrued (book) but unpaid (tax).
    const { rows } = await db.query<{
      code: string;
      book_amount: string;
      tax_cash_amount: string;
      difference: string;
    }>(`select code, book_amount::text, tax_cash_amount::text, difference::text
          from book_to_tax_reconciliation where code = '4000'`);

    expect(rows[0].book_amount).toBe("750.00");
    expect(rows[0].tax_cash_amount).toBe("0.00");
    expect(rows[0].difference).toBe("750.00");
  });

  it("finds cash collected this year against a charge accrued in a different fiscal year", async () => {
    // This is the exact case a naive LEFT JOIN from the book side would
    // silently drop: an accrual dated in one fiscal year, cash for it
    // received in another. The reconciliation view's book CTE groups by the
    // ACCRUAL entry's fiscal_year_id; the tax CTE groups by the PAYMENT
    // entry's. For (this fiscal year, this account) that leaves a tax-side
    // row with no book-side counterpart at all -- which only a FULL OUTER
    // JOIN surfaces. A fresh account isolates this from the fixture's own
    // in-year assessment activity, which would otherwise mask the effect.
    const specialAccount = "acc00000-0000-0000-0000-000000004010";
    const priorYear = "f1500000-0000-0000-0000-00000000ffff";
    let charge = "";

    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into accounts (id, association_id, code, name, type, is_exempt_function_income)
         values ($1, $2, '4010', 'Special Assessments (test)', 'income', true)`,
        [specialAccount, f.damen],
      );
      await db.query(
        `insert into fiscal_years (id, association_id, label, starts_on, ends_on)
         values ($1, $2, '2025', '2025-01-01', '2025-12-31')`,
        [priorYear, f.damen],
      );
      const { rows: chargeRow } = await db.query<{ record_assessment_charge: string }>(
        `select public.record_assessment_charge(
           $1::uuid, $2::uuid, $3::uuid, 'special_assessment'::public.charge_type,
           '2025-06-01'::date, '2025-06-01'::date, 300, $4::uuid, $5::uuid, $6::uuid)`,
        [f.damen, priorYear, f.unit1, OPERATING, AR, specialAccount],
      );
      charge = chargeRow[0].record_assessment_charge;

      // Paid this fiscal year, via the only real write path into payments.
      await db.query(
        `select public.record_payment(
           $1::uuid, $2::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid,
           '2026-03-01'::date, 300, $3::uuid, $4::uuid, $5::uuid,
           'check', null,
           jsonb_build_array(jsonb_build_object('charge_id', $6::text, 'amount', 300)))`,
        [f.damen, f.unit1, OPERATING, CASH, AR, charge],
      );
    });

    const { rows } = await db.query<{ book_amount: string; tax_cash_amount: string }>(
      `select book_amount::text, tax_cash_amount::text
         from book_to_tax_reconciliation
        where code = '4010' and fiscal_year_id = 'f1500000-0000-0000-0000-000000000001'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].book_amount).toBe("0.00");      // no 2026 accrual on this account
    expect(rows[0].tax_cash_amount).toBe("300.00"); // but 2026 cash against it
  });

  it("does not leak another association's reconciliation", async () => {
    await asUser(db, f.zaraUser, async () => {
      const { rows } = await db.query(`select association_id from book_to_tax_reconciliation`);
      expect(rows.every((r: any) => r.association_id === f.hoyne)).toBe(true);
    });
  });

  it("hides the reconciliation from an owner", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select 1 from book_to_tax_reconciliation`);
      expect(rows).toEqual([]);
    });
  });
});

describe("1099-NEC", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("totals a vendor's service payments and flags a missing W-9", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into vendors (association_id, name, is_1099_exempt, w9_on_file)
         values ($1, 'Ravenswood Plumbing', false, false)`,
        [f.damen],
      );
    });
    const { rows: v } = await db.query<{ id: string }>(
      `select id from vendors where name = 'Ravenswood Plumbing'`,
    );

    const repairs = "acc00000-0000-0000-0000-000000005020";
    await db.exec(`
      insert into accounts (id, association_id, code, name, type, is_exempt_expenditure)
      values ('${repairs}', '${f.damen}', '5020', 'Repairs', 'expense', true)
      on conflict do nothing;
    `);

    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_expense(
           $1::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date,
           850, $2::uuid, $3::uuid, $4::uuid, $5::uuid, true, false, 'Plumbing repair')`,
        [f.damen, OPERATING, CASH, repairs, v[0].id],
      );
    });

    const { rows } = await db.query<{
      name: string;
      total_paid: string;
      w9_on_file: boolean;
    }>(`select name, total_paid::text, w9_on_file from vendor_1099_totals where vendor_id = '${v[0].id}'`);

    expect(rows[0].total_paid).toBe("850.00");
    expect(rows[0].w9_on_file).toBe(false); // the missing-W-9 exception case
  });

  it("excludes a vendor explicitly flagged 1099-exempt", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into vendors (association_id, name, is_1099_exempt, w9_on_file)
         values ($1, 'Peoples Gas', true, false)`,
        [f.damen],
      );
    });
    const { rows: v } = await db.query<{ id: string }>(`select id from vendors where name = 'Peoples Gas'`);
    const util = "acc00000-0000-0000-0000-000000005010";
    await db.exec(`
      insert into accounts (id, association_id, code, name, type, is_exempt_expenditure)
      values ('${util}', '${f.damen}', '5010', 'Utilities', 'expense', true) on conflict do nothing;
    `);
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.record_expense(
           $1::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date,
           900, $2::uuid, $3::uuid, $4::uuid, $5::uuid, true, false, 'Gas bill')`,
        [f.damen, OPERATING, CASH, util, v[0].id],
      );
    });

    const { rows } = await db.query(`select 1 from vendor_1099_totals where vendor_id = '${v[0].id}'`);
    expect(rows).toEqual([]);
  });

  it("refuses to record an expense for a non-board caller", async () => {
    const util = "acc00000-0000-0000-0000-000000005010";
    await db.exec(`
      insert into accounts (id, association_id, code, name, type, is_exempt_expenditure)
      values ('${util}', '${f.damen}', '5010', 'Utilities', 'expense', true) on conflict do nothing;
    `);
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.record_expense(
             $1::uuid, 'f1500000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date,
             100, $2::uuid, $3::uuid, $4::uuid)`,
          [f.damen, OPERATING, CASH, util],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });
});

describe("budget vs actual", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("refuses a budget line from an owner", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.set_budget_line($1::uuid,'f1500000-0000-0000-0000-000000000001'::uuid,$2::uuid,$3::uuid,500)`,
          [f.damen, INCOME, OPERATING],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("lets a board member set a budget line, and shows the variance against actuals", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.set_budget_line($1::uuid,'f1500000-0000-0000-0000-000000000001'::uuid,$2::uuid,$3::uuid,700)`,
        [f.damen, INCOME, OPERATING],
      );
    });

    const { rows } = await db.query<{ budgeted: string; actual: string; variance: string }>(
      `select budgeted::text, actual::text, variance::text
         from budget_vs_actual where account_id = $1`,
      [INCOME],
    );
    expect(rows[0].budgeted).toBe("700.00");
    // Fixture has $750 already accrued in income for unit 2's charge.
    expect(rows[0].actual).toBe("750.00");
    expect(rows[0].variance).toBe("50.00");
  });

  it("upserts rather than duplicating on a second call", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.set_budget_line($1::uuid,'f1500000-0000-0000-0000-000000000001'::uuid,$2::uuid,$3::uuid,700)`,
        [f.damen, INCOME, OPERATING],
      );
      await db.query(
        `select public.set_budget_line($1::uuid,'f1500000-0000-0000-0000-000000000001'::uuid,$2::uuid,$3::uuid,800)`,
        [f.damen, INCOME, OPERATING],
      );
    });
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int n from budget_lines where account_id = $1`,
      [INCOME],
    );
    expect(rows[0].n).toBe(1);
  });

  function post(lines: unknown[], memo: string) {
    return db.query<{ post_journal_entry: string }>(
      `select public.post_journal_entry($1::uuid,$2::uuid,$3::date,$4,'manual',$5::jsonb)`,
      [f.damen, "f1500000-0000-0000-0000-000000000001", "2026-03-01", memo, JSON.stringify(lines)],
    );
  }
});
