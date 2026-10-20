// Illinois Form IL-1120 (2025), Corporation Income and Replacement Tax Return.
// Walkup never fills it — a link-only template carrying the due rule and what
// the Illinois Department of Revenue says an 1120-H filer owes the state,
// each with its source. Everything else is "ask your CPA".

import type { SuggestedTemplate } from "./index";

export const IL_1120_2025: SuggestedTemplate = {
  key: "il_1120_2025",
  formCode: "il_1120",
  taxYear: 2025,
  kind: "link_only",
  sourceUrl: "https://tax.illinois.gov/forms/incometax/currentyear/business-corporate.html",
  instructionsUrl: "https://tax.illinois.gov/research/taxinformation/income/corporate.html",
  expectedTitle: null,
  authoredAgainstSha256: null,
  revision: "2025",
  fieldMap: {},
  includePages: null,
  mirror: [],
  dueRule: "FY_END + 4 MONTHS, DAY 15",
  dueRuleCitation:
    "2025 Form IL-1120 Instructions; Illinois Department of Revenue, Corporate Income Tax, due dates: Form IL-1120 is due on or before the 15th day of the 4th month following the close of the tax year (same as federal); June 30 year ends: the 3rd month",
  filingInstructions: null,
  filingCitation: null,
  notes:
    "Illinois DOR: an association that files federal Form 1120-H files Form IL-1120 for Illinois (Step 2, Line 1 corresponds to Form 1120-H line 19, taxable income). Illinois grants an automatic 7-month filing extension (8 months for June 30 year ends) with no form to file; any payment is still due on the original date. Ask your CPA what to attach. Walkup doesn't fill IL-1120.",
  authoredOn: "2026-10-11",
};
