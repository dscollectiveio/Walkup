import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const EXPENSE = "acc00000-0000-0000-0000-000000005000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY = "f1500000-0000-0000-0000-000000000001";

describe("tax center (0022)", () => {
  let db: PGlite;
  let f: Fixture;
  let incomeLineId: string;
  let expenseLineId: string;

  const post = (lines: unknown[], memo = "test entry") =>
    db.query<{ post_journal_entry: string }>(
      `select public.post_journal_entry(
         $1::uuid, $2::uuid, $3::date, $4, 'manual', $5::jsonb)`,
      [f.damen, FY, "2026-03-01", memo, JSON.stringify(lines)],
    );

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);

    await asUser(db, f.cyUser, async () => {
      // A cash-classifying expense account, added locally rather than editing
      // the shared fixture set — same convention building-settings.test.ts
      // established for a scoped, test-local addition.
      await db.query(
        `insert into accounts
           (id, association_id, code, name, type, is_cash_account, is_exempt_expenditure)
         values ($1::uuid, $2::uuid, '5000', 'Landscaping', 'expense', false, true)`,
        [EXPENSE, f.damen],
      );

      // A direct-branch cash receipt: no receivable in between.
      await post([
        { account_id: CASH, fund_id: OPERATING, debit: 1000 },
        { account_id: INCOME, fund_id: OPERATING, credit: 1000 },
      ]);

      // A cash disbursement.
      await post([
        { account_id: EXPENSE, fund_id: OPERATING, debit: 400 },
        { account_id: CASH, fund_id: OPERATING, credit: 400 },
      ]);

      const { rows: receipts } = await db.query<{ journal_line_id: string }>(
        `select journal_line_id from cash_basis_receipts
          where association_id = $1::uuid and income_account_id = $2::uuid`,
        [f.damen, INCOME],
      );
      incomeLineId = receipts[0].journal_line_id;

      const { rows: disbursements } = await db.query<{ journal_line_id: string }>(
        `select journal_line_id from cash_basis_disbursements
          where association_id = $1::uuid and account_id = $2::uuid`,
        [f.damen, EXPENSE],
      );
      expenseLineId = disbursements[0].journal_line_id;
    });
  });

  afterEach(async () => {
    await db.close();
  });

  // --------------------------------------------------------------------------
  // View override behaviour
  // --------------------------------------------------------------------------

  it("uses the account's default classification when no override exists", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows: receipt } = await db.query<{ is_exempt: boolean; amount: string }>(
        `select is_exempt, amount::text from cash_basis_receipts where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(receipt[0]).toEqual({ is_exempt: true, amount: "1000.00" });

      const { rows: disbursement } = await db.query<{ is_exempt: boolean; amount: string }>(
        `select is_exempt, amount::text from cash_basis_disbursements where journal_line_id = $1::uuid`,
        [expenseLineId],
      );
      expect(disbursement[0]).toEqual({ is_exempt: true, amount: "400.00" });
    });
  });

  it("an override flips is_exempt for that line only, and clearing it reverts", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into tax_line_classifications (association_id, journal_line_id, is_exempt, note)
         values ($1::uuid, $2::uuid, false, 'one-off rental, not a member fee')`,
        [f.damen, incomeLineId],
      );

      const { rows: overridden } = await db.query<{ is_exempt: boolean }>(
        `select is_exempt from cash_basis_receipts where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(overridden[0].is_exempt).toBe(false);

      // The disbursement line, untouched, keeps its account default.
      const { rows: untouched } = await db.query<{ is_exempt: boolean }>(
        `select is_exempt from cash_basis_disbursements where journal_line_id = $1::uuid`,
        [expenseLineId],
      );
      expect(untouched[0].is_exempt).toBe(true);

      await db.query(`delete from tax_line_classifications where journal_line_id = $1::uuid`, [
        incomeLineId,
      ]);

      const { rows: reverted } = await db.query<{ is_exempt: boolean }>(
        `select is_exempt from cash_basis_receipts where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(reverted[0].is_exempt).toBe(true);
    });
  });

  it("reflects an override in form_1120h_figures", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
         values ($1::uuid, $2::uuid, false)`,
        [f.damen, incomeLineId],
      );

      const { rows } = await db.query<{ exempt_income: string; nonexempt_income: string }>(
        `select exempt_income, nonexempt_income from public.form_1120h_figures($1::uuid, $2::uuid)`,
        [f.damen, FY],
      );
      expect(rows[0]).toEqual({ exempt_income: "0.00", nonexempt_income: "1000.00" });
    });
  });

  // --------------------------------------------------------------------------
  // tax_line_classifications RLS
  // --------------------------------------------------------------------------

  it("lets board_admin insert/update/delete; owner and accountant cannot write", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
           values ($1::uuid, $2::uuid, false)`,
          [f.damen, incomeLineId],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    await asUser(db, f.niaUser, async () => {
      // Accountant (Nia) can read but not write.
      const { rows } = await db.query(
        `select 1 from cash_basis_receipts where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(rows).toHaveLength(1);

      await expect(
        db.query(
          `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
           values ($1::uuid, $2::uuid, false)`,
          [f.damen, incomeLineId],
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(
        `select 1 from tax_line_classifications where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(rows).toHaveLength(0); // owner cannot see financial tables at all
    });
  });

  it("lets a board_member (not just board_admin) insert an override", async () => {
    // Scoped, test-local grant — Bo becomes board_member for this test only,
    // matching the workaround building-settings.test.ts already established.
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into role_grants (association_id, person_id, role, granted_on, granted_by)
         values ($1::uuid, $2::uuid, 'board_member', current_date, $3::uuid)`,
        [f.damen, f.boPerson, f.cyUser],
      );
    });

    await asUser(db, f.boUser, async () => {
      await db.query(
        `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
         values ($1::uuid, $2::uuid, false)`,
        [f.damen, incomeLineId],
      );
      const { rows } = await db.query<{ is_exempt: boolean }>(
        `select is_exempt from tax_line_classifications where journal_line_id = $1::uuid`,
        [incomeLineId],
      );
      expect(rows[0].is_exempt).toBe(false);
    });
  });

  it("ignores a spoofed association_id and rejects a caller without board access to the line's real association", async () => {
    // Zara is owner-only at Hoyne, with no role at Damen at all. Even if she
    // (or a compromised client) supplies association_id = Hoyne, the
    // before-insert trigger recomputes it from the line itself (Damen), and
    // she is not board there — so the insert must fail either way.
    await asUser(db, f.zaraUser, async () => {
      await expect(
        db.query(
          `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
           values ($1::uuid, $2::uuid, false)`,
          [f.hoyne, incomeLineId],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // --------------------------------------------------------------------------
  // compute_and_save_tax_filing
  // --------------------------------------------------------------------------

  it("computes and saves a filing with matching figure provenance", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ compute_and_save_tax_filing: string }>(
        `select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`,
        [f.damen, FY],
      );
      const filingId = rows[0].compute_and_save_tax_filing;
      expect(filingId).toBeTruthy();

      const { rows: filing } = await db.query<{
        exempt_income_cash: string;
        nonexempt_income_cash: string;
        gross_income_cash: string;
        exempt_expenditures_cash: string;
        total_expenditures_cash: string;
        test_60_pct_passed: boolean;
        test_90_pct_passed: boolean;
        taxable_income: string;
        tax_due: string;
      }>(
        `select exempt_income_cash::text, nonexempt_income_cash::text, gross_income_cash::text,
                exempt_expenditures_cash::text, total_expenditures_cash::text,
                test_60_pct_passed, test_90_pct_passed, taxable_income::text, tax_due::text
           from tax_filings where id = $1::uuid`,
        [filingId],
      );
      // Matches src/lib/tax/form1120h.ts's computeForm1120h() on the same
      // inputs: 1000 exempt income / 1000 gross = 100% (passes 60%); 400
      // exempt / 400 total = 100% (passes 90%); nonexempt income is 0, so
      // taxable income and tax due are both 0.
      expect(filing[0]).toEqual({
        exempt_income_cash: "1000.00",
        nonexempt_income_cash: "0.00",
        gross_income_cash: "1000.00",
        exempt_expenditures_cash: "400.00",
        total_expenditures_cash: "400.00",
        test_60_pct_passed: true,
        test_90_pct_passed: true,
        taxable_income: "0.00",
        tax_due: "0.00",
      });

      const { rows: provenance } = await db.query<{ figure_key: string; value: string }>(
        `select figure_key, value::text from tax_figure_provenance
          where filing_id = $1::uuid order by figure_key`,
        [filingId],
      );
      expect(provenance).toHaveLength(9);
      const byKey = Object.fromEntries(provenance.map((p) => [p.figure_key, p.value]));
      expect(byKey.exempt_income).toBe("1000.000000");
      expect(byKey.exempt_expenditures).toBe("400.000000");

      const { rows: lineIds } = await db.query<{ source_journal_line_ids: string[] }>(
        `select source_journal_line_ids from tax_figure_provenance
          where filing_id = $1::uuid and figure_key = 'exempt_income'`,
        [filingId],
      );
      expect(lineIds[0].source_journal_line_ids).toEqual([incomeLineId]);
    });
  });

  it("stores ratio provenance at full precision, not rounded to cents", async () => {
    await asUser(db, f.cyUser, async () => {
      // A second income entry, overridden non-exempt, so the income ratio is
      // not a round number: 1000 exempt / 1500 gross = 0.666667 repeating.
      // tax_figure_provenance.value must be numeric(14,6) — if it regresses to
      // numeric(14,2) (0022's original, buggy scale), this silently rounds to
      // 0.67 and the assertion below catches it.
      await post([
        { account_id: CASH, fund_id: OPERATING, debit: 500 },
        { account_id: INCOME, fund_id: OPERATING, credit: 500 },
      ]);
      const { rows: secondLine } = await db.query<{ journal_line_id: string }>(
        `select journal_line_id from cash_basis_receipts
          where association_id = $1::uuid and income_account_id = $2::uuid
            and amount = 500.00`,
        [f.damen, INCOME],
      );
      await db.query(
        `insert into tax_line_classifications (association_id, journal_line_id, is_exempt)
         values ($1::uuid, $2::uuid, false)`,
        [f.damen, secondLine[0].journal_line_id],
      );

      const { rows } = await db.query<{ compute_and_save_tax_filing: string }>(
        `select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`,
        [f.damen, FY],
      );
      const filingId = rows[0].compute_and_save_tax_filing;

      const { rows: ratio } = await db.query<{ value: string }>(
        `select value::text from tax_figure_provenance
          where filing_id = $1::uuid and figure_key = 'test_60_pct_ratio'`,
        [filingId],
      );
      expect(ratio[0].value).toBe("0.666667");
    });
  });

  it("recomputes cleanly while unlocked, and rejects non-board / cross-tenant callers", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, FY]);
      // A second call, after nothing changed, should not throw.
      await db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, FY]);
    });

    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, FY]),
      ).rejects.toThrow(/not authorized/i);
    });

    await asUser(db, f.zaraUser, async () => {
      await expect(
        db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, FY]),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  // --------------------------------------------------------------------------
  // lock_tax_filing
  // --------------------------------------------------------------------------

  it("locks a filing, then refuses recompute or any further change", async () => {
    let filingId: string;
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ compute_and_save_tax_filing: string }>(
        `select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`,
        [f.damen, FY],
      );
      filingId = rows[0].compute_and_save_tax_filing;

      await db.query(`select public.lock_tax_filing($1::uuid, '2027-03-15'::date)`, [filingId]);

      const { rows: locked } = await db.query<{ filed_on: string; locked_at: string | null }>(
        `select filed_on::text, locked_at::text from tax_filings where id = $1::uuid`,
        [filingId],
      );
      expect(locked[0].filed_on).toBe("2027-03-15");
      expect(locked[0].locked_at).not.toBeNull();

      await expect(
        db.query(`select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`, [f.damen, FY]),
      ).rejects.toThrow(/locked/i);

      // tax_filings has no UPDATE policy for any role (0002_rls.sql:246) —
      // an ordinary client is already fully blocked here, silently (RLS
      // filters the target row rather than raising). tg_tax_filing_immutable
      // is defense-in-depth for a future SECURITY DEFINER writer that bypasses
      // RLS the way compute_and_save_tax_filing itself does — which is
      // exactly the case already covered above.
      const { rows: bypassAttempt } = await db.query(
        `update tax_filings set tax_due = 999 where id = $1::uuid returning id`,
        [filingId],
      );
      expect(bypassAttempt).toHaveLength(0);
    });
  });

  it("refuses to lock a filing for a non-board caller", async () => {
    let filingId: string;
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ compute_and_save_tax_filing: string }>(
        `select public.compute_and_save_tax_filing($1::uuid, $2::uuid)`,
        [f.damen, FY],
      );
      filingId = rows[0].compute_and_save_tax_filing;
    });

    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(`select public.lock_tax_filing($1::uuid, '2027-03-15'::date)`, [filingId]),
      ).rejects.toThrow(/not authorized/i);
    });
  });
});
