import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * The 0008 views shipped with no coverage, and fund_cash_balances was wrong in
 * a way the trial balance could not reveal: a LEFT JOIN whose ON conditions
 * looked like filters but only controlled NULLs, so the "cash" balance summed
 * every journal line in the fund.
 *
 * These tests exist so an aggregate cannot silently include the wrong rows
 * again.
 */
describe("reporting views", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  const CASH = "acc00000-0000-0000-0000-000000001000";
  const AR = "acc00000-0000-0000-0000-000000001200";
  const INCOME = "acc00000-0000-0000-0000-000000004000";
  const OPERATING = "ffff0000-0000-0000-0000-000000000001";
  const FY = "f1500000-0000-0000-0000-000000000001";

  const post = (lines: unknown[], memo: string) =>
    db.query(
      `select public.post_journal_entry($1::uuid,$2::uuid,$3::date,$4,'manual',$5::jsonb)`,
      [f.damen, FY, "2026-03-01", memo, JSON.stringify(lines)],
    );

  it("counts only cash accounts in fund_cash_balances", async () => {
    await asUser(db, f.cyUser, async () => {
      // Cash in: +1000 to the operating cash account.
      await post(
        [
          { account_id: CASH, fund_id: OPERATING, debit: 1000 },
          { account_id: INCOME, fund_id: OPERATING, credit: 1000 },
        ],
        "cash receipt",
      );

      // A non-cash entry in the SAME fund. It must not move cash at all.
      // Under the 0008 bug this shifted the balance, because the join did not
      // actually filter to cash accounts.
      await post(
        [
          { account_id: AR, fund_id: OPERATING, debit: 5000 },
          { account_id: INCOME, fund_id: OPERATING, credit: 5000 },
        ],
        "accrual only",
      );
    });

    const { rows } = await db.query<{ name: string; cash_balance: string }>(
      `select name, cash_balance::text from fund_cash_balances
        where association_id = '${f.damen}' order by name`,
    );

    const operating = rows.find((r) => r.name === "Operating");
    expect(operating?.cash_balance).toBe("1000.00");
  });

  it("ignores unposted entries in fund_cash_balances", async () => {
    // Drafts are not money. Inserted directly because post_journal_entry
    // always posts.
    await db.exec(`
      insert into journal_entries (id, association_id, fiscal_year_id, entry_date, source, is_posted)
        values ('11100000-0000-0000-0000-0000000000ff', '${f.damen}', '${FY}', '2026-03-01', 'manual', false);
      insert into journal_lines (association_id, journal_entry_id, account_id, fund_id, debit, credit) values
        ('${f.damen}', '11100000-0000-0000-0000-0000000000ff', '${CASH}',   '${OPERATING}', 9999, 0),
        ('${f.damen}', '11100000-0000-0000-0000-0000000000ff', '${INCOME}', '${OPERATING}', 0, 9999);
    `);

    const { rows } = await db.query<{ cash_balance: string }>(
      `select cash_balance::text from fund_cash_balances
        where association_id = '${f.damen}' and name = 'Operating'`,
    );
    expect(rows[0].cash_balance).toBe("0.00");
  });

  it("keeps a fund with no visible cash lines, with visible_lines = 0", async () => {
    // The count is what lets the UI distinguish "no cash" from "not yours to
    // see". If the fund row vanished, the page would render nothing at all.
    const { rows } = await db.query<{ name: string; visible_lines: number }>(
      `select name, visible_lines from fund_cash_balances
        where association_id = '${f.damen}' order by name`,
    );
    expect(rows.map((r) => r.name)).toEqual(["Operating", "Reserve"]);
    expect(rows.every((r) => r.visible_lines === 0)).toBe(true);
  });

  it("reports unit balances with a visible_charges count", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{
        label: string;
        visible_charges: number;
        balance_owed: string;
      }>(`select label, visible_charges, balance_owed::text
            from unit_balances order by sort_order`);

      // Ada sees all three units — units is member-readable by design — but
      // charges only for her own. Anything else must report zero visible
      // charges so the UI does not print a confident $0.00 (DECISIONS #17).
      const own = rows.find((r) => r.label === "Unit 1");
      const neighbour = rows.find((r) => r.label === "Unit 2");
      expect(own?.visible_charges).toBeGreaterThan(0);
      expect(neighbour?.visible_charges).toBe(0);
      expect(neighbour?.balance_owed).toBe("0.00");
    });
  });

  it("does not let association_totals leak another association", async () => {
    await asUser(db, f.zaraUser, async () => {
      const { rows } = await db.query<{ association_id: string }>(
        `select association_id from association_totals`,
      );
      expect(rows.map((r) => r.association_id)).toEqual([f.hoyne]);
    });
  });
});
