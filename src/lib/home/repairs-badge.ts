// The Repairs & Upkeep sidebar badge (repairs-spec §18.6): how many things
// there are worth opening Repairs for. The queries live in the root layout;
// the rules live here so they can be tested. Pure.

import { possibleEmergency } from "@/lib/repairs/today";

/** Open tickets as the board sees them, with the AI triage fields. */
export interface BadgeTicket {
  id: string;
  status: string;
  priority: string;
  emergency_kind: string | null;
  created_at: string;
  /** reported_by is the viewer. */
  mine: boolean;
  triage_emergency: string | null;
  triage_at: string | null;
  emergency_suggestion_dismissed_at: string | null;
}

const DONE = new Set(["resolved", "closed"]);

/**
 * Board: open problems that are urgent or an emergency, AI-suggested
 * emergencies nobody has dismissed, and someone else's reports since the
 * viewer last opened Repairs (each problem counted once), plus upkeep jobs
 * past their date. `since` follows loadRepairsSince(); a first visit counts
 * the last 7 days, as Today does.
 */
export function boardRepairsCount(input: {
  tickets: BadgeTicket[];
  since: string | null;
  overdueUpkeep: number;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const sinceMs = input.since ? Date.parse(input.since) : now.getTime() - 7 * 86_400_000;
  const ids = new Set<string>();
  for (const t of input.tickets) {
    if (DONE.has(t.status)) continue;
    const pressing = t.priority === "urgent" || t.emergency_kind !== null || possibleEmergency(t) !== null;
    const fresh = !t.mine && Date.parse(t.created_at) > sinceMs;
    if (pressing || fresh) ids.add(t.id);
  }
  return ids.size + Math.max(0, input.overdueUpkeep);
}

/**
 * Owner: updates someone else made, since their last visit, on problems they
 * reported or in their own units (the events RLS lets them read), plus their
 * own reports marked fixed in the last 30 days, which wait for them to
 * confirm the fix. Each problem counted once.
 */
export function ownerRepairsCount(input: {
  events: { ticket_id: string; reported_by: string | null; unit_id: string | null }[];
  myPersonId: string | null;
  myUnitIds: Set<string>;
  awaitingConfirmation: string[];
}): number {
  const ids = new Set<string>(input.awaitingConfirmation);
  for (const e of input.events) {
    const mine = input.myPersonId !== null && e.reported_by === input.myPersonId;
    const myUnit = e.unit_id !== null && input.myUnitIds.has(e.unit_id);
    if (mine || myUnit) ids.add(e.ticket_id);
  }
  return ids.size;
}
