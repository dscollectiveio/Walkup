import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const EXPENSE = "acc00000-0000-0000-0000-000000005000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY = "f1500000-0000-0000-0000-000000000001";

// 0059: reversing an entry takes it back out of the Form 1120-H figures.
describe("tax views net out reversed entries (0059)", () => {
  let db: PGlite;
  let f: Fixture;

  const post = async (lines: unknown[]) => {
    const { rows } = await db.query<{ id: string }>(
      `select public.post_journal_entry($1::uuid, $2::uuid, '2026-03-01', 'test', 'manual', $3::jsonb) as id`,
      [f.damen, FY, JSON.stringify(lines)],
    );
    return rows[0].id;
  };
  const figures = async () => {
    const { rows } = await db.query<{ exempt_income: string; total_expenditures: string }>(
      `select exempt_income, total_expenditures from public.form_1120h_figures($1::uuid, $2::uuid)`,
      [f.damen, FY],
    );
    return rows[0];
  };

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(
      `insert into accounts (id, association_id, code, name, type, is_cash_account, is_exempt_expenditure)
       values ($1::uuid, $2::uuid, '5000', 'Landscaping', 'expense', false, true)`,
      [EXPENSE, f.damen],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("a reversed deposit stops counting as income", async () => {
    await asUser(db, f.cyUser, async () => {
      const id = await post([
        { account_id: CASH, fund_id: OPERATING, debit: 100 },
        { account_id: INCOME, fund_id: OPERATING, credit: 100 },
      ]);
      expect((await figures()).exempt_income).toBe("100.00");
      await db.query(`select public.reverse_journal_entry($1::uuid)`, [id]);
      expect((await figures()).exempt_income).toBe("0.00");
    });
  });

  it("a reversed payment stops counting as spending", async () => {
    await asUser(db, f.cyUser, async () => {
      const id = await post([
        { account_id: EXPENSE, fund_id: OPERATING, debit: 250 },
        { account_id: CASH, fund_id: OPERATING, credit: 250 },
      ]);
      expect((await figures()).total_expenditures).toBe("250.00");
      await db.query(`select public.reverse_journal_entry($1::uuid)`, [id]);
      expect((await figures()).total_expenditures).toBe("0.00");
    });
  });

  it("entries that were not reversed still count", async () => {
    await asUser(db, f.cyUser, async () => {
      const keep = await post([
        { account_id: CASH, fund_id: OPERATING, debit: 700 },
        { account_id: INCOME, fund_id: OPERATING, credit: 700 },
      ]);
      const undo = await post([
        { account_id: CASH, fund_id: OPERATING, debit: 50 },
        { account_id: INCOME, fund_id: OPERATING, credit: 50 },
      ]);
      await db.query(`select public.reverse_journal_entry($1::uuid)`, [undo]);
      expect((await figures()).exempt_income).toBe("700.00");
      // the kept entry is still a receipt row; the undone one is not
      const { rows } = await db.query<{ amount: string }>(
        `select amount::text from public.cash_basis_receipts where association_id = $1::uuid`, [f.damen]);
      expect(rows.map((r) => r.amount)).toEqual(["700.00"]);
      expect(keep).not.toBe(undo);
    });
  });

  it("reversing a reversal puts the original back in every figure (income and spending)", async () => {
    await asUser(db, f.cyUser, async () => {
      const dep = await post([
        { account_id: CASH, fund_id: OPERATING, debit: 300 },
        { account_id: INCOME, fund_id: OPERATING, credit: 300 },
      ]);
      const exp = await post([
        { account_id: EXPENSE, fund_id: OPERATING, debit: 120 },
        { account_id: CASH, fund_id: OPERATING, credit: 120 },
      ]);
      const r1 = (await db.query<{ id: string }>(`select public.reverse_journal_entry($1::uuid) as id`, [dep])).rows[0].id;
      const e1 = (await db.query<{ id: string }>(`select public.reverse_journal_entry($1::uuid) as id`, [exp])).rows[0].id;
      expect(await figures()).toMatchObject({ exempt_income: "0.00", total_expenditures: "0.00" });

      await db.query(`select public.reverse_journal_entry($1::uuid)`, [r1]);
      await db.query(`select public.reverse_journal_entry($1::uuid)`, [e1]);
      expect(await figures()).toMatchObject({ exempt_income: "300.00", total_expenditures: "120.00" });
      // the ledger agrees: net credit to income is 300 again
      const { rows } = await db.query<{ net: string }>(
        `select coalesce(sum(l.credit - l.debit), 0)::text as net from public.journal_lines l join public.journal_entries je on je.id = l.journal_entry_id
          where l.account_id = $1::uuid and je.entry_date = '2026-03-01'`, [INCOME]);
      expect(rows[0].net).toBe("300.00");
    });
  });

  it("a third reversal takes it out again (chains of any depth)", async () => {
    await asUser(db, f.cyUser, async () => {
      const dep = await post([
        { account_id: CASH, fund_id: OPERATING, debit: 80 },
        { account_id: INCOME, fund_id: OPERATING, credit: 80 },
      ]);
      let last = dep;
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        last = (await db.query<{ id: string }>(`select public.reverse_journal_entry($1::uuid) as id`, [last])).rows[0].id;
        seen.push((await figures()).exempt_income);
      }
      expect(seen).toEqual(["0.00", "80.00", "0.00"]);
    });
  });

  // ---- cash received and not applied to a charge (REVIEW-4 #1) --------------
  describe("unapplied cash counts as a receipt in the year received", () => {
    const AR = "acc00000-0000-0000-0000-000000001200";
    const NONEX = "acc00000-0000-0000-0000-000000004100";

    const charge = async (unit: string, amount: number, due: string, income = INCOME) =>
      (await db.query<{ id: string }>(
        `select public.record_assessment_charge($1::uuid, $2::uuid, $3::uuid, 'assessment', $4::date, $4::date, $5::numeric,
                $6::uuid, $7::uuid, $8::uuid) as id`,
        [f.damen, FY, unit, due, amount, OPERATING, AR, income],
      )).rows[0].id;
    const pay = async (unit: string, amount: number, on: string, allocs: { charge_id: string; amount: number }[] = []) =>
      (await db.query<{ id: string }>(
        `select public.record_payment($1::uuid, $2::uuid, $3::uuid, $4::date, $5::numeric, $6::uuid, $7::uuid, $8::uuid,
                'check', null, $9::jsonb) as id`,
        [f.damen, unit, FY, on, amount, OPERATING, CASH, AR, JSON.stringify(allocs)],
      )).rows[0].id;
    const fig = async () => {
      const { rows } = await db.query<{ exempt_income: string; nonexempt_income: string; gross_income: string }>(
        `select exempt_income, nonexempt_income, gross_income from public.form_1120h_figures($1::uuid, $2::uuid)`, [f.damen, FY]);
      return rows[0];
    };
    const receipts = async () =>
      (await db.query<{ basis: string; amount: string; is_exempt: boolean }>(
        `select basis, amount::text, is_exempt from public.cash_basis_receipts where association_id = $1::uuid order by basis, amount`,
        [f.damen])).rows;
    const cashIn = async () =>
      (await db.query<{ t: string }>(
        `select coalesce(sum(debit), 0)::text as t from public.journal_lines l join public.accounts a on a.id = l.account_id
          where a.is_cash_account and l.association_id = $1::uuid`, [f.damen])).rows[0].t;

    beforeEach(async () => {
      await db.query(
        `insert into accounts (id, association_id, code, name, type, is_cash_account, is_exempt_function_income)
         values ($1::uuid, $2::uuid, '4100', 'Laundry', 'income', false, false)`, [NONEX, f.damen]);
    });

    it("partial application: 400 received, 150 applied, counts 400 (the reviewer's case)", async () => {
      await asUser(db, f.cyUser, async () => {
        const c = await charge(f.unit1, 150, "2026-02-01");
        await pay(f.unit1, 400, "2026-02-11", [{ charge_id: c, amount: 150 }]);
        expect(await receipts()).toEqual([
          { basis: "assessment", amount: "150.00", is_exempt: true },
          { basis: "unapplied", amount: "250.00", is_exempt: true },
        ]);
        expect(await fig()).toMatchObject({ exempt_income: "400.00", gross_income: "400.00" });
        expect(await cashIn()).toBe("400.00");
      });
    });

    it("an unapplied payment with no allocations at all counts in full", async () => {
      await asUser(db, f.cyUser, async () => {
        await charge(f.unit1, 150, "2026-02-01");
        await pay(f.unit1, 275, "2026-03-05");
        expect(await receipts()).toEqual([{ basis: "unapplied", amount: "275.00", is_exempt: true }]);
        expect((await fig()).gross_income).toBe("275.00");
      });
    });

    it("over-payment: the part above the charge is its own receipt, total equals cash", async () => {
      await asUser(db, f.cyUser, async () => {
        const c = await charge(f.unit1, 100, "2026-02-01");
        await pay(f.unit1, 130, "2026-02-02", [{ charge_id: c, amount: 100 }]);
        expect(await receipts()).toEqual([
          { basis: "assessment", amount: "100.00", is_exempt: true },
          { basis: "unapplied", amount: "30.00", is_exempt: true },
        ]);
        expect((await fig()).gross_income).toBe(await cashIn());
      });
    });

    it("a fully applied payment has no unapplied row (no double count)", async () => {
      await asUser(db, f.cyUser, async () => {
        const c = await charge(f.unit1, 100, "2026-02-01");
        await pay(f.unit1, 100, "2026-02-02", [{ charge_id: c, amount: 100 }]);
        expect(await receipts()).toEqual([{ basis: "assessment", amount: "100.00", is_exempt: true }]);
      });
    });

    it("applying the cash later moves it between branches and never changes the total", async () => {
      await asUser(db, f.cyUser, async () => {
        await pay(f.unit1, 400, "2026-02-11");
        expect((await fig()).exempt_income).toBe("400.00");
        await charge(f.unit1, 150, "2026-03-01");
      });
      // there is no allocation screen yet; write it as the table owner
      await db.query(
        `insert into public.payment_allocations (association_id, payment_id, charge_id, amount)
         select $1::uuid, p.id, c.id, 150 from public.payments p, public.assessment_charges c
          where p.amount = 400 and c.amount = 150`, [f.damen]);
      await asUser(db, f.cyUser, async () => {
        expect(await receipts()).toEqual([
          { basis: "assessment", amount: "150.00", is_exempt: true },
          { basis: "unapplied", amount: "250.00", is_exempt: true },
        ]);
        expect((await fig()).exempt_income).toBe("400.00");
      });
    });

    it("an allocation to a charge that has no ledger entry is not lost", async () => {
      await asUser(db, f.cyUser, async () => {
        // the fixture's Ada charge predates ledger entries: no income line to classify under
        await pay(f.unit1, 90, "2026-02-02", [{ charge_id: f.adaCharge, amount: 90 }]);
        expect((await fig()).gross_income).toBe("90.00");
      });
    });

    it("a reversed payment counts nothing, and reversing the reversal counts all of it again", async () => {
      await asUser(db, f.cyUser, async () => {
        const c = await charge(f.unit1, 150, "2026-02-01");
        const p = await pay(f.unit1, 400, "2026-02-11", [{ charge_id: c, amount: 150 }]);
        const entry = (await db.query<{ journal_entry_id: string }>(`select journal_entry_id from public.payments where id = $1::uuid`, [p])).rows[0].journal_entry_id;
        const r1 = (await db.query<{ id: string }>(`select public.reverse_journal_entry($1::uuid) as id`, [entry])).rows[0].id;
        expect(await receipts()).toEqual([]);
        expect((await fig()).gross_income).toBe("0.00");
        await db.query(`select public.reverse_journal_entry($1::uuid)`, [r1]);
        expect((await fig()).exempt_income).toBe("400.00");
      });
    });

    it("waived and written-off charges: cash applied to them still counts, nothing else does", async () => {
      await asUser(db, f.cyUser, async () => {
        const waived = await charge(f.unit1, 200, "2026-02-01");
        const wo = await charge(f.unit1, 200, "2026-03-01");
        await pay(f.unit1, 60, "2026-03-10", [{ charge_id: wo, amount: 60 }]);
        await db.query(`update public.assessment_charges set waived_at = now() where id = $1::uuid`, [waived]);
        await db.query(`update public.assessment_charges set written_off_at = now() where id = $1::uuid`, [wo]);
        // 200 waived and 140 written off were never received: income is the 60 collected
        expect(await receipts()).toEqual([{ basis: "assessment", amount: "60.00", is_exempt: true }]);
        expect((await fig()).exempt_income).toBe("60.00");
      });
    });

    it("unapplied cash follows the unit's latest dues account (non-exempt stays non-exempt), then the association's, then 4000", async () => {
      await asUser(db, f.cyUser, async () => {
        // unit 1: latest charge posted to the non-exempt account
        await charge(f.unit1, 50, "2026-01-01");
        await charge(f.unit1, 50, "2026-02-01", NONEX);
        await pay(f.unit1, 30, "2026-02-05");
        // unit 2 has no charge ledger entry: falls back to the association's latest (non-exempt too)
        await pay(f.unit2, 20, "2026-02-06");
        expect(await receipts()).toEqual([
          { basis: "unapplied", amount: "20.00", is_exempt: false },
          { basis: "unapplied", amount: "30.00", is_exempt: false },
        ]);
        expect(await fig()).toMatchObject({ exempt_income: "0.00", nonexempt_income: "50.00", gross_income: "50.00" });
      });
    });

    it("with no assessment charge anywhere it falls back to the lowest-code exempt income account", async () => {
      await asUser(db, f.cyUser, async () => {
        await pay(f.unit3, 25, "2026-02-06");
        expect(await receipts()).toEqual([{ basis: "unapplied", amount: "25.00", is_exempt: true }]);
      });
    });

    it("the cash received is the tax receipts, always (mixed scenario)", async () => {
      await asUser(db, f.cyUser, async () => {
        const c1 = await charge(f.unit1, 150, "2026-02-01");
        const c2 = await charge(f.unit2, 300, "2026-02-01");
        await pay(f.unit1, 400, "2026-02-11", [{ charge_id: c1, amount: 150 }]);
        await pay(f.unit2, 100, "2026-02-12", [{ charge_id: c2, amount: 100 }]);
        await pay(f.unit3, 55.55, "2026-02-13");
        const dep = await post([
          { account_id: CASH, fund_id: OPERATING, debit: 10 },
          { account_id: NONEX, fund_id: OPERATING, credit: 10 },
        ]);
        expect(dep).toBeTruthy();
        expect((await fig()).gross_income).toBe(await cashIn());
      });
    });
  });
});
