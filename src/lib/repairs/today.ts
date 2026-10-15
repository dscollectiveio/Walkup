// The board's Today view (repairs-spec §15.1): everything that needs a
// person this week, assembled from rows the page already loaded. Pure, so
// every rule and every sentence is unit-tested.

import type { ComplianceItem } from "@/lib/contractors/compliance";
import { toCents } from "@/lib/tax/form1120h";
import { EMERGENCY_KIND_LABEL, type EmergencyKind } from "./emergency";
import { buildingTodayIso } from "@/lib/dates";
import { humanDate } from "./format";
import { isDone, type TicketPriority, type TicketStatus } from "./labels";
import { ticketStage, type BidCounts } from "./stage";

export type TodaySection = "emergencies" | "new" | "decide" | "visits" | "overdue" | "coming_up" | "close";
export const TODAY_SECTIONS: readonly TodaySection[] = ["emergencies", "new", "decide", "visits", "overdue", "coming_up", "close"];

export const TODAY_SECTION_TITLE: Record<TodaySection, string> = {
  emergencies: "Emergencies",
  new: "New since your last visit",
  decide: "Needs a decision",
  visits: "Visits this week",
  overdue: "Overdue",
  coming_up: "Coming up",
  close: "Ready to close",
};

export interface TodayItem {
  key: string;
  section: TodaySection;
  title: string;
  detail: string;
  href: string;
  action: { label: string; href: string } | null;
  sortDate: string;
  /** The "close" row: the fixed problems "Close all" closes. */
  ticketIds?: string[];
}

export interface TodayTicket {
  id: string;
  reference: number;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  emergency_kind: string | null;
  due_on: string | null;
  scheduled_for: string | null;
  scheduled_window: string | null;
  assigned_vendor_id: string | null;
  contractor_name: string | null;
  resolved_at: string | null;
  opened_on: string;
  created_at: string;
  reporter_is_me: boolean;
  /** whereLabel(unit, location detail). */
  where: string;
  triage_emergency: string | null;
  emergency_suggestion_dismissed_at: string | null;
  triage_at: string | null;
  bids: BidCounts & { expiringSoon: number; expiringOn: string | null };
  reopenedAt: string | null;
}

export interface TodayInput {
  todayIso: string;
  /** From mark_repairs_seen; null on a first visit (then: the last 7 days). */
  since: string | null;
  tickets: TodayTicket[];
  /** contractor_messages of kind quote_request still in draft. */
  unsentQuoteRequests: number;
  tasks: { id: string; name: string; next_due_on: string }[];
  /** Contractors in use only. */
  contractors: { id: string; name: string; compliance: ComplianceItem[] }[];
  bills: { id: string; name: string; next_due_on: string | null; autopay_arranged: boolean; paused_at: string | null }[];
  spending: { ticketCents: number; upkeepCents: number };
}

export interface TodayStats {
  open: number;
  urgent: number;
  upkeepOverdue: number;
  visitsThisWeek: number;
  recordedCostsCents: number;
}

export const NEW_LIMIT = 10;
const DAY_MS = 86_400_000;

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.UTC(...ymd(fromIso));
  const b = Date.UTC(...ymd(toIso));
  return Math.round((b - a) / DAY_MS);
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y, m - 1, d];
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function kindWords(kind: string): string {
  const label = (EMERGENCY_KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/_/g, " ");
  return label.charAt(0).toLowerCase() + label.slice(1);
}

const ticketHref = (id: string) => `/maintenance/${id}`;

/** An AI "possible emergency" the board hasn't dismissed (a newer suggestion shows again). */
export function possibleEmergency(t: Pick<TodayTicket, "emergency_kind" | "triage_emergency" | "triage_at" | "emergency_suggestion_dismissed_at">): string | null {
  if (t.emergency_kind) return null;
  if (!t.triage_emergency || t.triage_emergency === "none") return null;
  if (t.emergency_suggestion_dismissed_at) {
    const dismissed = Date.parse(t.emergency_suggestion_dismissed_at);
    const at = t.triage_at ? Date.parse(t.triage_at) : NaN;
    if (!(at > dismissed)) return null;
  }
  return t.triage_emergency;
}

export function buildToday(input: TodayInput): { sections: Record<TodaySection, TodayItem[]>; stats: TodayStats } {
  const today = input.todayIso.slice(0, 10);
  const sections = Object.fromEntries(TODAY_SECTIONS.map((s) => [s, [] as TodayItem[]])) as Record<TodaySection, TodayItem[]>;
  const open = input.tickets.filter((t) => !isDone(t.status));
  const sinceMs = input.since ? Date.parse(input.since) : Date.UTC(...ymd(addDays(today, -7)));

  // Emergencies, rule-set first, then the AI's suggestions.
  const emergencyIds = new Set<string>();
  for (const t of open) {
    if (t.emergency_kind) {
      emergencyIds.add(t.id);
      sections.emergencies.push({
        key: `emergency-${t.id}`,
        section: "emergencies",
        title: `#${t.reference} ${t.title}`,
        detail: `Emergency: ${kindWords(t.emergency_kind)} · reported ${humanDate(t.opened_on, today)}`,
        href: ticketHref(t.id),
        action: { label: "Open", href: ticketHref(t.id) },
        sortDate: t.created_at,
      });
    }
  }
  for (const t of open) {
    const kind = possibleEmergency(t);
    if (!kind) continue;
    emergencyIds.add(t.id);
    sections.emergencies.push({
      key: `possible-${t.id}`,
      section: "emergencies",
      title: `#${t.reference} ${t.title}`,
      detail: `Possible emergency (AI suggestion): ${kindWords(kind as EmergencyKind)}`,
      href: ticketHref(t.id),
      action: { label: "Check it", href: ticketHref(t.id) },
      sortDate: t.created_at,
    });
  }

  // New since the last visit: someone else's reports, newest first.
  const fresh = input.tickets
    .filter((t) => !t.reporter_is_me && !emergencyIds.has(t.id) && Date.parse(t.created_at) > sinceMs)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const t of fresh.slice(0, NEW_LIMIT)) {
    sections.new.push({
      key: `new-${t.id}`,
      section: "new",
      title: `#${t.reference} ${t.title}`,
      detail: `Reported ${humanDate(t.opened_on, today)} · ${t.where}`,
      href: ticketHref(t.id),
      action: { label: "Open", href: ticketHref(t.id) },
      sortDate: t.created_at,
    });
  }
  if (fresh.length > NEW_LIMIT) {
    const k = fresh.length - NEW_LIMIT;
    sections.new.push({
      key: "new-more",
      section: "new",
      title: `and ${k} more`,
      detail: "",
      href: "/repairs?view=problems&sort=newest",
      action: null,
      sortDate: "",
    });
  }

  // Decisions.
  for (const t of open) {
    const stage = ticketStage(t, t.bids, today);
    const title = `#${t.reference} ${t.title}`;
    if (stage === "new" && t.opened_on.slice(0, 10) < today) {
      sections.decide.push({
        key: `decide-new-${t.id}`, section: "decide", title, detail: "Nobody is on this yet.",
        href: ticketHref(t.id), action: { label: "Get quotes", href: `${ticketHref(t.id)}?open=quotes` }, sortDate: t.created_at,
      });
    } else if (stage === "quoting" && (t.bids.received >= 2 || (t.bids.received >= 1 && t.bids.requested === 0))) {
      sections.decide.push({
        key: `decide-quotes-${t.id}`, section: "decide", title, detail: "Quotes are in. Compare and choose.",
        href: ticketHref(t.id), action: { label: "Compare quotes", href: `${ticketHref(t.id)}#quotes` }, sortDate: t.created_at,
      });
    } else if (stage === "chosen") {
      sections.decide.push({
        key: `decide-chosen-${t.id}`, section: "decide", title,
        detail: `${t.contractor_name ?? "A contractor"} was chosen but hasn't been told.`,
        href: ticketHref(t.id), action: { label: "Send the go-ahead", href: `${ticketHref(t.id)}?open=go-ahead` }, sortDate: t.created_at,
      });
    }
    if (t.bids.expiringSoon > 0 && t.bids.expiringOn) {
      sections.decide.push({
        key: `decide-expiring-${t.id}`, section: "decide", title,
        detail: `A quote expires ${humanDate(t.bids.expiringOn, today)}.`,
        href: ticketHref(t.id), action: { label: "Compare quotes", href: `${ticketHref(t.id)}#quotes` }, sortDate: t.bids.expiringOn,
      });
    }
    if (t.reopenedAt && Date.parse(t.reopenedAt) >= Date.UTC(...ymd(addDays(today, -14)))) {
      sections.decide.push({
        key: `decide-reopened-${t.id}`, section: "decide", title, detail: "Reopened by the reporter.",
        href: ticketHref(t.id), action: { label: "Open", href: ticketHref(t.id) }, sortDate: t.reopenedAt,
      });
    }
  }
  if (input.unsentQuoteRequests > 0) {
    const n = input.unsentQuoteRequests;
    sections.decide.push({
      key: "decide-unsent", section: "decide",
      title: `${n} quote ${plural(n, "request")} drafted but not marked sent.`, detail: "",
      href: "/repairs?view=contractors#emails",
      action: { label: "Review them", href: "/repairs?view=contractors#emails" }, sortDate: "",
    });
  }

  // Visits this week.
  const weekEnd = addDays(today, 7);
  for (const t of open) {
    const d = t.scheduled_for?.slice(0, 10);
    if (!d || d < today || d > weekEnd) continue;
    const window = t.scheduled_window?.trim();
    sections.visits.push({
      key: `visit-${t.id}`, section: "visits", title: `#${t.reference} ${t.title}`,
      detail: `Visit ${humanDate(d, today)}${window ? `, ${window}` : ""} · ${t.contractor_name ?? "No contractor yet"}`,
      href: ticketHref(t.id), action: { label: "Open", href: ticketHref(t.id) }, sortDate: d,
    });
  }
  sections.visits.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  // Overdue: target dates, then upkeep.
  for (const t of open) {
    const due = t.due_on?.slice(0, 10);
    if (!due || due >= today) continue;
    sections.overdue.push({
      key: `due-${t.id}`, section: "overdue", title: `#${t.reference} ${t.title}`,
      detail: `Target date was ${humanDate(due, today)}.`,
      href: ticketHref(t.id), action: { label: "Open", href: ticketHref(t.id) }, sortDate: due,
    });
  }
  let upkeepOverdue = 0;
  for (const task of input.tasks) {
    const due = task.next_due_on?.slice(0, 10);
    if (!due || due >= today) continue;
    upkeepOverdue += 1;
    const days = dayDiff(due, today);
    sections.overdue.push({
      key: `upkeep-${task.id}`, section: "overdue", title: task.name,
      detail: `${days} ${plural(days, "day")} overdue`,
      href: `/repairs/upkeep/${task.id}`, action: { label: "Mark done", href: `/repairs/upkeep/${task.id}` }, sortDate: due,
    });
  }
  sections.overdue.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  // Coming up: upkeep in 30 days, paperwork, manual bills in 14.
  const in30 = addDays(today, 30);
  const in14 = addDays(today, 14);
  for (const task of input.tasks) {
    const due = task.next_due_on?.slice(0, 10);
    if (!due || due < today || due > in30) continue;
    sections.coming_up.push({
      key: `soon-${task.id}`, section: "coming_up", title: task.name, detail: `Upkeep due ${humanDate(due, today)}`,
      href: `/repairs/upkeep/${task.id}`, action: { label: "Open", href: `/repairs/upkeep/${task.id}` }, sortDate: due,
    });
  }
  for (const c of input.contractors) {
    for (const item of c.compliance) {
      if (!(item.tone === "bad" || item.key === "coi_soon" || item.key === "license_soon")) continue;
      sections.coming_up.push({
        key: `paper-${c.id}-${item.key}`, section: "coming_up", title: c.name, detail: item.text,
        href: `/contractors/${c.id}`, action: { label: "Open", href: `/contractors/${c.id}` }, sortDate: today,
      });
    }
  }
  for (const b of input.bills) {
    const due = b.next_due_on?.slice(0, 10);
    if (!due || b.autopay_arranged || b.paused_at || due > in14) continue;
    sections.coming_up.push({
      key: `bill-${b.id}`, section: "coming_up", title: b.name,
      detail: due < today ? `Bill was due ${humanDate(due, today)}` : `Bill due ${humanDate(due, today)}`,
      href: "/repairs?view=bills", action: { label: "Open", href: "/repairs?view=bills" }, sortDate: due,
    });
  }
  sections.coming_up.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

  // Ready to close: one row for every fixed problem past its 30-day confirm window.
  const closeCutoff = Date.UTC(...ymd(addDays(today, -30)));
  const closable = input.tickets.filter((t) => t.status === "resolved" && t.resolved_at && Date.parse(t.resolved_at) < closeCutoff);
  if (closable.length > 0) {
    const n = closable.length;
    sections.close.push({
      key: "close-all", section: "close",
      title: `${n} fixed ${plural(n, "problem")} nobody reopened in 30 days.`, detail: "",
      href: "/repairs?view=problems&stage=fixed",
      action: { label: "See them", href: "/repairs?view=problems&stage=fixed" },
      sortDate: "", ticketIds: closable.map((t) => t.id).slice(0, 50),
    });
  }

  const stats: TodayStats = {
    open: open.length,
    urgent: open.filter((t) => t.priority === "urgent" || t.emergency_kind).length,
    upkeepOverdue,
    visitsThisWeek: sections.visits.length,
    recordedCostsCents: input.spending.ticketCents + input.spending.upkeepCents,
  };
  return { sections, stats };
}

/** True when nothing in any section needs the board. */
export function todayIsEmpty(sections: Record<TodaySection, TodayItem[]>): boolean {
  return TODAY_SECTIONS.every((s) => sections[s].length === 0);
}

/**
 * "Recorded repair costs this year", in cents: final costs of problems
 * resolved this calendar year, plus upkeep costs logged this year that a
 * problem's close-out didn't write (those carry the problem's final cost,
 * which is already counted).
 */
export function recordedRepairCosts(input: {
  year: number;
  tickets: { actual_cost: string | null; resolved_at: string | null }[];
  upkeepLog: { cost: string | null; done_on: string; ticket_id: string | null }[];
}): { ticketCents: number; upkeepCents: number } {
  const y = String(input.year);
  // The year a problem was fixed in is the building's (Chicago) year, not the UTC one:
  // 8 pm on 31 December in Chicago is already January in UTC.
  const yearOf = (instant: string): string => {
    const d = new Date(instant);
    return Number.isNaN(d.getTime()) ? instant.slice(0, 4) : buildingTodayIso(d).slice(0, 4);
  };
  let ticketCents = 0;
  for (const t of input.tickets) {
    if (t.actual_cost && t.resolved_at && yearOf(t.resolved_at) === y) ticketCents += toCents(t.actual_cost);
  }
  let upkeepCents = 0;
  for (const l of input.upkeepLog) {
    if (l.cost && l.ticket_id === null && l.done_on.slice(0, 4) === y) upkeepCents += toCents(l.cost);
  }
  return { ticketCents, upkeepCents };
}
