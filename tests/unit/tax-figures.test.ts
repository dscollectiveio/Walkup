import { describe, expect, it } from "vitest";
import type { DetermineInput } from "@/lib/tax/determine";
import { figuresPack, type FiguresContext } from "@/lib/tax/figures";

const PARAMETERS: DetermineInput["parameters"] = [
  { key: "form_1120h_income_test", value: 0.6, sourceUrl: "https://www.irs.gov/instructions/i1120h", verifiedOn: null },
  { key: "form_1120h_expenditure_test", value: 0.9, sourceUrl: "https://www.irs.gov/instructions/i1120h", verifiedOn: null },
  { key: "form_1120h_rate_condo", value: 0.3, sourceUrl: "https://www.irs.gov/instructions/i1120h", verifiedOn: null },
  { key: "form_1120h_specific_deduction", value: 100, sourceUrl: "https://www.irs.gov/instructions/i1120h", verifiedOn: null },
  { key: "form_1099_nec_threshold", value: 2000, sourceUrl: "https://www.irs.gov/instructions/i1099mec", verifiedOn: null },
];

function ctx(over: Partial<FiguresContext> = {}, input: Partial<DetermineInput> = {}): FiguresContext {
  return {
    association: {
      legal_name: "2158 N. Damen Condominium Association",
      ein: "36-1234567",
      street_address: "2158 N. Damen Ave",
      city: "Chicago",
      state_code: "IL",
      postal_code: "60647",
      incorporated_on: "2004-03-11",
    },
    fiscalYear: { label: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31" },
    input: {
      association: { stateCode: "IL", incorporatedOn: "2004-03-11", ein: "36-1234567" },
      fiscalYear: { label: "2026", endsOn: "2026-12-31", taxYear: 2026 },
      contractorYear: 2026,
      figures: { exemptIncomeCents: 48_000_00, grossIncomeCents: 49_250_00, exemptExpendituresCents: 41_000_00, totalExpendituresCents: 42_500_00 },
      unconfirmedIncomeAccounts: [],
      contractors: [{ vendorId: "v1", name: "Damen Plumbing", totalCents: 2_400_00, w9OnFile: true }],
      parameters: PARAMETERS,
      templates: [],
      today: new Date("2026-10-11T12:00:00"),
      ...input,
    },
    incomeAccounts: [
      { name: "Assessments", isExempt: true, totalCents: 48_000_00 },
      { name: "Interest Income", isExempt: false, totalCents: 350_00 },
      { name: "Laundry Income", isExempt: false, totalCents: 900_00 },
    ],
    receiptLineIds: { exempt: ["r1", "r2", "r3"], nonexempt: ["r4", "r5"] },
    disbursementLineIds: { exempt: ["d1", "d2"], all: ["d1", "d2", "d3"] },
    contractorRows: [
      { vendorId: "v1", name: "Damen Plumbing", address: "1200 W. Fullerton Ave, Chicago, IL 60614", totalCents: 2_400_00, paymentCount: 3, w9OnFile: true },
    ],
    ...over,
  };
}

const ZERO: Partial<DetermineInput> = { figures: { exemptIncomeCents: 0, grossIncomeCents: 0, exemptExpendituresCents: 0, totalExpendituresCents: 0 } };
const form1120h = { formCode: "irs_1120h", taxYear: 2026, vendorId: null };
const form1099 = { formCode: "irs_1099_nec", taxYear: 2026, vendorId: "v1" };
const titles = (sections: ReturnType<typeof figuresPack>) => sections.map((s) => s.title);
const section = (sections: ReturnType<typeof figuresPack>, title: string) => sections.find((s) => s.title === title)!;
const row = (sections: ReturnType<typeof figuresPack>, title: string, label: string) => section(sections, title).rows.find((r) => r.label === label)!;

describe("figuresPack", () => {
  it("has every section, each with rows, even when every figure is zero", () => {
    const empty = ctx({ incomeAccounts: [], receiptLineIds: { exempt: [], nonexempt: [] }, disbursementLineIds: { exempt: [], all: [] } }, ZERO);
    const pack = figuresPack(empty, form1120h);
    expect(titles(pack)).toEqual([
      "About the association",
      "1120-H figures (cash basis)",
      "Income that isn't owner fees, by account",
      "1120-H tests",
      "Estimated tax (provisional)",
    ]);
    for (const s of pack) expect(s.rows.length, s.title).toBeGreaterThan(0);
    expect(row(pack, "1120-H figures (cash basis)", "Gross income")).toMatchObject({ value: "$0.00", note: "0 receipts — owner fees plus everything else" });
    expect(section(pack, "Income that isn't owner fees, by account").rows).toEqual([{ label: "No income other than owner fees recorded this fiscal year", value: "$0.00" }]);
    expect(row(pack, "1120-H tests", "Owner fees ÷ gross income (the income test)").value).toBe("n/a — no gross income recorded — passes (needs 60%)");
    expect(row(pack, "Estimated tax (provisional)", "Estimated tax before any deductions").value).toBe("$0.00");
  });

  it("describes the association, with 'not on file' where a field is empty", () => {
    const about = section(figuresPack(ctx(), form1120h), "About the association").rows;
    expect(about).toEqual([
      { label: "Legal name", value: "2158 N. Damen Condominium Association" },
      { label: "EIN", value: "36-1234567" },
      { label: "Address", value: "2158 N. Damen Ave, Chicago, IL 60647" },
      { label: "Incorporated on", value: "March 11, 2004" },
      { label: "Fiscal year", value: "2026 (January 1, 2026 to December 31, 2026)" },
    ]);
    const bare = ctx({ association: { ...ctx().association, ein: null, street_address: null, city: null, postal_code: null, incorporated_on: null } });
    const rows = section(figuresPack(bare, form1120h), "About the association").rows;
    expect(rows.find((r) => r.label === "EIN")!.value).toBe("Not on file — add it in Building Info");
    expect(rows.find((r) => r.label === "Address")!.value).toBe("IL");
    expect(rows.find((r) => r.label === "Incorporated on")!.value).toBe("Not on file — add it in Building Info");
  });

  it("gives the five cash-basis figures with their transaction counts, and the non-exempt income by account", () => {
    const pack = figuresPack(ctx(), form1120h);
    expect(section(pack, "1120-H figures (cash basis)").rows).toEqual([
      { label: "Owner fees (exempt function income)", value: "$48,000.00", note: "3 receipts" },
      { label: "Income that isn't owner fees", value: "$1,250.00", note: "2 receipts" },
      { label: "Gross income", value: "$49,250.00", note: "5 receipts — owner fees plus everything else" },
      { label: "Spending on the building (exempt function expenditures)", value: "$41,000.00", note: "2 payments" },
      { label: "Total spending", value: "$42,500.00", note: "3 payments" },
    ]);
    expect(section(pack, "Income that isn't owner fees, by account").rows).toEqual([
      { label: "Laundry Income", value: "$900.00" },
      { label: "Interest Income", value: "$350.00" },
    ]);
  });

  it("runs both tests through determine.ts and says whether a person has checked each threshold", () => {
    const tests = section(figuresPack(ctx(), form1120h), "1120-H tests").rows;
    expect(tests).toHaveLength(2);
    expect(tests[0]).toEqual({
      label: "Owner fees ÷ gross income (the income test)",
      value: "97.5% — passes (needs 60%)",
      note: "Threshold 60% from https://www.irs.gov/instructions/i1120h — not yet checked against this year's instructions",
    });
    expect(tests[1].value).toBe("96.5% — passes (needs 90%)");

    const verified = PARAMETERS.map((p) => ({ ...p, verifiedOn: "2026-10-11" }));
    const failing = figuresPack(ctx({}, { parameters: verified, figures: { exemptIncomeCents: 5_000_00, grossIncomeCents: 10_000_00, exemptExpendituresCents: 1, totalExpendituresCents: 1 } }), form1120h);
    expect(row(failing, "1120-H tests", "Owner fees ÷ gross income (the income test)")).toMatchObject({ value: "50% — fails (needs 60%)" });
    expect(row(failing, "1120-H tests", "Owner fees ÷ gross income (the income test)").note).toContain("checked by a person");

    const unclassified = figuresPack(ctx({}, { unconfirmedIncomeAccounts: ["Laundry Income"] }), form1120h);
    expect(row(unclassified, "1120-H tests", "Income still to classify")).toMatchObject({ value: "1 account", note: expect.stringContaining("Laundry Income") });
  });

  it("estimates the tax from tax_parameters only, and says so when they aren't on file", () => {
    const est = section(figuresPack(ctx(), form1120h), "Estimated tax (provisional)").rows;
    expect(est.map((r) => [r.label, r.value])).toEqual([
      ["Income that isn't owner fees", "$1,250.00"],
      ["Specific deduction", "−$100.00"],
      ["Taxable income (estimate)", "$1,150.00"],
      ["Rate", "30%"],
      ["Estimated tax before any deductions", "$345.00"],
    ]);
    expect(est[1].note).toContain("not yet checked against this year's instructions");
    expect(est[4].note).toContain("Ask your CPA");

    const none = figuresPack(ctx({}, { parameters: [] }), form1120h);
    expect(section(none, "1120-H tests").rows[0]).toMatchObject({ value: "Can't be run", note: expect.stringContaining("ask your CPA") });
    expect(section(none, "Estimated tax (provisional)").rows).toEqual([
      { label: "Estimated tax", value: "Can't be estimated", note: "The rate or specific deduction isn't on file in Walkup — ask your CPA." },
    ]);
  });

  it("adds the contractor section only for a 1099-NEC, after the association", () => {
    expect(titles(figuresPack(ctx(), form1120h))).not.toContain("Contractor");
    expect(titles(figuresPack(ctx(), { formCode: "irs_1096", taxYear: 2026, vendorId: null }))).not.toContain("Contractor");
    const pack = figuresPack(ctx(), form1099);
    expect(titles(pack).slice(0, 2)).toEqual(["About the association", "Contractor"]);
    expect(section(pack, "Contractor").rows).toEqual([
      { label: "Name", value: "Damen Plumbing" },
      { label: "Address", value: "1200 W. Fullerton Ave, Chicago, IL 60614" },
      { label: "Total paid in 2026", value: "$2,400.00", note: "Every payment we recorded; card payments are reported by the processor instead." },
      { label: "Payments", value: "3" },
      { label: "W-9 on file", value: "Yes", note: undefined },
      { label: "Taxpayer ID", value: "Not stored in Walkup — copy it from the W-9", note: "Walkup keeps only the last four digits, by design." },
    ]);
    const missing = figuresPack(ctx(), { ...form1099, vendorId: "nobody" });
    expect(section(missing, "Contractor").rows[0].value).toBe("Not found among this year's contractor payments");
    const noW9 = figuresPack(ctx({ contractorRows: [{ ...ctx().contractorRows[0], w9OnFile: false, address: null }] }), form1099);
    expect(row(noW9, "Contractor", "W-9 on file")).toEqual({ label: "W-9 on file", value: "No", note: "Ask for a W-9 before preparing the 1099." });
    expect(row(noW9, "Contractor", "Address").value).toBe("Not on file — add it on the Contractors page");
  });

  it("never carries a contractor TIN — not even one typed into a name or address", () => {
    const leaky = ctx({
      contractorRows: [{ vendorId: "v1", name: "Damen Plumbing (TIN 12-3456789)", address: "SSN 123-45-6789 on file", totalCents: 2_400_00, paymentCount: 1, w9OnFile: true }],
    });
    const contractor = section(figuresPack(leaky, form1099), "Contractor");
    const text = JSON.stringify(contractor);
    expect(text).not.toMatch(/\d{2}-\d{7}/);
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(text).not.toMatch(/\d{9,}/);
    expect(contractor.rows[0].value).toBe("Damen Plumbing (TIN [removed])");
  });
});
