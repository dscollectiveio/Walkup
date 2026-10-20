// Ticket words: statuses, urgency, and one plain sentence per timeline event
// (repairs-spec §4.1). Pure; client components may import it.

import { tradeLabel } from "@/lib/contractors/trades";
import { humanDate, moneyText } from "./format";

export type TicketStatus = "open" | "in_progress" | "waiting_on_contractor" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "urgent";

export const TICKET_STATUSES: readonly TicketStatus[] = ["open", "in_progress", "waiting_on_contractor", "resolved", "closed"];
export const TICKET_PRIORITIES: readonly TicketPriority[] = ["urgent", "normal", "low"];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "Being worked on",
  waiting_on_contractor: "Waiting on contractor",
  resolved: "Fixed",
  closed: "Closed",
};
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  urgent: "Urgent",
};
export const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, normal: 1, low: 2 };
export const DONE_STATUSES: readonly TicketStatus[] = ["resolved", "closed"];

export function isDone(s: TicketStatus): boolean {
  return DONE_STATUSES.includes(s);
}

/** The 23 kinds of public.ticket_events (0053), in the check constraint's order. */
export const EVENT_KINDS = [
  "created", "status_changed", "reopened", "priority_changed",
  "contractor_assigned", "contractor_removed", "assignee_changed",
  "scheduled", "schedule_cleared", "due_changed", "trade_changed",
  "details_edited", "estimate_changed", "final_cost_recorded",
  "expense_linked", "resolution_noted", "marked_duplicate",
  "note_added", "photo_added",
  "quote_requested", "quote_received", "quote_accepted", "quote_declined",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface TicketEventRow {
  id: string;
  kind: EventKind;
  from_value: string | null;
  to_value: string | null;
  data: Record<string, unknown>;
  created_at: string;
  actor_person_id: string | null;
}

/** Who did it, as the viewer may know it. Board and accountant viewers get names; owners get roles from ticket_event_actor_roles(). */
export type Actor =
  | { kind: "name"; name: string }
  | { kind: "you" }
  | { kind: "board" }
  | { kind: "accountant" }
  | { kind: "owner" }
  | { kind: "unknown" };

export function actorWord(a: Actor): string {
  switch (a.kind) {
    case "name":
      return a.name.trim() || "Someone";
    case "you":
      return "You";
    case "board":
      return "The board";
    case "accountant":
      return "The building's accountant";
    case "owner":
      return "Another owner";
    default:
      return "Someone";
  }
}

/** The words for the fields a details_edited event names (0053 writes these keys). */
const FIELD_WORDS: Record<string, string> = {
  title: "title",
  description: "description",
  location_detail: "location",
  access_notes: "access notes",
  unit: "unit",
};

function joinWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Event values come from the database as text; a value that isn't money shows as written instead of breaking the timeline. */
function money(v: string): string {
  try {
    return moneyText(v);
  } catch {
    return v;
  }
}

const statusWords = (s: string | null) =>
  s && s in STATUS_LABEL ? STATUS_LABEL[s as TicketStatus].toLowerCase() : "updated";

/** One plain sentence per event (exact copy in repairs-spec §4.1). */
export function eventSentence(e: TicketEventRow, actor: Actor, todayIso: string): string {
  const who = actorWord(actor);
  const data = e.data ?? {};
  const contractor = text(data.contractor_name) ?? "a contractor";
  switch (e.kind) {
    case "created":
      return `${who} reported this.`;
    case "status_changed":
      return `${who} marked it ${statusWords(e.to_value)}.`;
    case "reopened":
      return `${who} reopened it.`;
    case "priority_changed": {
      const label = e.to_value && e.to_value in PRIORITY_LABEL ? PRIORITY_LABEL[e.to_value as TicketPriority] : e.to_value;
      return `${who} changed the urgency to "${label}".`;
    }
    case "contractor_assigned":
      return `${who} chose ${contractor} for this job.`;
    case "contractor_removed":
      return `${who} took the contractor off this.`;
    case "assignee_changed":
      return `${who} changed who on the board is following this.`;
    case "scheduled": {
      const window = text(data.window);
      return e.to_value
        ? `Visit planned for ${humanDate(e.to_value, todayIso)}${window ? `, ${window}` : ""}.`
        : "The planned visit was cancelled.";
    }
    case "schedule_cleared":
      return "The planned visit was cancelled.";
    case "due_changed":
      return e.to_value ? `${who} set the target date to ${humanDate(e.to_value, todayIso)}.` : `${who} removed the target date.`;
    case "trade_changed":
      return e.to_value ? `Kind of work set to ${tradeLabel(e.to_value)}.` : "Kind of work cleared.";
    case "details_edited": {
      const fields = Array.isArray(data.fields)
        ? data.fields.filter((f): f is string => typeof f === "string").map((f) => FIELD_WORDS[f] ?? f.replace(/_/g, " "))
        : [];
      return fields.length ? `${who} updated the ${joinWords(fields)}.` : `${who} updated the details.`;
    }
    case "estimate_changed":
      return e.to_value ? `Estimate set to ${money(e.to_value)}.` : "Estimate removed.";
    case "final_cost_recorded":
      return e.to_value ? `Final cost recorded: ${money(e.to_value)}.` : "Final cost removed.";
    case "expense_linked":
      return "Linked to a payment in the books.";
    case "resolution_noted":
      return `${who} wrote what was done.`;
    case "marked_duplicate": {
      const ref = data.duplicate_of_reference;
      return typeof ref === "number" || typeof ref === "string"
        ? `Closed as a duplicate of #${ref}.`
        : "Closed as a duplicate of another problem.";
    }
    case "note_added":
      // The ticket page renders the note itself; this line is for lists.
      return `${who} added a note.`;
    case "photo_added":
      return `${who} added a photo.`;
    case "quote_requested":
      return data.by_phone === true ? `${who} called ${contractor} for a quote.` : `Quote requested from ${contractor}.`;
    case "quote_received": {
      const amount = text(data.amount);
      return amount ? `Quote received from ${contractor}: ${money(amount)}.` : `Quote received from ${contractor}.`;
    }
    case "quote_accepted":
      return `${capitalise(contractor)}'s quote was accepted.`;
    case "quote_declined":
      return `${capitalise(contractor)}'s quote was not chosen.`;
    default:
      return `${who} updated this.`;
  }
}

function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
