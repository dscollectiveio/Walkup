// Form 1099-NEC (Rev. December 2026), Nonemployee Compensation — for payments
// made in calendar year 2026, furnished and filed from January 2027. Authored
// 2026-10-11 against https://www.irs.gov/pub/irs-pdf/f1099nec.pdf: six pages
// (1 Attention, 2 Copy A, 3 Copy 1, 4 Copy B, 5 Instructions for Recipient,
// 6 Copy 2), 140 AcroForm fields; tests/fixtures/tax/f1099nec-2026-fields.json
// lists them with their pages.
//
// Only Copy B is mapped. Exports keep pages 4–6 (the recipient's copies) and
// mirror every Copy B value onto the same-named Copy 2 box. Copy A and Form
// 1096 are never produced: printed from this PDF they aren't scannable and
// can't be filed. The recipient's TIN box is not in this map and never will
// be — Walkup keeps only the last four digits (DECISIONS #4).

import type { FieldMap, MapEntry } from "../autofill";
import type { SuggestedTemplate } from "./index";

const P = "topmostSubform[0].CopyB[0].";
const f = (suffix: string) => `${P}${suffix}`;

const FORM = "Form 1099-NEC (Rev. December 2026), Copy B";
const PART_J = "General Instructions for Certain Information Returns, Part J. Recipient Names and Taxpayer Identification Numbers (TINs)";
const PART_K = "General Instructions for Certain Information Returns, Part K. Filer's Name, Taxpayer Identification Number (TIN), and Address";

const S1 = "1. Your association (payer)";
const S2 = "2. Contractor (recipient)";
const S3 = "3. Amounts";

/** A payer box filled from Building Info. */
const payer = (label: string, rule: string, box: string): MapEntry => ({
  label,
  section: S1,
  source: "setting",
  rule,
  citation: `${FORM} — ${box} box; ${PART_K}`,
  kind: "text",
});

/** A recipient box the board copies from the contractor's W-9 or invoice. */
const typed = (label: string, box: string): MapEntry => ({
  label,
  section: S2,
  source: "manual",
  rule: "",
  citation: `${FORM} — ${box} box under RECIPIENT'S name`,
  kind: "text",
  hint: "Copy it from the contractor's W-9 or invoice.",
});

const FIELD_MAP: FieldMap = {
  // ---- 1. Your association (payer) --------------------------------------------------
  [f("PgHeader[0].CalendarYear[0].f2_1[0]")]: {
    label: "Calendar year",
    section: S1,
    source: "setting",
    rule: "form.tax_year",
    citation: `${FORM} — 'For calendar year' box; Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026), Reminders — Filing dates`,
    kind: "text",
  },
  [f("LeftCol[0].f2_2[0]")]: payer("Payer's name", "association.legal_name", "PAYER'S name"),
  [f("LeftCol[0].f2_3[0]")]: payer("Payer's street address", "association.street_address", "PAYER'S street address"),
  [f("LeftCol[0].f2_5[0]")]: payer("Payer's city", "association.city", "PAYER'S city or town"),
  [f("LeftCol[0].f2_7[0]")]: payer("Payer's state", "association.state_code", "PAYER'S state or province"),
  [f("LeftCol[0].f2_9[0]")]: payer("Payer's ZIP", "association.postal_code", "PAYER'S ZIP or foreign postal code"),
  [f("LeftCol[0].f2_10[0]")]: payer("Payer's TIN (your EIN)", "association.ein", "PAYER'S TIN"),

  // ---- 2. Contractor (recipient) ----------------------------------------------------
  [f("LeftCol[0].f2_12[0]")]: {
    label: "Recipient's name",
    section: S2,
    source: "contractors",
    rule: "contractor.name",
    citation: `${FORM} — RECIPIENT'S name box; ${PART_J}`,
    kind: "text",
  },
  [f("LeftCol[0].f2_13[0]")]: {
    label: "Recipient's street address",
    section: S2,
    source: "contractors",
    rule: "contractor.address",
    citation: `${FORM} — Street address (including apt. no.) box under RECIPIENT'S name`,
    kind: "text",
    review: true,
    hint: "Walkup keeps one address line — split it across the street, city, state and ZIP boxes if you can.",
  },
  [f("LeftCol[0].f2_15[0]")]: typed("Recipient's city", "City or town"),
  [f("LeftCol[0].f2_16[0]")]: typed("Recipient's state", "State or province"),
  [f("LeftCol[0].f2_18[0]")]: typed("Recipient's ZIP", "ZIP or foreign postal code"),

  // ---- 3. Amounts -----------------------------------------------------------------
  [f("RightCol[0].f2_20[0]")]: {
    label: "Box 1a — Nonemployee compensation",
    section: S3,
    source: "contractors",
    rule: "contractor.total_paid",
    citation: `${FORM} — box 1a Nonemployee compensation; Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026), Specific Instructions for Form 1099-NEC — Box 1a. Nonemployee Compensation`,
    kind: "money",
  },
};

export const IRS_1099_NEC_2026: SuggestedTemplate = {
  key: "irs_1099_nec_2026",
  formCode: "irs_1099_nec",
  taxYear: 2026,
  kind: "pdf",
  sourceUrl: "https://www.irs.gov/pub/irs-pdf/f1099nec.pdf",
  instructionsUrl: "https://www.irs.gov/instructions/i1099mec",
  expectedTitle: "Form 1099-NEC (Rev. December 2026)",
  authoredAgainstSha256: "68a8f00078be6dd6a4912cc4209df317b31840d5fe19560222d39df9f2f7ff49",
  revision: "Rev. December 2026",
  fieldMap: FIELD_MAP,
  // Copy B, the recipient's instructions page, and Copy 2 — the contractor's set.
  includePages: [4, 5, 6],
  mirror: [{ from: "CopyB[0]", to: "Copy2[0]" }],
  dueRule: "CAL_YEAR_END + 1 MONTHS, DAY 31",
  dueRuleCitation:
    "Instructions for Forms 1099-MISC and 1099-NEC (Rev. December 2026), Reminders — Filing dates: IRC section 6071(c) requires Form 1099-NEC to be filed on or before January 31; General Instructions for Certain Information Returns, Part C. When To File",
  filingInstructions:
    "Give Copy B (with the instructions page) to the contractor by the due date and keep Copy 2 for your records. Do not print and file Copy A from this PDF — it isn't scannable and the IRS can penalize it. File with the IRS online through IRIS (free; you need a Transmitter Control Code, which takes weeks — apply well before January) or on official red-ink forms ordered from the IRS. If you file 10 or more information returns in total, you must e-file. The contractor's taxpayer ID is left blank on purpose — write it on their copy from their W-9.",
  filingCitation:
    "Form 1099-NEC (Rev. December 2026), page 1 'Attention'; General Instructions for Certain Information Returns, Part E. Filing Returns With the IRS (Copy A printed from the IRS website can't be filed) and Part O. Penalties; Regulations section 301.6011-2 (e-file at 10 or more returns)",
  notes:
    "Copy A and Form 1096 are never produced by Walkup. Boxes 1b–1d (tips, TTOC, overtime) and the state boxes are left blank — ask your CPA if they apply. " +
    "Also left blank on purpose: the recipient's TIN (Walkup keeps only the last four digits — copy it from the W-9), the payer's telephone number, the account number box, boxes 2–7 and the FATCA box. Copy 2 is filled by mirroring Copy B at export.",
  authoredOn: "2026-10-11",
};
