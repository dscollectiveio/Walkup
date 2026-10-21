// "How to get this date": for a form whose due date Walkup has only estimated (or can't work out), the plain
// steps for finding the real one, and anything the board has to set in Walkup so the date can be worked out.
// Pure, so it is tested without the page. Not tax advice: it points at the form's own instructions.

export interface DueGuide {
  /** What to do, in a sentence or two. */
  how: string;
  /** Things to set in Walkup, each with where. */
  set: { label: string; href: string }[];
}

export interface DueGuideInput {
  formCode: string;
  /** A person has checked the rule, so the date is a checked one. */
  verified: boolean;
  /** Whether the date shown is a date at all (estimated or checked). */
  hasDate: boolean;
  incorporatedOn: string | null;
  /** The fiscal year end, yyyy-mm-dd. */
  fiscalYearEnd: string;
}

export function dueGuide(i: DueGuideInput): DueGuide | null {
  if (i.verified) return null;
  const june = i.fiscalYearEnd.slice(5, 7) === "06";

  switch (i.formCode) {
    case "irs_1120h":
    case "irs_1120":
      return {
        how: june
          ? "A June 30 year-end has its own rule, so ask your CPA for this date."
          : "Usually April 15 for a calendar year. Confirm under When To File in the form's instructions.",
        set: [],
      };
    case "irs_1099_nec":
      return { how: "Due January 31 after the year you paid the contractor. Confirm in the instructions.", set: [] };
    case "irs_1096":
      return { how: "Due January 31 with paper 1099s. Not needed if you file 1099s online.", set: [] };
    case "il_1120":
      return { how: "Illinois usually follows the federal date. Check the state's instructions or ask your CPA.", set: [] };
    case "il_sos_annual_report":
      return i.incorporatedOn
        ? { how: "Due before your incorporation anniversary month. Confirm on the Secretary of State's site.", set: [] }
        : {
            how: "Add the date you incorporated so Walkup can work this out.",
            set: [{ label: "Add your incorporation date", href: "/building" }],
          };
    default:
      return { how: i.hasDate ? "Ask your CPA to confirm this date." : "Ask your CPA what date applies.", set: [] };
  }
}
