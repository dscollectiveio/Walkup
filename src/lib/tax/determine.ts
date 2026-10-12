// Which forms an association needs this year, and why. Pure: settings,
// classified ledger totals, contractor totals, parameters and templates in;
// a determination with a plain-language reason out, for every form.
//
// Nothing here is a rule from memory. Thresholds come from tax_parameters
// (each with its source and whether a person has verified it), already
// resolved by the caller as of the year in question — nothing here filters
// by date. Due dates come from rule strings on verified templates
// (due-rules.ts). Where the answer can't be sourced, the outcome is ask_cpa —
// a correct result, not a failure. Reminders, estimates and milestones are
// deadlines.ts's job; this module only says which forms apply.

import { dueDate, fiscalRuleSkipsJune } from "./due-rules";

export type FormCode = "irs_1120h" | "irs_1120" | "il_1120" | "irs_1099_nec" | "irs_1096" | "il_sos_annual_report";
/** `eligible`: both 1120-H tests pass. Filing 1120-H is an election made each year by filing it, so it is never "required". */
export type Determination = "required" | "likely_required" | "eligible" | "optional" | "not_required" | "ask_cpa";

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

export const ELIGIBLE_1120H_REASON =
  "You qualify — elect it by filing. Ask your CPA whether 1120-H or Form 1120 is better this year.";

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
  association: {
    stateCode: string;
    incorporatedOn: string | null;
    ein: string | null;
    /** How the association files 1099s with the IRS (associations.information_returns_filing); null or absent until someone says. */
    informationReturnsFiling?: "paper" | "electronic" | null;
  };
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
  /** Resolved as of the fiscal year end (1120-H keys) and Dec 31 of the payment year (1099 threshold) before they get here. */
  parameters: Parameter[];
  templates: TemplateRule[];
  today: Date;
}

export interface FormOutcome {
  formCode: FormCode;
  taxYear: number;
  vendorId?: string;
  /** "Form 1120-H", "1099-NEC — Acme Plumbing", "Illinois annual report" — the words a reminder uses. */
  name: string;
  determination: Determination;
  reason: string;
  dueOn: string | null;
  dueCitation: string | null;
  /** The verified template's notes for this form, shown on its card; null without one. */
  note: string | null;
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

/**
 * The verified template whose rule applies to a form and year. The Illinois
 * annual report recurs every year under one statute, so its newest verified
 * template serves whatever year is asked for.
 */
function templateFor(input: DetermineInput, code: FormCode, year: number) {
  const verified = input.templates.filter((t) => t.formCode === code && t.verified);
  if (code === "il_sos_annual_report") return verified.sort((a, b) => b.taxYear - a.taxYear)[0] ?? null;
  return verified.find((t) => t.taxYear === year) ?? null;
}

/** What a verified template contributes to an outcome: the due date from its rule, the citation, and its notes. */
function fromTemplate(input: DetermineInput, code: FormCode, year: number): { dueOn: string | null; dueCitation: string | null; note: string | null } {
  const t = templateFor(input, code, year);
  const note = t?.notes ?? null;
  if (!t?.dueRule) return { dueOn: null, dueCitation: null, note };
  // A June-30 fiscal year has its own rule the grammar can't express yet; the
  // card keeps the template's notes (which say so) but shows no date.
  if (fiscalRuleSkipsJune(t.dueRule, input.fiscalYear.endsOn)) return { dueOn: null, dueCitation: null, note };
  return {
    dueOn: dueDate(t.dueRule, {
      fiscalYearEnd: input.fiscalYear.endsOn,
      calendarYear: input.contractorYear,
      incorporatedOn: input.association.incorporatedOn,
      today: input.today,
    }),
    dueCitation: t.dueRuleCitation,
    note,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function determineForms(input: DetermineInput): FormOutcome[] {
  const out: FormOutcome[] = [];
  const fy = input.fiscalYear.taxYear;

  // ---- 1120-H / 1120 ---------------------------------------------------------
  const tests = run1120hTests(input);
  const h = { formCode: "irs_1120h" as const, taxYear: fy, name: FORM_LABEL.irs_1120h, ...fromTemplate(input, "irs_1120h", fy) };
  if (input.unconfirmedIncomeAccounts.length > 0) {
    out.push({
      ...h,
      determination: "ask_cpa",
      reason: "Some income isn't classified yet. Classify it to check whether you qualify.",
      warnings: [],
    });
  } else if (!tests) {
    out.push({
      ...h,
      determination: "ask_cpa",
      reason: "The 1120-H test thresholds aren't on file in Walkup, so the tests can't be run. Ask your CPA.",
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
      out.push({ ...h, determination: "eligible", reason: `${ELIGIBLE_1120H_REASON} ${detail}`, warnings });
    } else {
      out.push({ ...h, determination: "not_required", reason: `At least one test fails. ${detail}`, warnings });
      out.push({
        formCode: "irs_1120",
        taxYear: fy,
        name: FORM_LABEL.irs_1120,
        determination: "likely_required",
        reason: "Your association may not qualify for 1120-H this year. Talk to a CPA before filing.",
        ...fromTemplate(input, "irs_1120", fy),
        warnings,
      });
    }
  }

  // ---- Illinois --------------------------------------------------------------
  if (input.association.stateCode === "IL") {
    out.push({
      formCode: "il_1120",
      taxYear: fy,
      name: FORM_LABEL.il_1120,
      determination: "ask_cpa",
      reason: "Illinois filing rules for associations vary. Confirm with a CPA.",
      ...fromTemplate(input, "il_1120", fy),
      warnings: [],
    });

    if (input.association.incorporatedOn) {
      const sos = fromTemplate(input, "il_sos_annual_report", fy);
      out.push({
        formCode: "il_sos_annual_report",
        taxYear: fy,
        name: FORM_LABEL.il_sos_annual_report,
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
      name: FORM_LABEL.irs_1099_nec,
      determination: "ask_cpa",
      reason: "The 1099-NEC reporting threshold isn't on file in Walkup. Ask your CPA which contractors need one.",
      dueOn: null,
      dueCitation: null,
      note: null,
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
        name: `1099-NEC — ${c.name}`,
        determination: "required",
        reason: `${c.name} was paid ${dollars(c.totalCents)} for services in ${cy}, at or above the ${dollars(thresholdCents)} reporting threshold${threshold.verifiedOn ? "" : " (threshold not yet verified against this year's instructions)"}.`,
        ...fromTemplate(input, "irs_1099_nec", cy),
        warnings: c.w9OnFile ? [] : [`Get a W-9 from ${c.name} before preparing their 1099.`],
      });
    }
    // Form 1096 only travels with paper 1099s, so the answer turns on how the
    // association files them — a stored fact, never a guess and never "optional".
    if (over.length > 0) {
      const who = `${over.length} contractor${over.length === 1 ? "" : "s"}: ${over.map((c) => c.name).join(", ")}`;
      const method = input.association.informationReturnsFiling ?? null;
      out.push({
        formCode: "irs_1096",
        taxYear: cy,
        name: FORM_LABEL.irs_1096,
        determination: method === "paper" ? "required" : method === "electronic" ? "not_required" : "ask_cpa",
        reason:
          method === "paper" ? `Sent with your paper 1099s — ${who}.`
          : method === "electronic" ? "Not needed: you file 1099s electronically, and Form 1096 only goes with paper 1099s."
          : `Only needed if you file 1099s on paper (${who}). Tell Walkup how you file 1099s with the IRS, or ask your CPA.`,
        ...fromTemplate(input, "irs_1096", cy),
        warnings: [],
      });
    }
  }

  return out;
}

// The soonest deadline still to file lives in deadlines.ts, which also knows
// about estimates, filed forms and milestones; re-exported here so older
// imports keep working. (deadlines.ts imports only the FormCode *type* from
// this file, so there is no runtime cycle.)
export { nextDeadline } from "./deadlines";
