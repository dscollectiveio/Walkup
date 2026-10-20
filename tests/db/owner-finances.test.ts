import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser } from "./harness";
import { pgError, queries, seededDb, boBoard, zaraBoard } from "./repairs-helpers";
import type { Fixture } from "./fixtures";

/**
 * Migration 0079, part B: the owner Finances page. Off by default, switched on by a board admin only, and read
 * through summary functions that check the flag and membership. Owners still cannot read the ledger.
 */

const CASH = "acc00000-0000-0000-0000-000000001000";
const INCOME = "acc00000-0000-0000-0000-000000004000";
const EXPENSE = "acc00000-0000-0000-0000-00000000e001";
const OPERATING = "ffff0000-0000-0000-0000-000000000001";
const RESERVE = "ffff0000-0000-0000-0000-000000000002";
const FY_2026 = "f1500000-0000-0000-0000-000000000001";
const FY_2025 = "f1500000-0000-0000-0000-000000000025";

let db: PGlite;
let f: Fixture;
const h = queries(() => db);
const { q, one, rows } = h;

afterEach(async () => {
  await db?.close();
});

beforeEach(async () => {
  ({ db, f } = await seededDb());
});

const post = (date: string, memo: string, fy: string, lines: object[]) =>
  q(f.cyUser, `select public.post_journal_entry($1::uuid, $2::uuid, $3::date, $4, 'manual', $5::jsonb)`, [f.damen, fy, date, memo, JSON.stringify(lines)]);

/** Damen's books: 2026 income 1,250 and spending 200, a 2025 year (income 1,000, spending 400), a reserve transfer, a budget. */
async function books() {
  await db.query(
    `insert into public.fiscal_years (id, association_id, label, starts_on, ends_on) values ($1::uuid, $2::uuid, '2025', '2025-01-01', '2025-12-31')`,
    [FY_2025, f.damen],
  );
  await q(f.cyUser, `insert into public.accounts (id, association_id, code, name, type, is_exempt_expenditure) values ($1::uuid, $2::uuid, '5000', 'Utilities', 'expense', true)`, [EXPENSE, f.damen]);
  await post("2026-04-15", "April assessments", FY_2026, [
    { account_id: CASH, fund_id: OPERATING, debit: 500 },
    { account_id: INCOME, fund_id: OPERATING, credit: 500 },
  ]);
  await post("2026-04-20", "April utilities", FY_2026, [
    { account_id: EXPENSE, fund_id: OPERATING, debit: 200 },
    { account_id: CASH, fund_id: OPERATING, credit: 200 },
  ]);
  await post("2026-05-01", "Reserve contribution", FY_2026, [
    { account_id: CASH, fund_id: RESERVE, debit: 100 },
    { account_id: CASH, fund_id: OPERATING, credit: 100 },
  ]);
  await post("2025-06-01", "2025 assessments", FY_2025, [
    { account_id: CASH, fund_id: OPERATING, debit: 1000 },
    { account_id: INCOME, fund_id: OPERATING, credit: 1000 },
  ]);
  await post("2025-07-01", "2025 utilities", FY_2025, [
    { account_id: EXPENSE, fund_id: OPERATING, debit: 400 },
    { account_id: CASH, fund_id: OPERATING, credit: 400 },
  ]);
  const budget = (
    await one<{ id: string }>(null, `insert into public.budgets (association_id, fiscal_year_id) values ($1::uuid, $2::uuid) returning id`, [f.damen, FY_2026])
  ).id;
  await db.query(
    `insert into public.budget_lines (association_id, budget_id, account_id, fund_id, amount) values
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1200.00),
       ($1::uuid, $2::uuid, $5::uuid, $4::uuid, 6000.00),
       ($1::uuid, $2::uuid, $3::uuid, $6::uuid, 999.00)`,
    [f.damen, budget, EXPENSE, OPERATING, INCOME, RESERVE],
  );
}

const turnOn = (user: string = f.cyUser, assoc: string = f.damen) => q(user, `select public.set_owner_finances_enabled($1::uuid, true)`, [assoc]);
const enabled = (user: string, assoc: string = f.damen) =>
  one<{ e: boolean }>(user, `select public.owner_finances_enabled($1::uuid) as e`, [assoc]).then((r) => r.e);
const summary = (user: string, assoc: string = f.damen) =>
  one<{ s: Record<string, unknown> | null }>(user, `select public.owner_finances_summary($1::uuid) as s`, [assoc]).then((r) => r.s);
// The summary is a JSON document; its shape is asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const core = (assoc: string = f.damen, asOf = "2026-10-20") =>
  one<{ s: Loose }>(null, `select public.owner_finances_core($1::uuid, $2::date) as s`, [assoc, asOf]).then((r) => r.s);

describe("the switch", () => {
  it("is off for every association until a board admin turns it on", async () => {
    expect(await rows(null, `select owner_finances_enabled from public.associations`)).toEqual([
      { owner_finances_enabled: false },
      { owner_finances_enabled: false },
    ]);
    for (const user of [f.adaUser, f.cyUser, f.niaUser]) {
      expect(await enabled(user)).toBe(false);
      expect(await summary(user)).toBeNull();
    }
  });

  it("only a board admin can switch it, not an owner, a board member or the accountant", async () => {
    await boBoard(db, f);
    for (const user of [f.adaUser, f.boUser, f.niaUser, f.vicUser, f.zaraUser]) {
      expect((await pgError(turnOn(user))).code, user).toBe("42501");
    }
    expect(await enabled(f.cyUser)).toBe(false);
    await turnOn();
    expect(await enabled(f.cyUser)).toBe(true);
    await q(f.cyUser, `select public.set_owner_finances_enabled($1::uuid, false)`, [f.damen]);
    expect(await enabled(f.cyUser)).toBe(false);
  });

  it("cannot be set to null, or for another association", async () => {
    expect((await pgError(q(f.cyUser, `select public.set_owner_finances_enabled($1::uuid, null)`, [f.damen]))).code).toBe("42501");
    expect((await pgError(turnOn(f.cyUser, f.hoyne))).code).toBe("42501");
    await zaraBoard(db, f);
    expect((await pgError(turnOn(f.zaraUser, f.damen))).code).toBe("42501");
  });

  it("is not writable straight through the table by an owner", async () => {
    const r = await q(f.adaUser, `update public.associations set owner_finances_enabled = true`);
    expect(r.affectedRows).toBe(0);
    expect(await enabled(f.adaUser)).toBe(false);
  });

  it("anon cannot execute the functions, and nobody signed in can call the internal ones", async () => {
    for (const fn of ["set_owner_finances_enabled(uuid, boolean)", "owner_finances_enabled(uuid)", "owner_finances_summary(uuid)"]) {
      const r = await one<{ ok: boolean }>(null, `select has_function_privilege('anon', 'public.${fn}', 'execute') as ok`);
      expect(r.ok, fn).toBe(false);
    }
    await expect(q(f.cyUser, `select public.owner_finances_core($1::uuid, current_date)`, [f.damen])).rejects.toThrow(/permission denied/i);
    await expect(q(f.cyUser, `select public.owner_finances_period($1::uuid, 'x', current_date, current_date)`, [f.damen])).rejects.toThrow(/permission denied/i);
  });
});

describe("who reads the summary", () => {
  beforeEach(async () => {
    await books();
  });

  it("nobody reads it while it is off, whatever their role", async () => {
    for (const user of [f.adaUser, f.boUser, f.cyUser, f.niaUser]) expect(await summary(user)).toBeNull();
  });

  it("once on, every member of the building reads it and nobody from another building does", async () => {
    await turnOn();
    for (const user of [f.adaUser, f.boUser, f.cyUser, f.niaUser]) {
      expect(await enabled(user), user).toBe(true);
      const s = await summary(user);
      expect(s, user).not.toBeNull();
      expect(Object.keys(s!).sort()).toEqual(["as_of", "budget", "cash", "last_year", "posted_through", "year_to_date"]);
    }
    expect(await enabled(f.zaraUser)).toBe(false);
    expect(await summary(f.zaraUser)).toBeNull();
    expect(await summary(f.zaraUser, f.damen)).toBeNull();
    expect(await summary(f.adaUser, f.hoyne)).toBeNull();
    // A former accountant has no role, so no view.
    expect(await summary(f.vicUser)).toBeNull();
  });

  it("a password-only (aal1) session reads nothing", async () => {
    await turnOn();
    const r = await asUser(db, f.adaUser, () => db.query<{ s: unknown }>(`select public.owner_finances_summary($1::uuid) as s`, [f.damen]), { aal: "aal1" });
    expect(r.rows[0].s).toBeNull();
  });

  it("switching it off again hides it", async () => {
    await turnOn();
    expect(await summary(f.adaUser)).not.toBeNull();
    await q(f.cyUser, `select public.set_owner_finances_enabled($1::uuid, false)`, [f.damen]);
    expect(await summary(f.adaUser)).toBeNull();
  });

  // The budget plan (budgets, budget_lines) is read by every member already (the owner Budget page), so it is not on this list.
  it("owners still cannot read the ledger or the bank tables, with the page on", async () => {
    await turnOn();
    for (const table of ["journal_lines", "journal_entries", "income_statement_lines", "bank_transactions"]) {
      expect(await rows(f.adaUser, `select * from public.${table}`), table).toEqual([]);
    }
  });
});

describe("the figures", () => {
  beforeEach(async () => {
    await books();
  });

  it("income and spending for the year to date and the last full year", async () => {
    const s = await core();
    expect(s.as_of).toBe("2026-10-20");
    expect(s.year_to_date).toEqual({
      label: "2026",
      starts_on: "2026-01-01",
      ends_on: "2026-10-20",
      has_activity: true,
      income: "1250.00",
      expenses: "200.00",
      net: "1050.00",
    });
    expect(s.last_year).toEqual({
      label: "2025",
      starts_on: "2025-01-01",
      ends_on: "2025-12-31",
      has_activity: true,
      income: "1000.00",
      expenses: "400.00",
      net: "600.00",
    });
  });

  it("cash and reserve balances from the posted books, by kind of fund", async () => {
    const s = await core();
    // Operating: 500 - 200 - 100 in 2026, plus 1000 - 400 in 2025. Reserve: 100.
    expect(s.cash).toEqual({ as_of: "2026-10-20", has_data: true, has_reserve_fund: true, operating: "800.00", reserve: "100.00" });
    // As of the middle of April the reserve transfer and the 2026 spending have not happened.
    const april = await core(f.damen, "2026-04-16");
    expect(april.cash).toMatchObject({ operating: "1100.00", reserve: "0.00" });
    expect(april.year_to_date).toMatchObject({ ends_on: "2026-04-16", income: "1250.00", expenses: "0.00", net: "1250.00" });
  });

  it("the budget compares the operating funds only, with plain totals and a line per account", async () => {
    const b = (await core()).budget;
    expect(b).toMatchObject({
      fiscal_year: "2026",
      days_elapsed: 293,
      days_total: 365,
      income_budget: "6000.00",
      income_actual: "1250.00",
      expense_budget: "1200.00",
      expense_actual: "200.00",
    });
    expect(b.lines).toEqual([
      { name: "Regular Assessments", type: "income", budget: "6000.00", actual: "1250.00" },
      { name: "Utilities", type: "expense", budget: "1200.00", actual: "200.00" },
    ]);
  });

  it("the reserve fund's budget line is left out", async () => {
    const b = (await core()).budget;
    expect(JSON.stringify(b)).not.toContain("999");
  });

  it("says when the books were last posted, and ignores entries that are not posted", async () => {
    expect((await core()).posted_through).toBe("2026-05-01");
    // A draft entry: the entry and its two lines in one transaction, so the double-entry check is satisfied.
    await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into public.journal_entries (association_id, fiscal_year_id, entry_date, memo, source, is_posted) values ($1::uuid, $2::uuid, '2026-09-01', 'Draft', 'manual', false) returning id`,
        [f.damen, FY_2026],
      );
      await tx.query(
        `insert into public.journal_lines (association_id, journal_entry_id, account_id, fund_id, debit, credit) values
           ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 9000, 0), ($1::uuid, $2::uuid, $5::uuid, $4::uuid, 0, 9000)`,
        [f.damen, rows[0].id, EXPENSE, OPERATING, CASH],
      );
    });
    const s = await core();
    expect(s.posted_through).toBe("2026-05-01");
    expect(s.year_to_date).toMatchObject({ expenses: "200.00" });
    expect(s.cash).toMatchObject({ operating: "800.00" });
  });

  it("every money value is text with two decimals", async () => {
    const s = await core();
    const moneyOf = (o: Record<string, unknown>, keys: string[]) => keys.map((k) => o[k]);
    const values = [
      ...moneyOf(s.year_to_date, ["income", "expenses", "net"]),
      ...moneyOf(s.last_year, ["income", "expenses", "net"]),
      ...moneyOf(s.cash, ["operating", "reserve"]),
      ...moneyOf(s.budget, ["income_budget", "income_actual", "expense_budget", "expense_actual"]),
      ...s.budget.lines.flatMap((l: Record<string, unknown>) => moneyOf(l, ["budget", "actual"])),
    ];
    for (const v of values) expect(v).toMatch(/^-?\d+\.\d{2}$/);
  });

  it("a year with no entries says so instead of inventing zeros as facts", async () => {
    await db.query(`delete from public.budget_lines`);
    const s = await core(f.damen, "2027-02-01");
    // No fiscal year covers February 2027; 2026 is the last full year.
    expect(s.year_to_date).toBeNull();
    expect(s.budget).toBeNull();
    expect(s.last_year).toMatchObject({ label: "2026", has_activity: true });
    await db.query(`insert into public.fiscal_years (association_id, label, starts_on, ends_on) values ($1::uuid, '2027', '2027-01-01', '2027-12-31')`, [f.damen]);
    const next = await core(f.damen, "2027-02-01");
    expect(next.year_to_date).toMatchObject({ label: "2027", has_activity: false, income: "0.00", expenses: "0.00", net: "0.00" });
  });
});

describe("an association with no books", () => {
  it("returns empty sections, never made-up numbers", async () => {
    await zaraBoard(db, f);
    await turnOn(f.zaraUser, f.hoyne);
    const s = await summary(f.zaraUser, f.hoyne);
    expect(s).not.toBeNull();
    expect(s).toMatchObject({ year_to_date: null, last_year: null, budget: null, posted_through: null });
    expect((s as Loose).cash).toMatchObject({ has_data: false, has_reserve_fund: false, operating: "0.00", reserve: "0.00" });
  });
});
