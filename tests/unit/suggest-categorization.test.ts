import { describe, expect, it } from "vitest";
import { suggestCategorization, type SuggestableAccount } from "@/lib/plaid/suggest";

const UTILITIES = { id: "acc-utilities", name: "Utilities" };
const INSURANCE = { id: "acc-insurance", name: "Insurance" };
const REPAIRS = { id: "acc-repairs", name: "Repairs & Maintenance" };
const STATE_FILING = { id: "acc-state-filing", name: "State Filing Fees" };
const PROFESSIONAL = { id: "acc-professional", name: "Professional Fees" };
const BANK_FEES = { id: "acc-bank-fees", name: "Bank & Merchant Fees" };
const REGULAR_ASSESSMENTS = { id: "acc-assessments", name: "Regular Assessments" };

const expenseAccounts: SuggestableAccount[] = [
  UTILITIES,
  INSURANCE,
  REPAIRS,
  STATE_FILING,
  PROFESSIONAL,
  BANK_FEES,
];
const incomeAccounts: SuggestableAccount[] = [REGULAR_ASSESSMENTS];

describe("suggestCategorization — against real production transaction strings", () => {
  it("matches ComEd to Utilities", () => {
    expect(suggestCategorization("PPD ComEd PAYMENTS", -46, expenseAccounts, incomeAccounts)).toEqual({
      kind: "expense",
      accountId: UTILITIES.id,
    });
  });

  it("matches the water bill to Utilities", () => {
    expect(
      suggestCategorization("WEB CITY OF CHICAGO WATER BILL", -965.06, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "expense", accountId: UTILITIES.id });
  });

  it("matches Illinois Secretary of State to State Filing Fees", () => {
    expect(
      suggestCategorization("ILLINOIS SECRETARY OF", -70.55, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "expense", accountId: STATE_FILING.id });
  });

  it("corrects Plaid's own bad guess — West Bend (an insurer) mis-tagged 'Food and Drink' by Plaid", () => {
    // raw_category isn't even passed in — the description alone is enough, and
    // it must NOT be influenced by Plaid's wrong category.
    expect(
      suggestCategorization("TEL West Bend debitpmt", -3766, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "expense", accountId: INSURANCE.id });
  });

  it("suggests dues (kind only, no unit) for a mobile/DDA deposit", () => {
    const result = suggestCategorization("DDA DEPOSIT", 4350, expenseAccounts, incomeAccounts);
    expect(result).toEqual({ kind: "dues", accountId: null });
  });

  it("suggests dues for a Zelle deposit too", () => {
    expect(
      suggestCategorization("ZELLE FROM JOSIAH HOUSEGO", 500, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "dues", accountId: null });
  });

  it("suggests transfer (kind only, no account) for an outgoing bank transfer", () => {
    expect(
      suggestCategorization("TRANSFER TO CK CHASE BANK", -1519, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "transfer", accountId: null });
  });

  it("suggests transfer for an incoming WEBXFR transfer regardless of sign", () => {
    expect(
      suggestCategorization("CIE CHASBK CK WEBXFR TRANSFER", 680.37, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "transfer", accountId: null });
  });

  it("falls back to word-overlap matching for an account not in the keyword table", () => {
    expect(
      suggestCategorization("Acme Professional Fees Invoice", -200, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "expense", accountId: PROFESSIONAL.id });
  });

  it("matches a chargeback to Bank & Merchant Fees", () => {
    expect(
      suggestCategorization("RETURN ITEMS CHARGEBACK 00278", -200, expenseAccounts, incomeAccounts),
    ).toEqual({ kind: "expense", accountId: BANK_FEES.id });
  });

  it("returns null rather than guess when nothing matches", () => {
    expect(suggestCategorization("Home Depot", -30.83, expenseAccounts, incomeAccounts)).toEqual({
      kind: "expense",
      accountId: REPAIRS.id,
    });
    expect(
      suggestCategorization("CCD CITY OF CHICAGO 7596815", -1838.72, expenseAccounts, incomeAccounts),
    ).toBeNull();
  });

  it("never returns an accountId for a dues or transfer suggestion — those always need a human pick", () => {
    const dues = suggestCategorization("DDA DEPOSIT", 100, expenseAccounts, incomeAccounts);
    const transfer = suggestCategorization("WEBXFR TRANSFER", -100, expenseAccounts, incomeAccounts);
    expect(dues?.accountId).toBeNull();
    expect(transfer?.accountId).toBeNull();
  });
});
