import { describe, expect, it } from "vitest";
import { dueDate, parseDueRule } from "@/lib/tax/due-rules";
import { determineForms, nextDeadline, type DetermineInput } from "@/lib/tax/determine";
import { autofill, isReadyToSign, mergeWithExisting, type FieldMap } from "@/lib/tax/autofill";

const today = new Date("2026-09-30T12:00:00");

describe("due rules", () => {
  it("reads the three rule shapes and refuses anything else", () => {
    expect(parseDueRule("FY_END + 4 MONTHS, DAY 15")).toEqual({ kind: "fy", months: 4, day: "15" });
    expect(parseDueRule("cal_year_end + 1 month, day 31")).toEqual({ kind: "cal", months: 1, day: "31" });
    expect(parseDueRule("INCORPORATION_ANNIVERSARY_MONTH, DAY 1")?.kind).toBe("anniv");
    expect(parseDueRule("April 15")).toBeNull();
  });

  it("computes dates from the fiscal year end, the calendar year, or the incorporation month", () => {
    const ctx = { fiscalYearEnd: "2026-12-31", calendarYear: 2026, incorporatedOn: "2004-03-11", today };
    expect(dueDate("FY_END + 4 MONTHS, DAY 15", ctx)).toBe("2027-04-15");
    expect(dueDate("FY_END + 4 MONTHS, DAY 15", { ...ctx, fiscalYearEnd: "2027-06-30" })).toBe("2027-10-15");
    expect(dueDate("CAL_YEAR_END + 1 MONTHS, DAY 31", ctx)).toBe("2027-01-31");
    expect(dueDate("CAL_YEAR_END + 2 MONTHS, DAY LAST", ctx)).toBe("2027-02-28");
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH, DAY 1", ctx)).toBe("2027-03-01");
  });

  it("returns null without a rule or the date it depends on — never a guess", () => {
    expect(dueDate(null, { fiscalYearEnd: "2026-12-31", calendarYear: 2026, incorporatedOn: null, today })).toBeNull();
    expect(dueDate("INCORPORATION_ANNIVERSARY_MONTH, DAY 1", { fiscalYearEnd: null, calendarYear: null, incorporatedOn: null, today })).toBeNull();
  });
});

function input(over: Partial<DetermineInput> = {}): DetermineInput {
  return {
    association: { stateCode: "IL", incorporatedOn: "2004-03-11", ein: "36-0000000" },
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

  it("requires 1120-H when both tests pass, citing where the thresholds came from", () => {
    const f = determineForms(input()).find((x) => x.formCode === "irs_1120h")!;
    expect(f.determination).toBe("required");
    expect(f.reason).toContain("irs.gov");
    expect(f.reason).toContain("not yet verified");
  });

  it("flags 1120 as likely when a test fails", () => {
    const forms = determineForms(input({ figures: { exemptIncomeCents: 5_000_00, grossIncomeCents: 10_000_00, exemptExpendituresCents: 1, totalExpendituresCents: 1 } }));
    expect(forms.find((x) => x.formCode === "irs_1120h")!.determination).toBe("not_required");
    const f1120 = forms.find((x) => x.formCode === "irs_1120")!;
    expect(f1120.determination).toBe("likely_required");
    expect(f1120.reason).toBe("Your association may not qualify for 1120-H this year. Talk to a CPA before filing.");
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
    expect(nextDeadline(forms, today)!.formCode).toBe("il_sos_annual_report");
  });

  it("ignores an unverified template's rule", () => {
    const f = determineForms(
      input({ templates: [{ formCode: "irs_1120h", taxYear: 2026, dueRule: "FY_END + 4 MONTHS, DAY 15", dueRuleCitation: "x", notes: null, verified: false }] }),
    ).find((x) => x.formCode === "irs_1120h")!;
    expect(f.dueOn).toBeNull();
  });

  it("requires a 1099-NEC per contractor at or above the threshold, plus a 1096, and flags missing W-9s", () => {
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
    expect(nec[0].warnings).toEqual(["Get a W-9 from Damen Plumbing before preparing their 1099."]);
    expect(forms.find((x) => x.formCode === "irs_1096")!.reason).toContain("Damen Plumbing");
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

  it("never overwrites a confirmed or typed value — keeps the new one aside", () => {
    const fresh = autofill(map, base).find((f) => f.pdfFieldName === "l1")!;
    expect(mergeWithExisting(fresh, { value: "8500.00", userEdited: true, confirmedAt: null, leaveBlank: false })).toEqual({
      value: "8500.00",
      proposedValue: "9000.00",
      keepConfirmation: true,
    });
    expect(mergeWithExisting(fresh, { value: "1.00", userEdited: false, confirmedAt: null, leaveBlank: false }).value).toBe("9000.00");
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
});
