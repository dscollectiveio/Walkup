// The figures pack: every number Walkup has for a form, as plain rows with
// the records behind each one and whether the rule it came from has been
// checked. It leads the worksheet export (always) and stands in for the form
// on the form page while no verified template exists — so a board with no
// template is never stuck: the figures are here, the official form is one
// click away, and both can go to the accountant. Pure.
//
// Typed against the slice of TaxContext it reads (src/app/tax/data.ts), so
// the loader hands its context straight in and a test builds only that much.

import { dateWords, scrubIdentifiers } from "./copy";
import { run1120hTests, type DetermineInput } from "./determine";
import { computeForm1120h, formatMoney, fromCents } from "./form1120h";

export interface FiguresRow {
  label: string;
  value: string;
  note?: string;
}

export interface FiguresSection {
  title: string;
  rows: FiguresRow[];
}

/** What figuresPack reads from TaxContext — the real one satisfies this. */
export interface FiguresContext {
  association: {
    legal_name: string;
    ein: string | null;
    street_address: string | null;
    city: string | null;
    state_code: string;
    postal_code: string | null;
    incorporated_on: string | null;
  };
  fiscalYear: { label: string; starts_on: string; ends_on: string };
  /** Figures, parameters and unconfirmed income — and what run1120hTests needs. */
  input: DetermineInput;
  /** Income accounts with activity this fiscal year and their cash totals. */
  incomeAccounts: { name: string; isExempt: boolean; totalCents: number }[];
  receiptLineIds: { exempt: string[]; nonexempt: string[] };
  disbursementLineIds: { exempt: string[]; all: string[] };
  /** Contractor totals for the form's payment year. No TIN here, by design (DECISIONS #4). */
  contractorRows: {
    vendorId: string;
    name: string;
    address: string | null;
    totalCents: number;
    paymentCount: number;
    w9OnFile: boolean;
  }[];
}

export interface FiguresForm {
  formCode: string;
  taxYear: number;
  vendorId: string | null;
}

const NOT_ON_FILE = "Not on file. Add it in Building & Owners";
const NOT_CHECKED = "not yet checked against this year's instructions";
const money = formatMoney;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "95%" or "94.3%"; "n/a" when there's nothing to divide by. */
function pct(ratio: number | null): string {
  return ratio === null ? "n/a" : `${(ratio * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

const needs = (threshold: number) => `${Math.round(threshold * 100)}%`;

function aboutSection(ctx: FiguresContext): FiguresSection {
  const a = ctx.association;
  const street = a.street_address?.trim();
  const cityLine = [a.city?.trim(), [a.state_code, a.postal_code?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const address = [street, cityLine].filter(Boolean).join(", ");
  const fy = ctx.fiscalYear;
  return {
    title: "About the association",
    rows: [
      { label: "Legal name", value: a.legal_name },
      { label: "EIN", value: a.ein?.trim() || NOT_ON_FILE },
      { label: "Address", value: address || NOT_ON_FILE },
      { label: "Incorporated on", value: a.incorporated_on ? dateWords(a.incorporated_on) : NOT_ON_FILE },
      { label: "Fiscal year", value: `${fy.label} (${dateWords(fy.starts_on)} to ${dateWords(fy.ends_on)})` },
    ],
  };
}

function figuresSection(ctx: FiguresContext): FiguresSection {
  const f = ctx.input.figures;
  const receipts = ctx.receiptLineIds;
  const payments = ctx.disbursementLineIds;
  const nonexemptCents = f.grossIncomeCents - f.exemptIncomeCents;
  return {
    title: "1120-H figures (cash basis)",
    rows: [
      { label: "Owner fees (exempt function income)", value: money(f.exemptIncomeCents), note: plural(receipts.exempt.length, "receipt") },
      { label: "Income that isn't owner fees", value: money(nonexemptCents), note: plural(receipts.nonexempt.length, "receipt") },
      {
        label: "Gross income",
        value: money(f.grossIncomeCents),
        note: `${plural(receipts.exempt.length + receipts.nonexempt.length, "receipt")}: owner fees plus everything else`,
      },
      { label: "Spending on the building (exempt function expenditures)", value: money(f.exemptExpendituresCents), note: plural(payments.exempt.length, "payment") },
      { label: "Total spending", value: money(f.totalExpendituresCents), note: plural(payments.all.length, "payment") },
    ],
  };
}

function byAccountSection(ctx: FiguresContext): FiguresSection {
  const rows = ctx.incomeAccounts
    .filter((a) => !a.isExempt && a.totalCents !== 0)
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((a) => ({ label: a.name, value: money(a.totalCents) }));
  return {
    title: "Income that isn't owner fees, by account",
    rows: rows.length > 0 ? rows : [{ label: "No income other than owner fees recorded this fiscal year", value: money(0) }],
  };
}

function testsSection(ctx: FiguresContext): FiguresSection {
  const tests = run1120hTests(ctx.input);
  const rows: FiguresRow[] = [];
  if (!tests) {
    rows.push({
      label: "Both tests",
      value: "Can't be run",
      note: "The 1120-H test thresholds aren't on file in Walkup. Ask your CPA.",
    });
  } else {
    for (const t of tests) {
      rows.push({
        label: t.key === "income" ? "Owner fees ÷ gross income (the income test)" : "Spending on the building ÷ total spending (the expenditure test)",
        value: `${t.ratio === null ? `n/a, no ${t.key === "income" ? "gross income" : "spending"} recorded` : pct(t.ratio)}: ${t.passed ? "passes" : "fails"} (needs ${needs(t.threshold)})`,
        note: `Threshold ${needs(t.threshold)} from ${t.sourceUrl ?? "tax_parameters"}: ${t.thresholdVerified ? "checked by a person" : NOT_CHECKED}`,
      });
    }
  }
  const unconfirmed = ctx.input.unconfirmedIncomeAccounts;
  if (unconfirmed.length > 0) {
    rows.push({
      label: "Income still to classify",
      value: plural(unconfirmed.length, "account"),
      note: `${unconfirmed.join(", ")}: until each is confirmed, the tests are provisional.`,
    });
  }
  return { title: "1120-H tests", rows };
}

function estimateSection(ctx: FiguresContext): FiguresSection {
  const f = ctx.input.figures;
  const title = "Estimated tax (provisional)";
  // One implementation of the arithmetic (form1120h.ts); it refuses to run
  // without a sourced rate or deduction rather than substituting one.
  let result: ReturnType<typeof computeForm1120h>;
  try {
    result = computeForm1120h(
      {
        exemptIncome: fromCents(f.exemptIncomeCents),
        nonexemptIncome: fromCents(f.grossIncomeCents - f.exemptIncomeCents),
        grossIncome: fromCents(f.grossIncomeCents),
        exemptExpenditures: fromCents(f.exemptExpendituresCents),
        totalExpenditures: fromCents(f.totalExpendituresCents),
      },
      ctx.input.parameters.map((p) => ({ key: p.key, numericValue: String(p.value), sourceUrl: p.sourceUrl, verifiedOn: p.verifiedOn, notes: null })),
    );
  } catch {
    return {
      title,
      rows: [{ label: "Estimated tax", value: "Can't be estimated", note: "The rate or specific deduction isn't on file in Walkup. Ask your CPA." }],
    };
  }
  const checked = result.usesUnverifiedParameters ? NOT_CHECKED : "checked by a person";
  return {
    title,
    rows: [
      { label: "Income that isn't owner fees", value: money(result.nonexemptIncomeCents) },
      { label: "Specific deduction", value: `−${money(result.specificDeductionCents)}`, note: `From tax_parameters: ${checked}` },
      { label: "Taxable income (estimate)", value: money(result.taxableIncomeCents) },
      { label: "Rate", value: needs(result.rate), note: `Condominium and residential associations; timeshares differ. Ask your CPA. From tax_parameters: ${checked}` },
      {
        label: "Estimated tax before any deductions",
        value: money(result.taxDueCents),
        note: "Provisional: before any deductions the form allows, and not tax advice. Ask your CPA.",
      },
    ],
  };
}

function contractorSection(ctx: FiguresContext, form: FiguresForm): FiguresSection {
  const c = form.vendorId ? ctx.contractorRows.find((r) => r.vendorId === form.vendorId) : undefined;
  if (!c) {
    return {
      title: "Contractor",
      rows: [
        {
          label: "Contractor",
          value: "Not found among this year's contractor payments",
          note: "Check the Contractors page. The payments may be recorded under another name.",
        },
      ],
    };
  }
  return {
    title: "Contractor",
    rows: [
      { label: "Name", value: scrubIdentifiers(c.name) },
      { label: "Address", value: c.address?.trim() ? scrubIdentifiers(c.address) : "Not on file. Add it on the Contractors page" },
      { label: `Total paid in ${form.taxYear}`, value: money(c.totalCents), note: "Every payment we recorded; card payments are reported by the processor instead." },
      { label: "Payments", value: String(c.paymentCount) },
      { label: "W-9 on file", value: c.w9OnFile ? "Yes" : "No", note: c.w9OnFile ? undefined : "Ask for a W-9 before preparing the 1099." },
      { label: "Taxpayer ID", value: "Not stored in Walkup. Copy it from the W-9", note: "Walkup keeps only the last four digits, by design." },
    ],
  };
}

/**
 * The sections, in reading order. Every section is present even when the
 * figures are all zero — a row that says $0.00 is an answer; a missing
 * section looks like a bug. The contractor section appears only on a
 * 1099-NEC, and never carries a TIN.
 */
export function figuresPack(ctx: FiguresContext, form: FiguresForm): FiguresSection[] {
  return [
    aboutSection(ctx),
    ...(form.formCode === "irs_1099_nec" ? [contractorSection(ctx, form)] : []),
    figuresSection(ctx),
    byAccountSection(ctx),
    testsSection(ctx),
    estimateSection(ctx),
  ];
}
