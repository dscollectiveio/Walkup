// Where a problem is in its life, for the board's pipeline and list pills
// (repairs-spec §4.4). Owners have no bid counts; their UI shows statuses,
// never stages. Pure.

import type { TicketPriority, TicketStatus } from "./labels";

export type Stage = "new" | "quoting" | "chosen" | "scheduled" | "in_progress" | "fixed" | "closed";
export const STAGES: Stage[] = ["new", "quoting", "chosen", "scheduled", "in_progress", "fixed", "closed"];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  quoting: "Getting quotes",
  chosen: "Contractor chosen",
  scheduled: "Visit planned",
  in_progress: "Being worked on",
  fixed: "Fixed",
  closed: "Closed",
};

export interface BidCounts { requested: number; received: number; accepted: number }

/**
 * Rules in order: closed; resolved is fixed; a visit today or later is
 * scheduled; in progress or waiting on the contractor is in progress; quotes
 * asked for or received with none accepted is quoting; a contractor chosen
 * while still open (nobody has told them yet) is chosen; otherwise new.
 */
export function ticketStage(
  t: { status: TicketStatus; assigned_vendor_id: string | null; scheduled_for: string | null },
  bids: BidCounts,
  todayIso: string,
): Stage {
  if (t.status === "closed") return "closed";
  if (t.status === "resolved") return "fixed";
  if (t.scheduled_for && t.scheduled_for.slice(0, 10) >= todayIso.slice(0, 10)) return "scheduled";
  if (t.status === "in_progress" || t.status === "waiting_on_contractor") return "in_progress";
  if (bids.requested + bids.received > 0 && bids.accepted === 0) return "quoting";
  if (t.assigned_vendor_id) return "chosen";
  return "new";
}

export interface SortableTicket {
  emergency_kind: string | null;
  priority: TicketPriority;
  /** From ticket_board_details; null for owners, who never sort by it. */
  due_on: string | null;
  created_at: string;
  reference?: number;
}

/** Sort used by sort=priority: emergencies, then urgent, then overdue target dates, then newest. */
export function compareForTriage(a: SortableTicket, b: SortableTicket, todayIso: string): number {
  const today = todayIso.slice(0, 10);
  const flag = (t: SortableTicket) => [
    t.emergency_kind ? 0 : 1,
    t.priority === "urgent" ? 0 : 1,
    t.due_on && t.due_on.slice(0, 10) < today ? 0 : 1,
  ];
  const fa = flag(a);
  const fb = flag(b);
  for (let i = 0; i < fa.length; i++) if (fa[i] !== fb[i]) return fa[i] - fb[i];
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return (b.reference ?? 0) - (a.reference ?? 0);
}
