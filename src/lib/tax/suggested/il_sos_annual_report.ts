// Illinois Secretary of State — not-for-profit corporation annual report.
// Filed online, never from a PDF, so this is a link-only template: the due
// rule, where to file and what it costs, each with its source. ilsos.gov
// blocks automated checks, so a person confirms these links (the admin page
// records "blocked" rather than pretending).

import type { SuggestedTemplate } from "./index";

export const IL_SOS_ANNUAL_REPORT: SuggestedTemplate = {
  key: "il_sos_annual_report_2026",
  formCode: "il_sos_annual_report",
  taxYear: 2026,
  kind: "link_only",
  sourceUrl: "https://www.ilsos.gov/departments/business-services/annual-reports.html",
  instructionsUrl: "https://www.ilsos.gov/departments/business-services/annual-reports/nfp-instructions.html",
  expectedTitle: null,
  authoredAgainstSha256: null,
  revision: "2026",
  fieldMap: {},
  includePages: null,
  mirror: [],
  // The last day of the month before the anniversary month — the end of the
  // statutory window, stated as a date a board can put on a calendar.
  dueRule: "INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS, DAY LAST",
  dueRuleCitation: "805 ILCS 105/114.10: the annual report is delivered within the 60 days immediately preceding the first day of the anniversary month",
  filingInstructions:
    "File online at apps.ilsos.gov/nfpannualreports. You'll need the corporation file number. Fee $10 ($25 expedited). A $3 penalty applies if it isn't filed before the first day of the anniversary month, and not filing is a ground for administrative dissolution.",
  filingCitation: "805 ILCS 105/115.10(m), 105/112.35; ILSOS 'File an Annual Report'",
  notes: "Illinois not-for-profit corporations only. ilsos.gov blocks automated checks. A person confirms these links.",
  authoredOn: "2026-10-11",
};
