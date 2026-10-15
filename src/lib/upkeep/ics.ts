// Upkeep, contractor visits and insurance renewals as an iCalendar file
// (RFC 5545), for "Add to your calendar" on Repairs (repairs-spec §4.15).
// Walkup sends no reminders of its own (DECISIONS #28); a file the person
// imports once is the honest version.
//
// One UID per task, visit or policy date, never per due date, so importing
// the file again after a reschedule updates the existing event instead of
// adding a second one. SEQUENCE comes from the thing's own updated_at (in
// minutes), so a changed task always reads as the newer version.

import { escapeText, foldLine } from "@/lib/tax/ics";
import { coverageShort } from "@/lib/insurance/coverage";
import { cadenceWords } from "./schedule";

export interface CalendarItem {
  uid: string;
  sequence: number;
  /** All-day, YYYY-MM-DD. */
  date: string;
  title: string;
  description: string;
  /** Absolute link back into Walkup. */
  url: string;
  alarmDaysBefore: number | null;
}

const CRLF = "\r\n";
const DEFAULT_RENEWAL_REMINDER_DAYS = 60;

/** Minutes since the Unix epoch of an ISO timestamp: a SEQUENCE that only grows. Unreadable is 0. */
export function sequenceFrom(updatedAtIso: string): number {
  const ms = Date.parse(updatedAtIso);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor(ms / 60_000));
}

/** Shift an ISO date by whole days, in UTC so a DST change can't repeat or skip one. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function upkeepCalendarItems(input: {
  tasks: { id: string; name: string; next_due_on: string; interval_months: number; due_month: number | null; description: string | null; updated_at: string }[];
  /** [] for readers who can't see insurance. */
  policies: { id: string; coverage: string; carrier_name: string; effective_to: string; renewal_reminder_days: number | null; updated_at: string }[];
  visits: { id: string; reference: number; title: string; scheduled_for: string; scheduled_window: string | null; updated_at: string }[];
  appUrl: string;
}): CalendarItem[] {
  const base = input.appUrl.replace(/\/+$/, "");
  const items: CalendarItem[] = [];

  for (const t of input.tasks) {
    const lines = [`${capitalise(cadenceWords(t.interval_months, t.due_month))}. Mark it done in Walkup so the next date moves.`];
    if (t.description?.trim()) lines.push(t.description.trim());
    items.push({
      uid: `upkeep-${t.id}@walkup`,
      sequence: sequenceFrom(t.updated_at),
      date: t.next_due_on.slice(0, 10),
      title: `${t.name} is due`,
      description: lines.join("\n"),
      url: `${base}/repairs/upkeep/${t.id}`,
      alarmDaysBefore: 7,
    });
  }

  for (const v of input.visits) {
    items.push({
      uid: `visit-${v.id}@walkup`,
      sequence: sequenceFrom(v.updated_at),
      date: v.scheduled_for.slice(0, 10),
      title: `Contractor visit: ${v.title} (#${v.reference})`,
      description: v.scheduled_window?.trim() ? `Expected: ${v.scheduled_window.trim()}` : "No time window recorded.",
      url: `${base}/maintenance/${v.id}`,
      alarmDaysBefore: 1,
    });
  }

  // A renewal is a new policy row with its own UIDs. An edit to the same row (a new end
  // date) keeps the UID, so SEQUENCE follows updated_at and a calendar takes the change.
  for (const p of input.policies) {
    const label = coverageShort(p.coverage);
    // "Master policy" already says policy; "Flood" does not.
    const policyWords = /policy$/i.test(label) ? label : `${label} policy`;
    const ends = p.effective_to.slice(0, 10);
    const lead = p.renewal_reminder_days ?? DEFAULT_RENEWAL_REMINDER_DAYS;
    const url = `${base}/insurance/policies/${p.id}`;
    const sequence = sequenceFrom(p.updated_at);
    items.push({
      uid: `insurance-${p.id}-renews@walkup`,
      sequence,
      date: ends,
      title: `${label} insurance renews (${p.carrier_name})`,
      description: `The current ${policyWords} with ${p.carrier_name} ends on this date.`,
      url,
      alarmDaysBefore: null,
    });
    items.push({
      uid: `insurance-${p.id}-start-renewal@walkup`,
      sequence,
      date: addDays(ends, -lead),
      title: `Start the ${label} insurance renewal`,
      description: `The ${policyWords} with ${p.carrier_name} ends in ${lead} days. Ask the agent about the renewal and compare quotes in Walkup.`,
      url,
      alarmDaysBefore: 0,
    });
  }

  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.uid.localeCompare(b.uid)));
}

/** "YYYYMMDDTHHMMSSZ" for DTSTAMP; an unreadable timestamp reads as the epoch rather than failing the download. */
function stampValue(iso: string): string {
  const ms = Date.parse(iso);
  return new Date(Number.isNaN(ms) ? 0 : ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const dateValue = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

export function buildRepairsCalendar(input: { associationId: string; associationName: string; items: CalendarItem[]; generatedAt: string }): string {
  const stamp = stampValue(input.generatedAt);
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Walkup//Repairs and upkeep//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`${input.associationName} upkeep`)}`,
    `X-WR-RELCALID:walkup-repairs-${input.associationId}`,
  ];

  for (const item of input.items) {
    const description = [item.description, item.url].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(item.uid)}`,
      `SEQUENCE:${Math.max(0, Math.floor(item.sequence))}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateValue(item.date)}`,
      `DTEND;VALUE=DATE:${dateValue(addDays(item.date, 1))}`,
      `SUMMARY:${escapeText(item.title)}`,
      `DESCRIPTION:${escapeText(description)}`,
      `URL:${item.url}`,
      "TRANSP:TRANSPARENT",
    );
    if (item.alarmDaysBefore !== null) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeText(item.title)}`,
        `TRIGGER:-P${Math.max(0, Math.floor(item.alarmDaysBefore))}D`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
