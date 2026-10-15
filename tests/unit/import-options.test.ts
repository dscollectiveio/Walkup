import { describe, expect, it } from "vitest";
import { autoMatchAccounts, distinctValues, initialOptions, isMappableAccount, mergeOptions, optionsPatchSchema, type AccountLite } from "@/lib/import/options";
import { categoryTotals, entryPreview, payeeLinkCounts, yearOf } from "@/lib/import/preview";
import { taxEffect, taxEffectFromSummary } from "@/lib/import/tax-effect";
import { alreadyImportedBatchId, errorHeading, GENERIC_IMPORT_ERROR, importErrorMessage } from "@/lib/import/messages";

const acct = (over: Partial<AccountLite> & { code: string; name: string }): AccountLite => ({
  id: `id-${over.code}`, type: "expense", is_cash_account: false, is_active: true, ...over,
});
const ACCOUNTS: AccountLite[] = [
  acct({ code: "1000", name: "Operating Cash", type: "asset", is_cash_account: true }),
  acct({ code: "1200", name: "Assessments Receivable", type: "asset" }),
  acct({ code: "4000", name: "Regular Assessments", type: "income" }),
  acct({ code: "5020", name: "Repairs & Maintenance" }),
  acct({ code: "5030", name: "Old", is_active: false }),
];

describe("option patches", () => {
  it("accept only the keys a kind has, in the right shape", () => {
    const tx = optionsPatchSchema("transactions");
    const id = "11111111-1111-4111-8111-111111111111";
    expect(tx.safeParse({ cash_account_id: id, mapping_confirmed: true, account_map: { repairs: id, x: null } }).success).toBe(true);
    expect(tx.safeParse({ as_of: "2026-01-01" }).success).toBe(false);
    expect(tx.safeParse({ cash_account_id: "x" }).success).toBe(false);
    expect(tx.safeParse({ account_map: { repairs: "x" } }).success).toBe(false);
    expect(tx.safeParse({ __proto__: { evil: 1 }, evil: 1 }).success).toBe(false);
    expect(tx.safeParse({ account_map: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, id])) }).success).toBe(false);
    expect(optionsPatchSchema("opening_units").safeParse({ as_of: "2025-12-31", income_account_id: id }).success).toBe(true);
    expect(optionsPatchSchema("opening_accounts").safeParse({ as_of: "12/31/2025" }).success).toBe(false);
    const uo = optionsPatchSchema("units_owners");
    expect(uo.safeParse({ effective_from: "2026-01-01", replace_owners: true, dues_frequency: "annual" }).success).toBe(true);
    expect(uo.safeParse({ dues_frequency: "weekly" }).success).toBe(false);
    expect(optionsPatchSchema("contractors").safeParse({ anything: 1 }).success).toBe(false);
    expect(optionsPatchSchema("contractors").safeParse({}).success).toBe(true);
  });

  it("merge: maps merge by entry, null or empty removes, other keys replace", () => {
    const current = { account_map: { a: "1", b: "2" }, cash_account_id: "c", mapping_confirmed: true };
    expect(mergeOptions(current, { account_map: { b: null, c: "3" }, mapping_confirmed: false })).toEqual({
      account_map: { a: "1", c: "3" }, cash_account_id: "c", mapping_confirmed: false,
    });
    expect(mergeOptions(current, { cash_account_id: null })).toEqual({ account_map: { a: "1", b: "2" }, mapping_confirmed: true });
    expect(mergeOptions({}, { account_map: { a: "1" } })).toEqual({ account_map: { a: "1" } });
    expect(mergeOptions(current, {})).toEqual(current);
    expect(mergeOptions({ amendment_reason: "x" }, { amendment_reason: "" })).toEqual({});
  });
});

describe("account matching", () => {
  it("never offers a cash account, a receivable or an inactive account", () => {
    expect(ACCOUNTS.filter(isMappableAccount).map((a) => a.code)).toEqual(["4000", "5020"]);
  });

  it("matches only an exact name or code, ignoring case and spacing", () => {
    const m = autoMatchAccounts(["regular   ASSESSMENTS", "5020", "Repairs", "Operating Cash", "Assessments Receivable", "Old", ""], ACCOUNTS);
    expect(m).toEqual({ "regular assessments": "id-4000", "5020": "id-5020" });
  });

  it("starting options: the only cash account, the only fund, exact matches; never a tax answer", () => {
    const books = { accounts: ACCOUNTS, funds: [{ id: "f1", name: "Operating", kind: "operating" }] };
    expect(initialOptions("transactions", books, { categories: ["Repairs", "Mystery"], funds: ["operating"] })).toEqual({
      cash_account_id: "id-1000", default_fund_id: "f1", fund_map: { operating: "f1" },
    });
    const two = { accounts: [...ACCOUNTS, acct({ code: "1010", name: "Reserve Cash", type: "asset", is_cash_account: true })], funds: [{ id: "f1", name: "Operating", kind: "operating" }, { id: "f2", name: "Reserve", kind: "reserve" }] };
    expect(initialOptions("transactions", two, { categories: ["Regular Assessments"] })).toEqual({ account_map: { "regular assessments": "id-4000" } });
    expect(initialOptions("opening_units", two)).toEqual({ ar_account_id: "id-1200", fund_id: "f1" });
    expect(initialOptions("units_owners", two)).toEqual({});
    expect(initialOptions("contractors", two)).toEqual({});
  });

  it("lists distinct values with counts, most common first", () => {
    const rows = ["Repairs", "repairs ", "Dues", "Repairs", ""].map((c): { mapped: Record<string, string> } => ({ mapped: c ? { category_key: c } : {} }));
    expect(distinctValues(rows, "category_key")).toEqual([
      { key: "repairs", sample: "Repairs", count: 3 },
      { key: "dues", sample: "Dues", count: 1 },
    ]);
  });
});

describe("tax effect words", () => {
  it("says what an account means for the 60% and 90% tests", () => {
    expect(taxEffect({ type: "income", is_exempt_function_income: true })).toBe("Counts as exempt income");
    expect(taxEffect({ type: "income", is_exempt_function_income: false })).toBe("Counts as taxable income");
    expect(taxEffect({ type: "expense", is_exempt_expenditure: true })).toBe("Counts toward the 90% spending test");
    expect(taxEffect({ type: "expense", is_exempt_expenditure: false })).toBe("Does not count toward the spending test");
    expect(taxEffect({ type: "asset", is_exempt_expenditure: true })).toBe("Counts toward the 90% spending test");
    expect(taxEffect({ type: "liability" })).toBe("Not part of the tax tests");
    expect(taxEffectFromSummary("equity", null)).toBe("Not part of the tax tests");
    expect(taxEffectFromSummary("income", false)).toBe("Counts as taxable income");
  });
});

describe("entry preview", () => {
  const accounts = new Map(ACCOUNTS.map((a) => [a.id, { id: a.id, code: a.code, name: a.name }]));
  const options = { cash_account_id: "id-1000", account_map: { repairs: "id-5020", "regular assessments": "id-4000" } };

  it("money out debits the account and credits cash; money in does the reverse", () => {
    expect(entryPreview({ date: "2025-03-14", description: "Boiler", amount: "-450.00", category_key: "Repairs" }, options, accounts)).toEqual({
      date: "2025-03-14", description: "Boiler",
      debit: { label: "5020 Repairs & Maintenance", amount: "450.00" },
      credit: { label: "1000 Operating Cash", amount: "450.00" },
    });
    const dues = entryPreview({ date: "2025-03-05", description: "Dues", amount: "350.00", category_key: "Regular Assessments" }, options, accounts);
    expect(dues?.debit.label).toBe("1000 Operating Cash");
    expect(dues?.credit.label).toBe("4000 Regular Assessments");
  });

  it("returns nothing for a row that cannot become an entry", () => {
    expect(entryPreview({ date: "x", description: "y", amount: "abc", category_key: "Repairs" }, options, accounts)).toBeNull();
    expect(entryPreview({ date: "x", description: "y", amount: "0.00", category_key: "Repairs" }, options, accounts)).toBeNull();
    expect(entryPreview({ date: "x", description: "y", amount: "5.00", category_key: "Nope" }, options, accounts)).toBeNull();
    expect(entryPreview({ date: "x", description: "y", amount: "5.00", category_key: "Repairs" }, {}, accounts)).toBeNull();
  });

  it("counts payments per linked contractor, money out only", () => {
    const rows = [
      { mapped: { payee: "Acme", amount: "-10.00" } },
      { mapped: { payee: "acme ", amount: "-20.00" } },
      { mapped: { payee: "Acme", amount: "5.00" } },
      { mapped: { payee: "Other", amount: "-1.00" } },
    ];
    expect(payeeLinkCounts(rows, { payee_map: { acme: "v1" } }, new Map([["v1", "Acme Plumbing"]]))).toEqual([{ name: "Acme Plumbing", count: 2 }]);
  });

  it("totals money in and out per category without floats", () => {
    const rows = [
      { mapped: { category_key: "Repairs", amount: "-0.10" } },
      { mapped: { category_key: "repairs", amount: "-0.20" } },
      { mapped: { category_key: "Repairs", amount: "1000000.01" } },
    ];
    expect(categoryTotals(rows, "category_key")).toEqual([{ key: "repairs", sample: "Repairs", count: 3, totalIn: "1000000.01", totalOut: "0.30" }]);
    expect(yearOf("2025-12-31")).toBe(2025);
    expect(yearOf("12/31/2025")).toBeNull();
  });
});

describe("messages", () => {
  it("maps database errors to the spec's words", () => {
    expect(importErrorMessage({ code: "42501" }).message).toBe("Only a board admin can import.");
    expect(importErrorMessage({ code: "22023", hint: "preview_stale" }).message).toBe("Something changed since the preview (a unit, a year, an account). Review the preview again.");
    expect(importErrorMessage({ code: "22023", hint: "batch_errors" }).message).toBe("Fix the problems at the top of the preview first.");
    expect(importErrorMessage({ code: "22023", hint: "nothing" }).message).toBe("There is nothing to import.");
    expect(importErrorMessage({ code: "23505", hint: "already_imported:abc" }).message).toBe("This file was already imported.");
    expect(importErrorMessage({ code: "23514", message: "fiscal year closed" }).message).toBe("That fiscal year is closed. Skip those rows or choose another date.");
    expect(importErrorMessage({ code: "XX000", message: "relation \"x\" does not exist" }).message).toBe(GENERIC_IMPORT_ERROR);
    expect(importErrorMessage(null).message).toBe(GENERIC_IMPORT_ERROR);
    expect(importErrorMessage({ code: "22023", message: "that year is out of range" }).message).toBe("That year is out of range.");
  });

  it("never echoes a raw database message for an unexpected code", () => {
    expect(importErrorMessage({ code: "42P01", message: "secret_table does not exist" }).message).not.toContain("secret_table");
  });

  it("finds the earlier batch in a hint, and names a heading for each code", () => {
    const id = "55555555-5555-4555-8555-555555555555";
    expect(alreadyImportedBatchId(`already_imported:${id}`)).toBe(id);
    expect(alreadyImportedBatchId("preview_stale")).toBeNull();
    expect(alreadyImportedBatchId(null)).toBeNull();
    expect(errorHeading("date_bad")).toBe("Date");
    expect(errorHeading("before_opening")).toBe("Already counted");
    expect(errorHeading("fiscal_year_closed")).toBe("Year closed");
    expect(errorHeading("something_new")).toBe("Problem");
  });
});
