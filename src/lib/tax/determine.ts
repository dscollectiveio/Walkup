// Which forms an association needs this year, and why. Pure: settings,
// classified ledger totals, contractor totals, parameters and templates in;
// a determination with a plain-language reason out, for every form.
//
// Nothing here is a rule from memory. Thresholds come from tax_parameters
// (each with its source and whether a person has verified it); due dates come
// from rule strings on verified templates (due-rules.ts). Where the answer
// can't be sourced, the outcome is ask_cpa — a correct result, not a failure.

import { dueDate } from "./due-rules";

export type FormCode = "irs_1120h" | "irs_1120" | "il_1120" | "irs_1099_nec" | "irs_1096" | "il_sos_annual_report";
export type Determination = "required" | "likely_required" | "optional" | "not_required" | "ask_cpa";

export const FORM_LABEL: Record<FormCode, string> = {
  irs_1120h: "Form 1120-H",
  irs_1120: "Form 1120",
  il_1120: "Illinois IL-1120",
  irs_1099_nec: "Form 1099-NEC",
  irs_1096: "Form 1096",
  il_sos_annual_report: "Illinois annual report",
};

export const FORM_PLAIN: Record<FormCode, string> = {
  irs_1120h: "The short federal tax return for homeowners associations",
  irs_1120: "The full federal corporate tax return",
  il_1120: "Illinois corporate income tax return",
  irs_1099_nec: "Reports what you paid a contractor",
  irs_1096: "The cover summary sent with paper 1099s",
  il_sos_annual_report: "Keeps the corporation in good standing with the Secretary of State",
};

export interface Parameter {
  key: string;
  value: number;
  sourceUrl: string | null;
  verifiedOn: string | null;
}

export interface TemplateRule {
  formCode: string;
  taxYear: number;
  dueRule: string | null;
  dueRuleCitation: string | null;
  notes: string | null;
  verified: boolean;
}

export interface DetermineInput {
  association: { stateCode: string; incorporatedOn: string | null; ein: string | null };
  fiscalYear: { label: string; endsOn: string; taxYear: number };
  /** Calendar year whose contractor payments are reported next January. */
  contractorYear: number;
  figures: {
    exemptIncomeCents: number;
    grossIncomeCents: number;
    exemptExpendituresCents: number;
    totalExpendituresCents: number;
  };
  /** Income accounts with activity this fiscal year that no board member has confirmed. */
  unconfirmedIncomeAccounts: string[];
  contractors: { vendorId: string; name: string; totalCents: number; w9OnFile: boolean }[];
  parameters: Parameter[];
  templates: TemplateRule[];
  today: Date;
}

export interface FormOutcome {
  formCode: FormCode;
  taxYear: number;
  vendorId?: string;
  determination: Determination;
  reason: string;
  dueOn: string | null;
  dueCitation: string | null;
  warnings: string[];
}

export interface TestResult {
  key: "income" | "expenditure";
  ratio: number | null;
  threshold: number;
  passed: boolean;
  nearThreshold: boolean;
  thresholdVerified: boolean;
  sourceUrl: string | null;
}

/** "Near" a threshold: within 5 percentage points of it. */
export const NEAR_THRESHOLD = 0.05;

export function run1120hTests(input: DetermineInput): TestResult[] | null {
  const p = (key: string) => input.parameters.find((x) => x.key === key);
  const income = p("form_1120h_income_test");
  const spend = p("form_1120h_expenditure_test");
  if (!income || !spend) return null;
  const f = input.figures;
  const mk = (key: "income" | "expenditure", num: number, den: number, param: Parameter): TestResult => {
    const ratio = den > 0 ? num / den : null;
    return {
      key,
      ratio,
      threshold: param.value,
      passed: ratio === null ? true : ratio >= param.value,
      nearThreshold: ratio !== null && Math.abs(ratio - param.value) <= NEAR_THRESHOLD,
      thresholdVerified: param.verifiedOn !== null,
      sourceUrl: param.sourceUrl,
    };
  };
  return [
    mk("income", f.exemptIncomeCents, f.grossIncomeCents, income),
    mk("expenditure", f.exemptExpendituresCents, f.totalExpendituresCents, spend),
  ];
}

function templateFor(input: DetermineInput, code: FormCode, year: number) {
  return input.templates.find((t) => t.formCode === code && t.taxYear === year && t.verified) ?? null;
}

function due(input: DetermineInput, code: FormCode, year: number): { dueOn: string | null; dueCitation: string | null } {
  const t = templateFor(input, code, year);
  if (!t?.dueRule) return { dueOn: null, dueCitation: null };
  return {
    dueOn: dueDate(t.dueRule, {
      fiscalYearEnd: input.fiscalYear.endsOn,
      calendarYear: input.contractorYear,
      incorporatedOn: input.association.incorporatedOn,
      today: input.today,
    }),
    dueCitation: t.dueRuleCitation,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function determineForms(input: DetermineInput): FormOutcome[] {
  const out: FormOutcome[] = [];
  const fy = input.fiscalYear.taxYear;

  // ---- 1120-H / 1120 ---------------------------------------------------------
  const tests = run1120hTests(input);
  if (input.unconfirmedIncomeAccounts.length > 0) {
    out.push({
      formCode: "irs_1120h",
      taxYear: fy,
      determination: "ask_cpa",
      reason: "Some income isn't classified yet. Classify it to check whether you qualify.",
      ...due(input, "irs_1120h", fy),
      warnings: [],
    });
  } else if (!tests) {
    out.push({
      formCode: "irs_1120h",
      taxYear: fy,
      determination: "ask_cpa",
      reason: "The 1120-H test thresholds aren't on file in Walkup, so the tests can't be run. Ask your CPA.",
      ...due(input, "irs_1120h", fy),
      warnings: [],
    });
  } else {
    const [inc, exp] = tests;
    const unverified = tests.some((t) => !t.thresholdVerified);
    const detail =
      `Exempt-function income is ${inc.ratio === null ? "not applicable (no income)" : pct(inc.ratio)} of gross income ` +
      `(needs ${pct(inc.threshold)}); exempt-function spending is ${exp.ratio === null ? "not applicable (no spending)" : pct(exp.ratio)} ` +
      `of total spending (needs ${pct(exp.threshold)}). Thresholds from ${inc.sourceUrl ?? "tax_parameters"}` +
      (unverified ? " — not yet verified against this year's instructions." : ".");
    const warnings = tests.filter((t) => t.nearThreshold).map((t) => `The ${t.key} test is within 5 points of its threshold.`);
    if (inc.passed && exp.passed) {
      out.push({ formCode: "irs_1120h", taxYear: fy, determination: "required", reason: `Both tests pass. ${detail}`, ...due(input, "irs_1120h", fy), warnings });
    } else {
      out.push({ formCode: "irs_1120h", taxYear: fy, determination: "not_required", reason: `At least one test fails. ${detail}`, ...due(input, "irs_1120h", fy), warnings });
      out.push({
        formCode: "irs_1120",
        taxYear: fy,
        determination: "likely_required",
        reason: "Your association may not qualify for 1120-H this year. Talk to a CPA before filing.",
        ...due(input, "irs_1120", fy),
        warnings,
      });
    }
  }

  // ---- Illinois --------------------------------------------------------------
  if (input.association.stateCode === "IL") {
    const t = templateFor(input, "il_1120", fy);
    out.push({
      formCode: "il_1120",
      taxYear: fy,
      determination: "ask_cpa",
      reason: t?.notes
        ? `Illinois filing rules for associations vary. Confirm with a CPA. Note on file: ${t.notes}`
        : "Illinois filing rules for associations vary. Confirm with a CPA.",
      ...due(input, "il_1120", fy),
      warnings: [],
    });

    if (input.association.incorporatedOn) {
      const sos = due(input, "il_sos_annual_report", fy);
      out.push({
        formCode: "il_sos_annual_report",
        taxYear: fy,
        determination: sos.dueOn ? "required" : "ask_cpa",
        reason: sos.dueOn
          ? "Illinois not-for-profit corporations file an annual report with the Secretary of State to stay in good standing."
          : "Confirm your annual report due date with the Illinois Secretary of State.",
        ...sos,
        warnings: [],
      });
    }
  }

  // ---- 1099-NEC / 1096 ---------------------------------------------------------
  const threshold = input.parameters.find((x) => x.key === "form_1099_nec_threshold");
  const cy = input.contractorYear;
  if (!threshold) {
    out.push({
      formCode: "irs_1099_nec",
      taxYear: cy,
      determination: "ask_cpa",
      reason: "The 1099-NEC reporting threshold isn't on file in Walkup. Ask your CPA which contractors need one.",
      dueOn: null,
      dueCitation: null,
      warnings: [],
    });
  } else {
    const thresholdCents = Math.round(threshold.value * 100);
    const over = input.contractors.filter((c) => c.totalCents >= thresholdCents);
    for (const c of over) {
      out.push({
        formCode: "irs_1099_nec",
        taxYear: cy,
        vendorId: c.vendorId,
        determination: "required",
        reason: `${c.name} was paid ${dollars(c.totalCents)} for services in ${cy}, at or above the ${dollars(thresholdCents)} reporting threshold${threshold.verifiedOn ? "" : " (threshold not yet verified against this year's instructions)"}.`,
        ...due(input, "irs_1099_nec", cy),
        warnings: c.w9OnFile ? [] : [`Get a W-9 from ${c.name} before preparing their 1099.`],
      });
    }
    if (over.length > 0) {
      out.push({
        formCode: "irs_1096",
        taxYear: cy,
        determination: "required",
        reason: `Sent with paper 1099s — ${over.length} contractor${over.length === 1 ? "" : "s"}: ${over.map((c) => c.name).join(", ")}.`,
        ...due(input, "irs_1096", cy),
        warnings: [],
      });
    }
  }

  return out;
}

/** The deadline and action to put at the top of the Taxes tab. */
export function nextDeadline(forms: FormOutcome[], today: Date): FormOutcome | null {
  const todayIso = today.toISOString().slice(0, 10);
  return (
    forms
      .filter((f) => f.dueOn && f.dueOn >= todayIso && f.determination !== "not_required")
      .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))[0] ?? null
  );
}
