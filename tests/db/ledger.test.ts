import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CASH = "acc00000-0000-0000-0000-000000001000";
const AR = "acc00000-0000-0000-0000-000000001200";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const FY = "f1500000-0000-0000-0000-000000000001";

describe("ledger", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  const post = (lines: unknown[], memo = "test entry") =>
    db.query<{ post_journal_entry: string }>(
      `select public.post_journal_entry(
         $1::uuid, $2::uuid, $3::date, $4, 'manual', $5::jsonb)`,
      [f.damen, FY, "2026-03-01", memo, JSON.stringify(lines)],
    );

  describe("balance", () => {
    it("accepts a balanced entry", async () => {
      await asUser(db, f.cyUser, async () => {
        await post([
          { account_id: CASH, fund_id: OPERATING, debit: 500 },
          { account_id: AR, fund_id: OPERATING, credit: 500 },
        ]);
      });

      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from journal_entries where memo = 'test entry'`,
      );
      expect(rows[0].n).toBe(1);
    });

    it("rejects an unbalanced entry at commit", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          post([
            { account_id: CASH, fund_id: OPERATING, debit: 500 },
            { account_id: AR, fund_id: OPERATING, credit: 499.99 },
          ]),
        ).rejects.toThrow(/unbalanced.*difference/is);
      });
    });

    it("rejects a single-line entry", async () => {
      await asUser(db, f.cyUser, async () => {
        await expect(
          post([{ account_id: CASH, fund_id: OPERATING, debit: 500 }]),
        ).rejects.toThrow(/at least two/i);
      });
    });

    it("cannot be bypassed by inserting lines directly", async () => {
      // The whole point of DECISIONS #5. Even the table owner cannot leave an
      // unbalanced entry behind, because the check is deferred to COMMIT.
      await expect(
        db.exec(`
          begin;
          insert into journal_entries (id, association_id, fiscal_year_id, entry_date, source)
            values ('9e000000-0000-0000-0000-0000000000ff', '${f.damen}', '${FY}', '2026-03-01', 'manual');
          insert into journal_lines (association_id, journal_entry_id, account_id, fund_id, debit, credit)
            values ('${f.damen}', '9e000000-0000-0000-0000-0000000000ff', '${CASH}', '${OPERATING}', 100, 0);
          commit;
        `),
      ).rejects.toThrow(/at least two|unbalanced/i);
    });
  });

  describe("authorization", () => {
    it("refuses to post for a non-board caller", async () => {
      await asUser(db, f.adaUser, async () => {
        await expect(
          post([
            { account_id: CASH, fund_id: OPERATING, debit: 10 },
            { account_id: AR, fund_id: OPERATING, credit: 10 },
          ]),
        ).rejects.toThrow(/not authorized/i);
      });
    });

    it("refuses to post into an association the caller does not belong to", async () => {
      await asUser(db, f.zaraUser, async () => {
        await expect(
          post([
            { account_id: CASH, fund_id: OPERATING, debit: 10 },
            { account_id: AR, fund_id: OPERATING, credit: 10 },
          ]),
        ).rejects.toThrow(/not authorized/i);
      });
    });
  });

  describe("immutability", () => {
    it("refuses to update a posted entry", async () => {
      await expect(
        db.query(
          `update journal_entries set memo = 'edited'
            where id = '3e000000-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/posted.*reversing entry/is);
    });

    it("refuses to delete a posted entry", async () => {
      await expect(
        db.query(
          `delete from journal_entries where id = '3e000000-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/posted.*reversing entry/is);
    });

    it("refuses to alter the lines of a posted entry", async () => {
      await expect(
        db.query(
          `update journal_lines set debit = 1
            where journal_entry_id = '3e000000-0000-0000-0000-000000000001'`,
        ),
      ).rejects.toThrow(/posted/i);
    });
  });

  describe("closed periods", () => {
    it("refuses to post into a closed year", async () => {
      await db.query(
        `update fiscal_years set status = 'closed', closed_at = now() where id = '${FY}'`,
      );
      await asUser(db, f.cyUser, async () => {
        await expect(
          post([
            { account_id: CASH, fund_id: OPERATING, debit: 10 },
            { account_id: AR, fund_id: OPERATING, credit: 10 },
          ]),
        ).rejects.toThrow(/closed/i);
      });
    });

    it("refuses to reopen a closed year", async () => {
      await db.query(
        `update fiscal_years set status = 'closed', closed_at = now() where id = '${FY}'`,
      );
      await expect(
        db.query(`update fiscal_years set status = 'open' where id = '${FY}'`),
      ).rejects.toThrow(/cannot be reopened/i);
    });
  });

  describe("ownership", () => {
    const amendment = "0a000000-0000-0000-0000-000000000001";

    const insertAmendment = (pcts: number[]) => `
      begin;
      insert into ownership_amendments (id, association_id, effective_from)
        values ('${amendment}', '${f.damen}', '2026-01-01');
      insert into ownership_amendment_lines (association_id, amendment_id, unit_id, percentage)
        values
          ('${f.damen}', '${amendment}', '${f.unit1}', ${pcts[0]}),
          ('${f.damen}', '${amendment}', '${f.unit2}', ${pcts[1]}),
          ('${f.damen}', '${amendment}', '${f.unit3}', ${pcts[2]});
      commit;`;

    it("accepts percentages summing to exactly 100", async () => {
      await db.exec(insertAmendment([33.333334, 33.333333, 33.333333]));
      const { rows } = await db.query<{ total: string }>(
        `select sum(percentage)::text total from ownership_amendment_lines`,
      );
      expect(rows[0].total).toBe("100.000000");
    });

    it("rejects percentages that do not sum to 100", async () => {
      // Thirds that do not quite close — the classic three-unit rounding bug.
      await expect(
        db.exec(insertAmendment([33.333333, 33.333333, 33.333333])),
      ).rejects.toThrow(/not 100/i);
    });
  });

  describe("payments", () => {
    it("refuses to allocate more than the payment", async () => {
      await asUser(db, f.cyUser, async () => {
        await post([
          { account_id: CASH, fund_id: OPERATING, debit: 100 },
          { account_id: AR, fund_id: OPERATING, credit: 100 },
        ]);
      });
      const { rows } = await db.query<{ id: string }>(
        `select id from journal_entries where memo = 'test entry'`,
      );

      await expect(
        db.exec(`
          begin;
          insert into payments (id, association_id, unit_id, received_on, amount, fund_id, journal_entry_id)
            values ('9a000000-0000-0000-0000-000000000001', '${f.damen}', '${f.unit1}',
                    '2026-03-01', 100.00, '${OPERATING}', '${rows[0].id}');
          insert into payment_allocations (association_id, payment_id, charge_id, amount)
            values ('${f.damen}', '9a000000-0000-0000-0000-000000000001', '${f.adaCharge}', 500.00);
          commit;`),
      ).rejects.toThrow(/allocates 500.*payment of 100/is);
    });
  });

  describe("views", () => {
    it("computes charge balances rather than caching them", async () => {
      const { rows } = await db.query<{
        unit_id: string;
        balance: string;
        status: string;
        days_overdue: number;
      }>(`select unit_id, balance, status, days_overdue
            from charge_balances order by balance`);

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.status)).toEqual(["open", "open"]);
      expect(rows.map((r) => r.balance)).toEqual(["500.00", "750.00"]);
    });

    it("does not let a view bypass row-level security", async () => {
      // security_invoker = true. Without it the view would run as its owner
      // and hand Ada the whole building.
      await asUser(db, f.adaUser, async () => {
        const { rows } = await db.query<{ unit_id: string }>(
          `select unit_id from charge_balances`,
        );
        expect(rows.map((r) => r.unit_id)).toEqual([f.unit1]);
      });
    });

    it("produces a trial balance that balances", async () => {
      const { rows } = await db.query<{ debits: string; credits: string }>(
        `select sum(total_debit)::text debits, sum(total_credit)::text credits
           from trial_balance`,
      );
      expect(rows[0].debits).toBe(rows[0].credits);
    });
  });
});
