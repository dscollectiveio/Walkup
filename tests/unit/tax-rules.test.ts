import { describe, expect, it } from "vitest";
import { dueDate, fiscalRuleSkipsJune, parseDueRule } from "@/lib/tax/due-rules";
import { ELIGIBLE_1120H_REASON, determineForms, type DetermineInput } from "@/lib/tax/determine";
import {
  SETTING_KEYS,
  autofill,
  derivedSettings,
  isReadyToSign,
  mergeWithExisting,
  type FieldMap,
  type FilledField,
} from "@/lib/tax/autofill";

const today = new Date("2026-09-30T12:00:00");

describe("due rules", () => {
  it("reads the three rule shapes and refuses anything else", () => {
    expect(parseDueRule("FY_END + 4 MONTHS, DAY 15")).toEqual({ kind: "fy", months: 4, day: "15" });
    expect(parseDueRule("cal_year_end + 1 month, day 31")).toEqual({ kind: "cal", months: 1, day: "31" });
    expect(parseDueRule("INCORPORATION_ANNIVERSARY_MONTH, DAY 1")).toEqual({ kind: "anniv", months: 0, day: "1" });
    expect(parseDueRule("April 15")).toBeNull();
  });

  it("reads the anniversary month plus or minus a number of months, and nothing looser", () => {
    expect(parseDueRule("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST")).toEqual({ kind: "anniv", months: -1, day: "LAST" });
    expect(parseDueRule("incorporation_anniversary_month + 2 months, day 15")).toEqual({ kind: "anniv", months: 2, day: "15" });
    expect(parseDueRule("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTH, DAY 31")).toEqual({ kind: "anniv", months: -1, day: "31" });
    expect(parseDueRule("INCORPORATION_ANNIVERSARY_MONTH - MONTHS, DAY LAST")).toBeNull();
    expect(parseDueRule("FY_END - 1 MONTHS, DAY 15")).toBeNull();
  });

  it("computes dates from the fiscal year end, the calendar year, or the incorporation month", () => {
    const ctx = { fiscalYearEnd: "2026-12-31", calendarYear: 2026, incorporatedOn: "2004-03-11", today };
    expect(dueDate("FY_END + 4 MONTHS, DAY 15", ctx)).toBe("2027-04-15");
    expect(dueDate("FY_END + 4 MONTHS, DAY 15", { ...ctx, fiscalYearEnd: "2027-06-30" })).toBe("2027-10-15");
    expect(dueDate("CAL_YEAR_END + 1 MONTHS, DAY 31", ctx)).toBe("2027-01-31");
    expect(dueDate("CAL_YEAR_END + 2 MONTHS, DAY LAST", ctx)).toBe("2027-02-28");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH, DAY 1", ctx)).toBe("2027-03-01");
  });

  it("offsets the anniversary month and gives the next occurrence on or after today", () => {
    const march = { fiscalYearEnd: null, calendarYear: null, incorporatedOn: "2004-03-11", today };
    // The Illinois annual report: the last day of the month before the anniversary month.
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", march)).toBe("2027-02-28");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { ...march, today: new Date("2026-02-10T12:00:00") })).toBe("2026-02-28");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { ...march, today: new Date("2026-02-28T12:00:00") })).toBe("2026-02-28");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { ...march, today: new Date("2028-02-29T12:00:00") })).toBe("2028-02-29");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH + 1 MONTHS, DAY 15", march)).toBe("2027-04-15");
    // A December anniversary plus a month lands in January of the next year.
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH + 1 MONTHS, DAY 31", { ...march, incorporatedOn: "1999-12-02" })).toBe("2027-01-31");
  });

  it("handles a January anniversary minus one month — December 31 of the prior year", () => {
    const january = { fiscalYearEnd: null, calendarYear: null, incorporatedOn: "2010-01-15", today };
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", january)).toBe("2026-12-31");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { ...january, today: new Date("2026-12-31T12:00:00") })).toBe("2026-12-31");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { ...january, today: new Date("2027-01-01T12:00:00") })).toBe("2027-12-31");
  });

  it("flags a fiscal-year rule for a June-30 year end, which the general rule can't cover", () => {
    expect(fiscalRuleSkipsJune("FY_END + 4 MONTHS, DAY 15", "2027-06-30")).toBe(true);
    expect(fiscalRuleSkipsJune("FY_END + 4 MONTHS, DAY 15", "2026-12-31")).toBe(false);
    expect(fiscalRuleSkipsJune("CAL_YEAR_END + 1 MONTHS, DAY 31", "2027-06-30")).toBe(false);
    expect(fiscalRuleSkipsJune(null, "2027-06-30")).toBe(false);
    expect(fiscalRuleSkipsJune("FY_END + 4 MONTHS, DAY 15", null)).toBe(false);
  });

  it("returns null without a rule or the date it depends on — never a guess", () => {
    expect(dueDate(null, { fiscalYearEnd: "2026-12-31", calendarYear: 2026, incorporatedOn: null, today })).toBeNull();
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH, DAY 1", { fiscalYearEnd: null, calendarYear: null, incorporatedOn: null, today })).toBeNull();
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", { fiscalYearEnd: null, calendarYear: null, incorporatedOn: null, today })).toBeNull();
  });
});

function input(over: Partial<DetermineInput> = {}): DetermineInput {
  return {
    association: { stateCode: "IL", incorporatedOn: "2004-03-11", ein: "36-0000000", informationReturnsFiling: null },
    fiscalYear: { label: "2026", endsOn: "2026-12-31", taxYear: 2026 },
    contractorYear: 2026,
    figures: {
      exemptIncomeCents: 9_500_00,
      grossIncomeCents: 10_000_00,
      exemptExpendituresCents: 9_800_00,
      totalExpendituresCents: 10_000_00,
    },
    unconfirmedIncomeAccounts: [],
    contractors: [],
    parameters: [
      { key: "form_1120h_income_test", value: 0.6, sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120-h", verifiedOn: null },
      { key: "form_1120h_expenditure_test", value: 0.9, sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120-h", verifiedOn: null },
      { key: "form_1099_nec_threshold", value: 600, sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-nec", verifiedOn: null },
    ],
    templates: [],
    today,
    ...over,
  };
}

describe("determineForms", () => {
  it("asks for a CPA on 1120-H while any income is unclassified", () => {
    const f = determineForms(input({ unconfirmedIncomeAccounts: ["Interest Income"] })).find((x) => x.formCode === "irs_1120h")!;
    expect(f.determination).toBe("ask_cpa");
    expect(f.reason).toBe("Some income isn't classified yet. Classify it to check whether you qualify.");
  });

  it("gives a June-30 fiscal year no due date from a FY_END rule, keeping the template's note", () => {
    const templates = [
      { formCode: "irs_1120h", taxYear: 2027, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "Instructions for Form 1120-H, When To File", notes: "June 30 year ends: the 3rd month.", verified: true },
    ];
    const f = determineForms(input({ fiscalYear: { label: "2026–27", endsOn: "2027-06-30", taxYear: 2027 }, templates })).find((x) => x.formCode === "irs_1120h")!;
    expect(f.dueOn).toBeNull();
    expect(f.dueCitation).toBeNull();
    expect(f.note).toBe("June 30 year ends: the 3rd month.");
    const dec = determineForms(input({ fiscalYear: { label: "2027", endsOn: "2027-12-31", taxYear: 2027 }, templates })).find((x) => x.formCode === "irs_1120h")!;
    expect(dec.dueOn).toBe("2028-04-15");
  });

  it("says the association qualifies for 1120-H when both tests pass — an election, never 'required' — citing where the thresholds came from", () => {
    const f = determineForms(input()).find((x) => x.formCode === "irs_1120h")!;
    expect(f.determination).toBe("eligible");
    expect(f.reason.startsWith(ELIGIBLE_1120H_REASON)).toBe(true);
    expect(f.reason).toContain("Ask your CPA whether 1120-H or Form 1120 is better this year.");
    expect(f.reason).toContain("irs.gov");
    expect(f.reason).toContain("not yet verified");
    expect(f.name).toBe("Form 1120-H");
    expect(f.note).toBeNull();
  });

  it("flags 1120 as likely when a test fails", () => {
    const forms = determineForms(input({ figures: { exemptIncomeCents: 5_000_00, grossIncomeCents: 10_000_00, exemptExpendituresCents: 1, totalExpendituresCents: 1 } }));
    expect(forms.find((x) => x.formCode === "irs_1120h")!.determination).toBe("not_required");
    const f1120 = forms.find((x) => x.formCode === "irs_1120")!;
    expect(f1120.determination).toBe("likely_required");
    expect(f1120.reason).toBe("Your association may not qualify for 1120-H this year. Talk to a CPA before filing.");
    expect(f1120.name).toBe("Form 1120");
  });

  it("warns when a test is within 5 points of its threshold", () => {
    const f = determineForms(input({ figures: { exemptIncomeCents: 6_200_00, grossIncomeCents: 10_000_00, exemptExpendituresCents: 1, totalExpendituresCents: 1 } }))
      .find((x) => x.formCode === "irs_1120h")!;
    expect(f.warnings.some((w) => w.includes("within 5 points"))).toBe(true);
  });

  it("never assumes Illinois rules, and asks about the SOS due date until a rule is recorded", () => {
    const forms = determineForms(input());
    expect(forms.find((x) => x.formCode === "il_1120")!.determination).toBe("ask_cpa");
    const sos = forms.find((x) => x.formCode === "il_sos_annual_report")!;
    expect(sos.determination).toBe("ask_cpa");
    expect(sos.reason).toBe("Confirm your annual report due date with the Illinois Secretary of State.");
    expect(sos.name).toBe("Illinois annual report");
  });

  it("lists no Illinois forms for a building in another state", () => {
    const codes = determineForms(input({ association: { stateCode: "NH", incorporatedOn: "2004-03-11", ein: null } })).map((f) => f.formCode);
    expect(codes).not.toContain("il_1120");
    expect(codes).not.toContain("il_sos_annual_report");
  });

  it("uses a verified template's due rule once one exists", () => {
    const forms = determineForms(
      input({
        templates: [
          { formCode: "il_sos_annual_report", taxYear: 2026, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 1", dueRuleCitation: "805 ILCS 105/114.10", notes: null, verified: true },
          { formCode: "irs_1120h", taxYear: 2026, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "Form 1120-H instructions, When To File", notes: null, verified: true },
        ],
      }),
    );
    expect(forms.find((x) => x.formCode === "il_sos_annual_report")!.dueOn).toBe("2027-03-01");
    expect(forms.find((x) => x.formCode === "irs_1120h")!.dueOn).toBe("2027-04-15");
  });

  it("ignores an unverified template's rule", () => {
    const f = determineForms(
      input({ templates: [{ formCode: "irs_1120h", taxYear: 2026, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "x", notes: null, verified: false }] }),
    ).find((x) => x.formCode === "irs_1120h")!;
    expect(f.dueOn).toBeNull();
  });

  it("carries the verified template's notes on the outcome, and only a verified one's", () => {
    const notes = "Illinois DOR: an association that files federal Form 1120-H must file Form IL-1120. Walkup doesn't fill IL-1120.";
    const verified = determineForms(
      input({ templates: [{ formCode: "il_1120", taxYear: 2026, dueRule: null, dueRuleCitation: null, notes, verified: true }] }),
    ).find((x) => x.formCode === "il_1120")!;
    expect(verified.note).toBe(notes);
    expect(verified.reason).toBe("Illinois filing rules for associations vary. Confirm with a CPA.");
    expect(verified.determination).toBe("ask_cpa");
    const unverified = determineForms(
      input({ templates: [{ formCode: "il_1120", taxYear: 2026, dueRule: null, dueRuleCitation: null, notes, verified: false }] }),
    ).find((x) => x.formCode === "il_1120")!;
    expect(unverified.note).toBeNull();
  });

  it("applies the newest verified annual-report template to any year — the statute doesn't change with the tax year", () => {
    const forms = determineForms(
      input({
        templates: [
          { formCode: "il_sos_annual_report", taxYear: 2023, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 1", dueRuleCitation: "older reading", notes: null, verified: true },
          { formCode: "il_sos_annual_report", taxYear: 2024, dueRule: "INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST", dueRuleCitation: "805 ILCS 105/114.10", notes: "Illinois not-for-profit corporations only.", verified: true },
          { formCode: "il_sos_annual_report", taxYear: 2026, dueRule: "INCORPORATION_ANNIVERSARY_MONTH, DAY 15", dueRuleCitation: "unverified", notes: null, verified: false },
        ],
      }),
    );
    const sos = forms.find((x) => x.formCode === "il_sos_annual_report")!;
    expect(sos.determination).toBe("required");
    expect(sos.dueOn).toBe("2027-02-28");
    expect(sos.dueCitation).toBe("805 ILCS 105/114.10");
    expect(sos.note).toBe("Illinois not-for-profit corporations only.");
    expect(sos.taxYear).toBe(2026);
  });

  it("requires a 1099-NEC per contractor at or above the threshold and flags missing W-9s", () => {
    const forms = determineForms(
      input({
        contractors: [
          { vendorId: "a", name: "Damen Plumbing", totalCents: 600_00, w9OnFile: false },
          { vendorId: "b", name: "Snow Co", totalCents: 599_99, w9OnFile: true },
        ],
      }),
    );
    const nec = forms.filter((x) => x.formCode === "irs_1099_nec");
    expect(nec.map((n) => n.vendorId)).toEqual(["a"]);
    expect(nec[0].name).toBe("1099-NEC — Damen Plumbing");
    expect(nec[0].warnings).toEqual(["Get a W-9 from Damen Plumbing before preparing their 1099."]);
  });

  it("decides Form 1096 from how the association files 1099s: paper → required, electronic → not required, unknown → ask your CPA", () => {
    const contractors = [{ vendorId: "a", name: "Damen Plumbing", totalCents: 600_00, w9OnFile: true }];
    const f1096 = (informationReturnsFiling: "paper" | "electronic" | null) =>
      determineForms(input({ contractors, association: { stateCode: "IL", incorporatedOn: "2004-03-11", ein: null, informationReturnsFiling } })).find(
        (x) => x.formCode === "irs_1096",
      )!;
    const paper = f1096("paper");
    expect(paper.determination).toBe("required");
    expect(paper.reason).toContain("Damen Plumbing");
    const electronic = f1096("electronic");
    expect(electronic.determination).toBe("not_required");
    expect(electronic.reason).toContain("paper");
    const unknown = f1096(null);
    expect(unknown.determination).toBe("ask_cpa");
    expect(unknown.reason).toContain("ask your CPA");
    expect(unknown.name).toBe("Form 1096");
    for (const f of [paper, electronic, unknown]) expect(f.determination).not.toBe("optional");
    // An association that hasn't said yet is treated the same as one that said nothing.
    expect(determineForms(input({ contractors, association: { stateCode: "IL", incorporatedOn: null, ein: null } })).find((x) => x.formCode === "irs_1096")!.determination).toBe("ask_cpa");
  });

  it("never lists Form 1096 without a 1099 to send with it", () => {
    expect(determineForms(input()).find((x) => x.formCode === "irs_1096")).toBeUndefined();
    expect(
      determineForms(input({ association: { stateCode: "IL", incorporatedOn: null, ein: null, informationReturnsFiling: "paper" } })).find((x) => x.formCode === "irs_1096"),
    ).toBeUndefined();
  });
});

describe("autofill", () => {
  const map: FieldMap = {
    name: { label: "Name", section: "Header", source: "setting", rule: "association.legal_name", citation: "Form 1120-H, name line" },
    ein: { label: "EIN", section: "Header", source: "setting", rule: "association.ein", citation: "Form 1120-H, box B" },
    l1: { label: "Exempt income", section: "Part I", source: "ledger", rule: "exempt_income", citation: "Instructions, line 1" },
    l2: { label: "Gross income", section: "Part I", source: "ledger", rule: "gross_income", citation: "Instructions, line 2" },
    l3: { label: "Line 2 minus line 1", section: "Part I", source: "calculated", rule: "max0(sub(l2, l1))", citation: "Line 3 as printed" },
    tax: { label: "Tax", section: "Part II", source: "calculated", rule: "mul(l3, param:form_1120h_rate_condo)", citation: "Line 21" },
    unmapped: { label: "No citation", source: "setting", rule: "association.legal_name", citation: "" },
    tin: { label: "Recipient TIN", source: "contractors", rule: "contractor.tin", citation: "Box 1" },
  };
  const base = {
    settings: { "association.legal_name": "2158 N. Damen Condominium Association", "association.ein": null },
    ledger: { exempt_income: { cents: 9_000_00, refs: ["a", "b"] }, gross_income: { cents: 10_000_00, refs: ["a", "b", "c"] } },
    ledgerSettled: true,
    ledgerReviewReason: null,
    contractor: null,
    contractors: null,
    parameters: { form_1120h_rate_condo: 0.3 },
  };

  it("fills from settings, ledger and cited formulas, and leaves the rest blank", () => {
    const byName = new Map(autofill(map, base).map((f) => [f.pdfFieldName, f]));
    expect(byName.get("name")).toMatchObject({ value: "2158 N. Damen Condominium Association", confidence: "high", source: "setting" });
    expect(byName.get("ein")).toMatchObject({ value: null, confidence: "blank" });
    expect(byName.get("l1")).toMatchObject({ value: "9000.00", confidence: "high" });
    expect(byName.get("l1")!.sourceRef).toMatchObject({ count: 2 });
    expect(byName.get("l3")).toMatchObject({ value: "1000.00", confidence: "high" });
    expect(byName.get("tax")).toMatchObject({ value: "300.00" });
    expect(byName.get("unmapped")!.confidence).toBe("blank");
    expect(byName.get("tin")!.confidence).toBe("blank");
  });

  it("marks ledger figures (and what's computed from them) for review when the ledger isn't settled", () => {
    const byName = new Map(autofill(map, { ...base, ledgerSettled: false }).map((f) => [f.pdfFieldName, f]));
    expect(byName.get("l1")!.confidence).toBe("review");
    expect(byName.get("l3")!.confidence).toBe("review");
  });

  // The 1120-H income and tax lines: the board types lines 1–7 and 9–15; everything after is arithmetic.
  const lines: FieldMap = {
    l2: { label: "Taxable interest", section: "3. Gross income", source: "manual", rule: "", citation: "Line 2", kind: "money", zeroOk: true },
    l7: { label: "Other income", section: "3. Gross income", source: "manual", rule: "", citation: "Line 7", kind: "money", zeroOk: true },
    l8: { label: "Gross income", section: "3. Gross income", source: "calculated", rule: "add(l2, l7)", citation: "Line 8", kind: "money" },
    l16: { label: "Total deductions", section: "4. Deductions", source: "manual", rule: "", citation: "Line 16", kind: "money", zeroOk: true },
    l17: { label: "Taxable income before the specific deduction", section: "4. Deductions", source: "calculated", rule: "sub(l8, l16)", citation: "Line 17" },
    l19: { label: "Taxable income", section: "5. Tax", source: "calculated", rule: "max0(sub(l17, param:form_1120h_specific_deduction))", citation: "Line 19" },
    l20: { label: "Tax", section: "5. Tax", source: "calculated", rule: "mul(l19, param:form_1120h_rate_condo)", citation: "Line 20" },
  };
  const params = { form_1120h_rate_condo: 0.3, form_1120h_specific_deduction: 100 };

  it("feeds what the person entered on manual lines into add, sub, mul and max0 — and never proposes the manual lines themselves", () => {
    const byName = new Map(
      autofill(lines, {
        ...base,
        parameters: params,
        entered: { l2: { value: "1,250.00", leaveBlank: false }, l7: { value: "$50", leaveBlank: false }, l16: { value: "300", leaveBlank: false } },
      }).map((f) => [f.pdfFieldName, f]),
    );
    expect(byName.get("l8")).toMatchObject({ value: "1300.00", confidence: "high", source: "calculated" });
    expect(byName.get("l17")).toMatchObject({ value: "1000.00", confidence: "high" });
    expect(byName.get("l19")).toMatchObject({ value: "900.00", confidence: "high" });
    expect(byName.get("l20")).toMatchObject({ value: "270.00", confidence: "high" });
    expect(byName.get("l2")).toMatchObject({ value: null, confidence: "blank", source: "manual" });
  });

  it("counts a line the person chose to leave blank as zero, and max0 keeps a negative result at zero", () => {
    const byName = new Map(
      autofill(lines, {
        ...base,
        parameters: params,
        entered: { l2: { value: "40", leaveBlank: false }, l7: { value: null, leaveBlank: true }, l16: { value: null, leaveBlank: true } },
      }).map((f) => [f.pdfFieldName, f]),
    );
    expect(byName.get("l8")!.value).toBe("40.00");
    expect(byName.get("l17")!.value).toBe("40.00");
    expect(byName.get("l19")!.value).toBe("0.00");
    expect(byName.get("l20")!.value).toBe("0.00");
  });

  it("leaves a calculation blank while any manual line it reads is still undecided", () => {
    const byName = new Map(
      autofill(lines, { ...base, parameters: params, entered: { l2: { value: "40", leaveBlank: false }, l7: { value: "10", leaveBlank: false } } }).map((f) => [
        f.pdfFieldName,
        f,
      ]),
    );
    expect(byName.get("l8")!.value).toBe("50.00");
    expect(byName.get("l17")).toMatchObject({ value: null, confidence: "blank" });
    expect(byName.get("l19")).toMatchObject({ value: null, confidence: "blank" });
    expect(byName.get("l20")).toMatchObject({ value: null, confidence: "blank" });
    // Without any entries at all (an older caller), nothing calculated from a manual line fills.
    const none = new Map(autofill(lines, { ...base, parameters: params }).map((f) => [f.pdfFieldName, f]));
    expect(none.get("l8")!.value).toBeNull();
    // Something that isn't a number is undecided, not zero.
    const words = new Map(autofill(lines, { ...base, parameters: params, entered: { l2: { value: "some", leaveBlank: false }, l7: { value: "1", leaveBlank: false } } }).map((f) => [f.pdfFieldName, f]));
    expect(words.get("l8")!.value).toBeNull();
  });

  it("caps confidence at review on a line marked review:true, and on whatever is calculated from it", () => {
    const reviewed: FieldMap = {
      who: { label: "Recipient's name", source: "contractors", rule: "contractor.name", citation: "Box: recipient's name" },
      where: { label: "Recipient's address", source: "contractors", rule: "contractor.address", citation: "Box: recipient's address", review: true, hint: "One line in Walkup — split it across the boxes." },
      l2: { label: "Taxable interest", source: "manual", rule: "", citation: "Line 2", kind: "money", review: true },
      l8: { label: "Gross income", source: "calculated", rule: "add(l2, 0)", citation: "Line 8" },
      sum: { label: "Twice line 8", source: "calculated", rule: "mul(l8, 2)", citation: "n/a", review: true },
    };
    const byName = new Map(
      autofill(reviewed, {
        ...base,
        contractor: { name: "Damen Plumbing", address: "1 Main St", totalCents: 600_00, expenseIds: ["e1"] },
        entered: { l2: { value: "10", leaveBlank: false } },
      }).map((f) => [f.pdfFieldName, f]),
    );
    expect(byName.get("who")!.confidence).toBe("high");
    expect(byName.get("where")).toMatchObject({ value: "1 Main St", confidence: "review" });
    expect(byName.get("l8")).toMatchObject({ value: "10.00", confidence: "review" });
    expect(byName.get("sum")).toMatchObject({ value: "20.00", confidence: "review" });
  });

  it("knows the new setting keys and fills them like any other setting", () => {
    expect(SETTING_KEYS).toEqual(
      expect.arrayContaining([
        "association.incorporated_on_us",
        "fiscal_year.starts_on_mmdd_noncalendar",
        "fiscal_year.ends_on_mmdd_noncalendar",
        "fiscal_year.ends_on_yy_noncalendar",
        "form.tax_year",
      ]),
    );
    const header: FieldMap = {
      formed: { label: "Date association formed", source: "setting", rule: "association.incorporated_on_us", citation: "Form 1120-H, date formed", kind: "date" },
      begin: { label: "Tax year beginning", source: "setting", rule: "fiscal_year.starts_on_mmdd_noncalendar", citation: "Form 1120-H header" },
      end: { label: "Tax year ending", source: "setting", rule: "fiscal_year.ends_on_mmdd_noncalendar", citation: "Form 1120-H header" },
      yy: { label: "Ending year, last two digits", source: "setting", rule: "fiscal_year.ends_on_yy_noncalendar", citation: "Form 1120-H header" },
      year: { label: "Calendar year", source: "setting", rule: "form.tax_year", citation: "Form 1099-NEC, calendar year box" },
    };
    const calendar = derivedSettings({ incorporatedOn: "2004-03-11", fiscalYear: { startsOn: "2026-01-01", endsOn: "2026-12-31" }, taxYear: 2026 });
    expect(calendar).toEqual({
      "association.incorporated_on_us": "03/11/2004",
      "fiscal_year.starts_on_mmdd_noncalendar": null,
      "fiscal_year.ends_on_mmdd_noncalendar": null,
      "fiscal_year.ends_on_yy_noncalendar": null,
      "form.tax_year": "2026",
    });
    const byName = new Map(autofill(header, { ...base, settings: calendar }).map((f) => [f.pdfFieldName, f]));
    expect(byName.get("formed")).toMatchObject({ value: "03/11/2004", confidence: "high" });
    expect(byName.get("begin")).toMatchObject({ value: null, confidence: "blank" });
    expect(byName.get("year")).toMatchObject({ value: "2026", confidence: "high" });

    const fiscal = derivedSettings({ incorporatedOn: null, fiscalYear: { startsOn: "2026-07-01", endsOn: "2027-06-30" }, taxYear: 2027 });
    expect(fiscal).toEqual({
      "association.incorporated_on_us": null,
      "fiscal_year.starts_on_mmdd_noncalendar": "07/01",
      "fiscal_year.ends_on_mmdd_noncalendar": "06/30",
      "fiscal_year.ends_on_yy_noncalendar": "27",
      "form.tax_year": "2027",
    });
    // A short first year isn't a calendar year either.
    expect(derivedSettings({ incorporatedOn: null, fiscalYear: { startsOn: "2026-03-01", endsOn: "2026-12-31" }, taxYear: 2026 })["fiscal_year.starts_on_mmdd_noncalendar"]).toBe("03/01");
  });

  it("never overwrites a confirmed or typed value — keeps the new one aside", () => {
    const fresh = autofill(map, base).find((f) => f.pdfFieldName === "l1")!;
    expect(mergeWithExisting(fresh, { value: "8500.00", userEdited: true, confirmedAt: null, leaveBlank: false })).toEqual({
      value: "8500.00",
      proposedValue: "9000.00",
      keepConfirmation: true,
    });
    expect(mergeWithExisting(fresh, { value: "1.00", userEdited: false, confirmedAt: null, leaveBlank: false }).value).toBe("9000.00");
  });

  it("always takes the fresh value for a calculated line, keeping its confirmation only while the figure is unchanged", () => {
    const fresh: FilledField = {
      pdfFieldName: "l8",
      label: "Gross income",
      section: null,
      citation: "Line 8",
      value: "1300.00",
      source: "calculated",
      sourceRef: { formula: "add(l2, l7)" },
      confidence: "high",
    };
    expect(mergeWithExisting(fresh, { value: "1200.00", userEdited: true, confirmedAt: "2026-09-01", leaveBlank: false })).toEqual({
      value: "1300.00",
      proposedValue: null,
      keepConfirmation: false,
    });
    expect(mergeWithExisting(fresh, { value: "1300.00", userEdited: false, confirmedAt: "2026-09-01", leaveBlank: false })).toEqual({
      value: "1300.00",
      proposedValue: null,
      keepConfirmation: true,
    });
    // A calculation that went blank replaces a stale figure too.
    expect(mergeWithExisting({ ...fresh, value: null, confidence: "blank" }, { value: "1300.00", userEdited: false, confirmedAt: "2026-09-01", leaveBlank: false })).toEqual({
      value: null,
      proposedValue: null,
      keepConfirmation: false,
    });
  });

  it("is ready to sign only when every value is confirmed and every blank is dealt with", () => {
    const f = (o: Partial<Parameters<typeof isReadyToSign>[0][number]>) => ({
      value: "1", confidence: "high" as const, confirmedAt: "now", leaveBlank: false, proposedValue: null, ...o,
    });
    expect(isReadyToSign([f({}), f({ value: null, confirmedAt: null, leaveBlank: true })])).toBe(true);
    expect(isReadyToSign([f({ confirmedAt: null })])).toBe(false);
    expect(isReadyToSign([f({ value: null, confirmedAt: null })])).toBe(false);
    expect(isReadyToSign([f({ proposedValue: "2" })])).toBe(false);
    expect(isReadyToSign([])).toBe(false);
  });
  it("doesn't propose the records' value again once the person chose to keep theirs", () => {
    const fresh = { pdfFieldName: "l1", value: "9000.00", source: "ledger" } as FilledField;
    const existing = { value: "8500.00", userEdited: true, confirmedAt: "2026-10-01T00:00:00Z", leaveBlank: false };
    // asked once…
    expect(mergeWithExisting(fresh, existing)).toMatchObject({ value: "8500.00", proposedValue: "9000.00" });
    // …kept theirs: not asked again while the records still say the same thing
    expect(mergeWithExisting(fresh, { ...existing, dismissedValue: "9000.00" })).toMatchObject({ value: "8500.00", proposedValue: null });
    // the records moved on to a different figure: ask again
    expect(mergeWithExisting({ ...fresh, value: "9100.00" }, { ...existing, dismissedValue: "9000.00" })).toMatchObject({ proposedValue: "9100.00" });
  });

  it("leaves a calculation blank when a blocking checkbox is ticked (timeshare rate isn't on file)", () => {
    const m: FieldMap = {
      timeshare: { label: "Timeshare association", section: "1", source: "manual", rule: "", citation: "Line A", kind: "checkbox" },
      taxable: { label: "Taxable income", section: "5", source: "ledger", rule: "gross_income", citation: "Line 19" },
      rate: { label: "Line 20", section: "5", source: "calculated", rule: "mul(taxable, param:form_1120h_rate_condo)", citation: "Line 20", blankIf: ["timeshare"] },
    };
    const ticked = new Map(autofill(m, { ...base, entered: { timeshare: { value: "Yes", leaveBlank: false } } }).map((f) => [f.pdfFieldName, f]));
    expect(ticked.get("rate")).toMatchObject({ value: null, confidence: "blank" });
    const unticked = new Map(autofill(m, { ...base, entered: {} }).map((f) => [f.pdfFieldName, f]));
    expect(unticked.get("rate")).toMatchObject({ value: "3000.00" });
  });
});
