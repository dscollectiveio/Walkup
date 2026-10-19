// Form 1120-H (2025), U.S. Income Tax Return for Homeowners Associations.
// Authored 2026-10-11 against https://www.irs.gov/pub/irs-prior/f1120h--2025.pdf
// (byte-identical to irs-pdf/f1120h.pdf that day): title "2025 Form 1120-H",
// one page, 70 AcroForm fields once pdf-lib strips the XFA layer. Names were
// read from the labeled preview (every box printed with its own name) and
// checked against the boxes' positions; tests/fixtures/tax/f1120h-2025-fields.json
// lists them all.
//
// Every entry cites the printed line and, where the 2025 instructions have a
// heading for it, that heading. Lines 8, 17, 19, 23a and 23c have no heading
// of their own in the instructions, so those cite the form line only.

import type { FieldMap, MapEntry } from "../autofill";
import type { SuggestedTemplate } from "./index";

const P = "topmostSubform[0].Page1[0].";
const f = (suffix: string) => `${P}${suffix}`;

// The stored rule is the plain string autofill.ts reads, with full names:
// add(topmostSubform[0].Page1[0].f1_17[0],…). These keep the file readable.
const add = (...names: string[]) => `add(${names.join(",")})`;
const sub = (a: string, b: string) => `sub(${a},${b})`;
const mul = (a: string, b: string) => `mul(${a},${b})`;
const max0 = (x: string) => `max0(${x})`;

const FORM = "Form 1120-H (2025)";
const INSTR = "Instructions for Form 1120-H (2025), Specific Instructions";
const cite = (line: string, heading?: string) => (heading ? `${FORM}, ${line}; ${INSTR} — ${heading}` : `${FORM}, ${line}`);

const S1 = "1. About your association";
const S2 = "2. Lines B–E (the two tests)";
const S3 = "3. Gross income (lines 1–8)";
const S4 = "4. Deductions (lines 9–17)";
const S5 = "5. Tax and payments (lines 19–26)";

/** A header box filled from Building & Owners. */
const setting = (label: string, rule: string, citation: string, flags: Partial<MapEntry> = {}): MapEntry => ({
  label,
  section: S1,
  source: "setting",
  rule,
  citation,
  kind: "text",
  ...flags,
});

/** A line the board types, or leaves blank. */
const typed = (label: string, section: string, citation: string, flags: Partial<MapEntry> = {}): MapEntry => ({
  label,
  section,
  source: "manual",
  rule: "",
  citation,
  kind: "money",
  ...flags,
});

/** A line Walkup adds up from other lines; the page shows "Calculated" and no buttons. */
const calc = (label: string, section: string, rule: string, citation: string, extra: Partial<MapEntry> = {}): MapEntry => ({
  label,
  section,
  source: "calculated",
  rule,
  citation,
  kind: "money",
  ...extra,
});

const HEADER_DATE_HINT = "Blank for a calendar-year association — leave it blank.";

const INCOME_LINES: { field: string; line: number; label: string; heading: string; hint?: string }[] = [
  { field: "f1_17[0]", line: 1, label: "Dividends", heading: "Dividends" },
  { field: "f1_18[0]", line: 2, label: "Taxable interest", heading: "Taxable interest", hint: "Bank interest goes here." },
  { field: "f1_19[0]", line: 3, label: "Gross rents", heading: "Gross rents" },
  { field: "f1_20[0]", line: 4, label: "Gross royalties", heading: "Gross royalties" },
  { field: "f1_21[0]", line: 5, label: "Capital gain net income", heading: "Capital gain net income" },
  { field: "f1_22[0]", line: 6, label: "Net gain or (loss) from Form 4797", heading: "Net gain or (loss) from Form 4797" },
  {
    field: "f1_23[0]",
    line: 7,
    label: "Other income (excluding exempt function income)",
    heading: "Other income",
    hint: "Laundry, parking, rentals to outsiders and similar.",
  },
];

const DEDUCTION_HINT =
  "Only costs directly connected to the income on lines 1–7 (for example bank fees on an interest-bearing account). Building expenses don't go here.";

const DEDUCTION_LINES: { field: string; line: number; label: string }[] = [
  { field: "f1_25[0]", line: 9, label: "Salaries and wages" },
  { field: "f1_26[0]", line: 10, label: "Repairs and maintenance" },
  { field: "f1_27[0]", line: 11, label: "Rents" },
  { field: "f1_28[0]", line: 12, label: "Taxes and licenses" },
  { field: "f1_29[0]", line: 13, label: "Interest" },
  { field: "f1_30[0]", line: 14, label: "Depreciation" },
  { field: "f1_31[0]", line: 15, label: "Other deductions" },
];

const PAYMENT_LINES: { field: string; line: string; label: string; heading?: string }[] = [
  { field: "f1_39[0]", line: "23a", label: "Preceding year's overpayment credited to this year's estimated tax" },
  { field: "f1_40[0]", line: "23b", label: "This year's estimated tax payments", heading: "Line 23b. Estimated tax payments" },
  { field: "f1_41[0]", line: "23c", label: "Tax deposited with Form 7004" },
  { field: "f1_42[0]", line: "23d", label: "Credit for tax on undistributed capital gains (Form 2439)", heading: "Line 23d. Credit from Form 2439" },
  { field: "f1_43[0]", line: "23e", label: "Credit for federal tax on fuels (Form 4136)", heading: "Line 23e. Credit for federal tax on fuels" },
  {
    field: "f1_44[0]",
    line: "23f",
    label: "Elective payment election amount (Form 3800)",
    heading: "Line 23f. Elective payment election amount from Form 3800",
  },
];

// Full names of the lines the calculations read, so the formulas below read like the form.
const LINES_1_TO_7 = INCOME_LINES.map((l) => f(l.field));
const LINES_9_TO_15 = DEDUCTION_LINES.map((l) => f(l.field));
const LINES_23A_TO_F = PAYMENT_LINES.map((l) => f(l.field));
const LINE_8 = f("f1_24[0]");
const LINE_16 = f("f1_32[0]");
const LINE_17 = f("f1_33[0]");
const LINE_19 = f("f1_35[0]");
const LINE_20 = f("f1_36[0]");
const LINE_21 = f("f1_37[0]");
const LINE_22 = f("f1_38[0]");
const LINE_23G = f("f1_45[0]");

const FIELD_MAP: FieldMap = {
  // ---- 1. About your association ------------------------------------------------
  [f("PgHeader[0].f1_01[0]")]: setting(
    "Tax year beginning (fiscal-year filers only)",
    "fiscal_year.starts_on_mmdd_noncalendar",
    cite("header — tax year beginning", "Period covered"),
    { hint: HEADER_DATE_HINT },
  ),
  [f("PgHeader[0].f1_02[0]")]: setting(
    "Tax year ending (fiscal-year filers only)",
    "fiscal_year.ends_on_mmdd_noncalendar",
    cite("header — tax year ending", "Period covered"),
    { hint: HEADER_DATE_HINT },
  ),
  [f("PgHeader[0].f1_03[0]")]: setting(
    "Tax year ending — last two digits of the year",
    "fiscal_year.ends_on_yy_noncalendar",
    cite("header — tax year ending, the two-digit year box", "Period covered"),
    { hint: HEADER_DATE_HINT },
  ),
  [f("NameAddress[0].f1_04[0]")]: setting("Name", "association.legal_name", cite("header — Name", "Name and address")),
  [f("f1_11[0]")]: setting(
    "Employer identification number",
    "association.ein",
    cite("header — Employer identification number", "Employer identification number (EIN)"),
  ),
  [f("NameAddress[0].f1_05[0]")]: setting("Number and street", "association.street_address", cite("header — Number and street", "Name and address")),
  [f("NameAddress[0].f1_07[0]")]: setting("City or town", "association.city", cite("header — City or town", "Name and address")),
  [f("NameAddress[0].f1_08[0]")]: setting("State", "association.state_code", cite("header — State", "Name and address")),
  [f("NameAddress[0].f1_10[0]")]: setting("ZIP code", "association.postal_code", cite("header — ZIP code", "Name and address")),
  [f("f1_12[0]")]: setting("Date association formed", "association.incorporated_on_us", cite("header — Date association formed"), { kind: "date" }),
  [f("c1_5[0]")]: {
    label: "A — Condominium management association",
    section: S1,
    source: "manual",
    rule: "",
    citation: cite("item A, first box — condominium management association", "Item A. Type of homeowners association"),
    kind: "checkbox",
    hint: "Check exactly one of the three. Walkup's 30% rate assumes a condominium or residential association; timeshares use 32% — ask your CPA if unsure.",
  },
  [f("c1_5[1]")]: {
    label: "A — Residential real estate association",
    section: S1,
    source: "manual",
    rule: "",
    citation: cite("item A, second box — residential real estate association", "Item A. Type of homeowners association"),
    kind: "checkbox",
  },
  [f("c1_5[2]")]: {
    label: "A — Timeshare association",
    section: S1,
    source: "manual",
    rule: "",
    citation: cite("item A, third box — timeshare association", "Item A. Type of homeowners association"),
    kind: "checkbox",
  },

  // ---- 2. Lines B–E (the two tests) -----------------------------------------------
  [f("f1_13[0]")]: {
    label: "Line B — Total exempt function income (60% test)",
    section: S2,
    source: "ledger",
    rule: "exempt_income",
    citation: cite("line B", "Item B. 60% gross income test"),
    kind: "money",
  },
  [f("f1_14[0]")]: {
    label: "Line C — Expenditures for purposes in the 90% test",
    section: S2,
    source: "ledger",
    rule: "exempt_expenditures",
    citation: cite("line C", "Item C. 90% expenditure test"),
    kind: "money",
  },
  [f("f1_15[0]")]: {
    label: "Line D — Association's total expenditures",
    section: S2,
    source: "ledger",
    rule: "total_expenditures",
    citation: cite("line D", "Item D"),
    kind: "money",
  },
  [f("f1_16[0]")]: typed("Line E — Tax-exempt interest received or accrued", S2, cite("line E", "Item E"), {
    zeroOk: true,
    hint: "Interest on state or municipal bonds. Most associations have none.",
  }),

  // ---- 3. Gross income (lines 1–8) -------------------------------------------------
  ...Object.fromEntries(
    INCOME_LINES.map((l) => [
      f(l.field),
      typed(`Line ${l.line} — ${l.label}`, S3, cite(`line ${l.line}`, `Gross Income — Line ${l.line}. ${l.heading}`), {
        zeroOk: true,
        ...(l.hint ? { hint: l.hint } : {}),
      }),
    ]),
  ),
  [LINE_8]: calc(
    "Line 8 — Gross income (excluding exempt function income): lines 1–7",
    S3,
    add(...LINES_1_TO_7),
    cite("line 8 (add lines 1 through 7)", "Gross Income"),
  ),

  // ---- 4. Deductions (lines 9–17) --------------------------------------------------
  ...Object.fromEntries(
    DEDUCTION_LINES.map((l) => [
      f(l.field),
      typed(`Line ${l.line} — ${l.label}`, S4, cite(`line ${l.line}`, `Deductions — Line ${l.line}. ${l.label}`), {
        zeroOk: true,
        hint: DEDUCTION_HINT,
      }),
    ]),
  ),
  [LINE_16]: calc("Line 16 — Total deductions: lines 9–15", S4, add(...LINES_9_TO_15), cite("line 16 (add lines 9 through 15)", "Line 16. Total deductions")),
  [LINE_17]: calc(
    "Line 17 — Taxable income before the specific deduction: line 8 minus line 16",
    S4,
    sub(LINE_8, LINE_16),
    cite("line 17 (subtract line 16 from line 8)"),
  ),

  // ---- 5. Tax and payments (lines 19–26) -------------------------------------------
  [LINE_19]: calc(
    "Line 19 — Taxable income: line 17 minus the $100 specific deduction (line 18 is preprinted)",
    S5,
    max0(sub(LINE_17, "param:form_1120h_specific_deduction")),
    cite("line 19 (subtract line 18, the preprinted $100 specific deduction, from line 17)"),
  ),
  [LINE_20]: calc(
    "Line 20 — 30% of line 19 (timeshare associations: 32% — ask your CPA)",
    S5,
    mul(LINE_19, "param:form_1120h_rate_condo"),
    cite("line 20 (30% of line 19; 32% for timeshare associations)", "Line 20"),
    {
      blankIf: [f("c1_5[2]")],
      hint: "Left blank if you check Timeshare association above — that rate isn't one Walkup has on file. Enter it with your CPA.",
    },
  ),
  [LINE_21]: typed("Line 21 — Tax credits", S5, cite("line 21", "Line 21. Tax credits"), { hint: "Rare for an association. Leave blank if none." }),
  [LINE_22]: calc("Line 22 — Total tax: line 20 minus line 21", S5, sub(LINE_20, LINE_21), cite("line 22 (subtract line 21 from line 20)", "Line 22. Total tax")),
  ...Object.fromEntries(
    PAYMENT_LINES.map((l) => [
      f(l.field),
      typed(`Line ${l.line} — ${l.label}`, S5, cite(`line ${l.line}`, l.heading), { hint: "Leave blank if none." }),
    ]),
  ),
  [LINE_23G]: calc(
    "Line 23g — Total payments and credits",
    S5,
    add(...LINES_23A_TO_F),
    cite("line 23g (add lines 23a through 23f)", "Line 23g. Total payments and credits"),
  ),
  [f("f1_46[0]")]: calc("Line 24 — Amount owed: line 22 minus line 23g", S5, max0(sub(LINE_22, LINE_23G)), cite("line 24", "Line 24. Amount owed")),
  [f("f1_47[0]")]: calc("Line 25 — Overpayment: line 23g minus line 22", S5, max0(sub(LINE_23G, LINE_22)), cite("line 25", "Line 25. Overpayment")),
  [f("f1_48[0]")]: typed("Line 26a — Overpayment credited to next year's estimated tax", S5, cite("line 26a", "Line 26a. Credited to estimated tax"), {
    hint: "Leave blank if none.",
  }),
  [f("f1_49[0]")]: typed("Line 26b — Overpayment refunded", S5, cite("line 26b", "Line 26b. Refunded"), { hint: "Leave blank if none." }),
};

export const IRS_1120H_2025: SuggestedTemplate = {
  key: "irs_1120h_2025",
  formCode: "irs_1120h",
  taxYear: 2025,
  kind: "pdf",
  sourceUrl: "https://www.irs.gov/pub/irs-prior/f1120h--2025.pdf",
  instructionsUrl: "https://www.irs.gov/instructions/i1120h",
  expectedTitle: "2025 Form 1120-H",
  authoredAgainstSha256: "dffaa4d3079cc0ba14e7f50c823bf19ff9595c54c274d03ffe859c60382eab6f",
  revision: "2025",
  fieldMap: FIELD_MAP,
  includePages: null,
  mirror: [],
  dueRule: "FY_END + 4 MONTHS, DAY 15",
  dueRuleCitation: "Instructions for Form 1120-H (2025), When To File",
  filingInstructions:
    "Sign and date page 1 (an officer of the association). Mail it to the address under 'Where To File' in the instructions for your state, or e-file. An association that files 10 or more returns of any type in the calendar year (1099s count) must e-file — don't mail this packet in that case.",
  filingCitation: "Instructions for Form 1120-H (2025), Where To File; Electronic Filing",
  notes:
    "Fiscal years ending June 30 are due in the 3rd month, not the 4th. A due date on a Saturday, Sunday or legal holiday moves to the next business day. Extension: Form 7004. The election to file 1120-H is made each year by filing it on time. " +
    "Left blank on purpose: room or suite (f1_06), country (f1_09), the final return / name change / address change / amended return boxes, line 18 (the $100 is preprinted), direct deposit (lines 26c–26e), the signer's title, and the paid-preparer block.",
  authoredOn: "2026-10-11",
};
