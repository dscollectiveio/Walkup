// Form 1120 (2025), U.S. Corporation Income Tax Return. Walkup never fills it: an association that does not (or may
// not) elect Form 1120-H files Form 1120 instead, and that is a decision for its CPA. This is a link-only template
// carrying the due rule and where the IRS says it comes from, so the Taxes tab can date the form. It stays
// "Estimated, not yet checked" until a platform admin verifies it against the page below as a person.

import type { SuggestedTemplate } from "./index";

export const IRS_1120_2025: SuggestedTemplate = {
  key: "irs_1120_2025",
  formCode: "irs_1120",
  taxYear: 2025,
  kind: "link_only",
  sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1120",
  instructionsUrl: "https://www.irs.gov/instructions/i1120",
  expectedTitle: null,
  authoredAgainstSha256: null,
  revision: "2025",
  fieldMap: {},
  includePages: null,
  mirror: [],
  dueRule: "FY_END + 4 MONTHS, DAY 15",
  dueRuleCitation: "Instructions for Form 1120 (2025), When To File: due on or before the 15th day of the 4th month after the end of the tax year",
  filingInstructions: null,
  filingCitation: null,
  notes:
    "Walkup doesn't fill Form 1120. A tax year ending June 30 follows its own rule in the instructions, so Walkup gives no date for it: ask your CPA. A due date on a Saturday, Sunday or legal holiday moves to the next business day. Extension: Form 7004, which extends the time to file, not the time to pay. Whether Form 1120 or Form 1120-H is right for the association is for your CPA.",
  authoredOn: "2026-10-23",
};
