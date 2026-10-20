// The board's own tracker on each line of the open-problems list. Separate
// from the ticket's lifecycle status because it also tracks payment. Pure.

import type { Stage } from "./stage";

export const WORK_STATUSES = [
  "not_started",
  "quotes_sent",
  "contractor_selected",
  "work_in_progress",
  "issue",
  "completed_unpaid",
  "completed_paid",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  not_started: "Not Started",
  quotes_sent: "Quotes Sent",
  contractor_selected: "Contractor Selected",
  work_in_progress: "Work in Progress",
  issue: "Issue / Problem",
  completed_unpaid: "Completed - Not Paid",
  completed_paid: "Completed - Paid",
};

/** "1. Not Started" ... "7. Completed - Paid": the label with its place in the order. */
export function numberedWorkStatus(s: WorkStatus): string {
  return `${WORK_STATUSES.indexOf(s) + 1}. ${WORK_STATUS_LABEL[s]}`;
}

/** Statuses that come before a contractor is chosen: the ones where asking for quotes still makes sense. */
export function beforeContractorSelected(s: WorkStatus): boolean {
  return s === "not_started" || s === "quotes_sent";
}

/** A contractor has been chosen: Contractor Selected or any status after it. */
export function atOrPastContractorSelected(s: WorkStatus): boolean {
  return WORK_STATUSES.indexOf(s) >= WORK_STATUSES.indexOf("contractor_selected");
}

export function isWorkStatus(v: unknown): v is WorkStatus {
  return typeof v === "string" && (WORK_STATUSES as readonly string[]).includes(v);
}

/**
 * What a line shows before the board has chosen: worked out from where the
 * problem is. Quotes asked for means Quotes Sent, a contractor chosen (or a
 * visit planned) means Contractor Selected, being worked on means Work in Progress, fixed means Completed - Not Paid (nothing says it was paid),
 * and everything else is Not Started.
 */
export function defaultWorkStatus(stage: Stage): WorkStatus {
  switch (stage) {
    case "quoting":
      return "quotes_sent";
    case "chosen":
    case "scheduled":
      return "contractor_selected";
    case "in_progress":
      return "work_in_progress";
    case "fixed":
    case "closed":
      return "completed_unpaid";
    default:
      return "not_started";
  }
}

/** The status to show: the board's choice, else the default for the stage. */
export function effectiveWorkStatus(chosen: string | null, stage: Stage): WorkStatus {
  return isWorkStatus(chosen) ? chosen : defaultWorkStatus(stage);
}
