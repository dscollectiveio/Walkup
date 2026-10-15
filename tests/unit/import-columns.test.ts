import { describe, expect, it } from "vitest";
import { detectColumns, isSensitiveHeader, normalizeHeader, sampleDates } from "@/lib/import/columns";
import { missingRequired, missingRequiredSentence } from "@/lib/import/kinds";

describe("detectColumns", () => {
  it("matches a bank export (Date, Description, Amount, Balance, Category)", () => {
    const d = detectColumns("transactions", ["Date", "Description", "Amount", "Running Balance", "Category"], [["3/14/2026", "Boiler", "-450.00", "1000.00", "Repairs"]]);
    expect(d.mapping).toMatchObject({ date: 0, description: 1, amount: 2, category_key: 4, money_in: null, money_out: null });
    expect(d.unmapped.map((u) => u.header)).toEqual(["Running Balance"]);
    expect(d.detected.find((x) => x.field === "date")).toMatchObject({ score: 1, reason: "exact" });
  });

  it("matches a QuickBooks-style export with separate debit and credit columns", () => {
    const d = detectColumns("transactions", ["Transaction Date", "Name", "Memo", "Account", "Debit", "Credit"], []);
    expect(d.mapping).toMatchObject({ date: 0, description: 2, category_key: 3, money_out: 4, money_in: 5, amount: null });
  });

  it("matches a bank CSV with Posted Date, Payee, Withdrawals and Deposits", () => {
    const d = detectColumns("transactions", ["Posted Date", "Payee", "Details", "Withdrawals", "Deposits", "Class"], []);
    expect(d.mapping).toMatchObject({ date: 0, payee: 1, description: 2, money_out: 3, money_in: 4, category_key: 5 });
  });

  it("matches units and owners with punctuation, case and a contains match", () => {
    const d = detectColumns("units_owners", ["UNIT #", "Owner Name", "E-mail", "Cell", "Mailing Address", "% Ownership", "Monthly Dues"], []);
    expect(d.mapping).toMatchObject({ unit_label: 0, owner_name: 1, email: 2, phone: 3, mailing_address: 4, ownership_percent: 5, dues_amount: 6 });
    const contains = detectColumns("units_owners", ["Unit Number (see map)", "Primary Owner Email Address"], []);
    expect(contains.mapping).toMatchObject({ unit_label: 0, email: 1 });
    expect(contains.detected.find((x) => x.field === "email")?.reason).toBe("contains");
  });

  it("uses each column and each field once, and ties go to the earlier column", () => {
    const d = detectColumns("units_owners", ["Email", "Email", "Name", "Name"], []);
    expect(d.mapping.email).toBe(0);
    expect(d.mapping.owner_name).toBe(2);
    expect(d.unmapped.map((u) => u.index)).toEqual([1, 3]);
  });

  it("never maps a very short synonym by containment", () => {
    const d = detectColumns("transactions", ["Check In Date", "Plug"], []);
    expect(d.mapping.money_in).toBeNull();
  });

  it("sniffs unmatched columns by their values and calls it a guess", () => {
    const d = detectColumns("transactions", ["When", "Words", "Cash"], [
      ["3/14/2026", "Boiler", "-450.00"],
      ["Mar 15, 2026", "Dues", "$350.00"],
    ]);
    expect(d.mapping.date).toBe(0);
    expect(d.mapping.amount).toBe(2);
    expect(d.detected.find((x) => x.field === "date")).toMatchObject({ reason: "values", score: 0.5 });
  });

  it("does not take a column of whole numbers for money or for dates", () => {
    const d = detectColumns("transactions", ["Ref", "Seq"], [["1", "10"], ["2", "11"], ["3", "12"]]);
    expect(d.mapping.amount).toBeNull();
    expect(d.mapping.date).toBeNull();
  });

  it("never maps sensitive headers and flags them", () => {
    const headers = ["Unit", "Owner name", "SSN", "Tax ID", "Routing #", "Account Number", "Social Security Number", "Acct", "Card", "Password", "Email"];
    const d = detectColumns("units_owners", headers, [["Unit 1", "Ada", "123-45-6789", "12-3456789", "021000021", "000123", "123-45-6789", "1", "4111", "x", "ada@example.com"]]);
    const mappedIndexes = Object.values(d.mapping).filter((v): v is number => v !== null);
    for (const i of [2, 3, 4, 5, 6, 7, 8, 9]) expect(mappedIndexes).not.toContain(i);
    expect(d.unmapped.filter((u) => u.sensitive).map((u) => u.header)).toEqual(["SSN", "Tax ID", "Routing #", "Account Number", "Social Security Number", "Acct", "Card", "Password"]);
    expect(d.mapping).toMatchObject({ unit_label: 0, owner_name: 1, email: 10 });
  });

  it("detects the opening balance files", () => {
    expect(detectColumns("opening_accounts", ["Account", "Fund", "Debit", "Credit"], []).mapping).toEqual({ account_key: 0, fund_key: 1, debit: 2, credit: 3 });
    expect(detectColumns("opening_units", ["Unit", "Amount owed"], []).mapping).toEqual({ unit_label: 0, amount: 1 });
    expect(detectColumns("contractors", ["Company", "Trade", "Contact", "Email", "Phone", "Website", "Notes"], []).mapping).toMatchObject({ name: 0, trade: 1, contact_name: 2, website: 5, notes: 6 });
  });
});

describe("isSensitiveHeader", () => {
  it("flags tax ID and account number headers and nothing ordinary", () => {
    for (const h of ["SSN", "ssn", "Tax ID", "Tax_ID", "TIN", "EIN", "Taxpayer ID", "Routing #", "Account No", "Bank Account", "Social Security", "PIN", "CVV"]) {
      expect(isSensitiveHeader(h), h).toBe(true);
    }
    for (const h of ["Unit", "Owner name", "Account", "Amount", "Description", "Pinned", "Casino", "Notes"]) {
      expect(isSensitiveHeader(h), h).toBe(false);
    }
  });
});

describe("helpers", () => {
  it("normalises headers", () => {
    expect(normalizeHeader(" Unit  # ")).toBe("unit #");
    expect(normalizeHeader("E-Mail Address")).toBe("e mail address");
  });
  it("previews three dates under a chosen order", () => {
    expect(sampleDates(["3/4/2026", "", "13/4/2026", "x", "5/6/2026"], "mdy")).toEqual(["2026-03-04", null, null]);
    expect(sampleDates(["3/4/2026", "13/4/2026"], "dmy")).toEqual(["2026-04-03", "2026-04-13"]);
  });
  it("says what is still to match", () => {
    expect(missingRequired("transactions", { date: 0, description: null, amount: null, category_key: 3 })).toEqual(["Description", "Amount"]);
    expect(missingRequired("transactions", { date: 0, description: 1, money_in: 2, category_key: 3 })).toEqual([]);
    expect(missingRequired("opening_accounts", { account_key: 0, fund_key: 1 })).toEqual(["Debit or Credit"]);
    expect(missingRequiredSentence(["Date", "Description", "Amount"])).toBe("Match Date, Description and Amount to continue.");
    expect(missingRequiredSentence(["Unit"])).toBe("Match Unit to continue.");
    expect(missingRequiredSentence([])).toBe("");
  });
});
