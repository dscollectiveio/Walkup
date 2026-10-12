// Form 1096 (2026), Annual Summary and Transmittal of U.S. Information Returns.
// Only needed with paper 1099s, and the IRS copy must be an official red-ink
// form — the PDF on irs.gov can't be filed — so Walkup never produces one.
// A link-only template: the due rule and where it goes, each with its source.

import type { SuggestedTemplate } from "./index";

export const IRS_1096_2026: SuggestedTemplate = {
  key: "irs_1096_2026",
  formCode: "irs_1096",
  taxYear: 2026,
  kind: "link_only",
  sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1096",
  instructionsUrl: "https://www.irs.gov/instructions/i1099gi",
  expectedTitle: null,
  authoredAgainstSha256: null,
  revision: "2026",
  fieldMap: {},
  includePages: null,
  mirror: [],
  dueRule: "CAL_YEAR_END + 1 MONTHS, DAY 31",
  dueRuleCitation: "Form 1096 (2026), When To File: 'With Forms 1099-NEC, file by January 31'",
  filingInstructions:
    "Only if you file 1099s on paper: order the official red-ink Form 1096 from the IRS and mail it with Copy A of each 1099-NEC to the address printed on the form. Not needed when you file through IRIS. Do not print and file the PDF from irs.gov — it can't be scanned.",
  filingCitation:
    "Form 1096 (2026), Where To File and the caution on page 1; General Instructions for Certain Information Returns, Part E. Filing Returns With the IRS and Part G. Paper Document Reporting",
  notes: "Only with paper 1099s; not used when filing through IRIS. Do not print and file the PDF from irs.gov — order official forms.",
  authoredOn: "2026-10-11",
};
