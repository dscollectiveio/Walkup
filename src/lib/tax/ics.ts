// The board's tax dates as an iCalendar file (RFC 5545), for "Add these dates
// to your calendar". One all-day event per dated deadline, one per milestone,
// each with display alarms, so the reminder lives where the board already
// looks. Walkup has no email service and runs no cron (DECISIONS #28); a file
// the person imports once is the honest version of a reminder.
//
// Re-importing the same file updates events instead of duplicating them: the
// UID is stable per association + deadline key, and SEQUENCE grows with every
// download. An estimated date is a TENTATIVE event and says "(estimated)" in
// the title — the calendar must never read more certain than the tab does.

import type { Deadline } from "./deadlines";

export interface CalendarInput {
  associationId: string;
  associationName: string;
  deadlines: Deadline[];
  /** ISO datetime of this download; sets DTSTAMP and SEQUENCE. */
  generatedAt: string;
  /** The app's origin (e.g. https://walkup.app); the description links to {appUrl}/tax. Default "/tax". */
  appUrl?: string | null;
}

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
/** SEQUENCE counts minutes from here — small, monotonic, and fits every calendar's integer. */
const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1);
/** Forms that take months to prepare get an earlier nudge. */
const EARLY_ALARM_FORMS = new Set(["irs_1120h", "irs_1120", "il_1120"]);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** RFC 5545 §3.3.11 TEXT: backslash, semicolon and comma are escaped; newlines become "\n". */
export function escapeText(value: string): string {
  return (
    value
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r\n|\r|\n/g, "\\n")
      // Every other control or line-separator character (VT, FF, NEL, U+2028, U+2029, tab, DEL) would start a new
      // line in a parser that splits on them: a space instead (REVIEW-2 #16).
      .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
  );
}

const encoder = new TextEncoder();

/**
 * RFC 5545 §3.1: a content line longer than 75 octets is split with CRLF +
 * one space, and the space counts toward the next line's 75. Counting octets
 * (not characters) and walking code points keeps a multi-byte character — an
 * em dash, an accented vendor name — from being cut in half.
 */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (octets + size > MAX_LINE_OCTETS) {
      out.push(current);
      current = ` ${ch}`;
      octets = 1 + size;
    } else {
      current += ch;
      octets += size;
    }
  }
  out.push(current);
  return out.join(CRLF);
}

/** "YYYYMMDD" from an ISO date — no Date parsing, so the day can't shift. */
const dateValue = (iso: string) => iso.slice(0, 10).replace(/-/g, "");

/** The day after an ISO date, in UTC so a DST change can't repeat or skip one. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** "April 15, 2026" from an ISO date. */
function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "YYYYMMDDTHHMMSSZ" for DTSTAMP; an unreadable timestamp reads as the epoch rather than failing the download. */
function stampValue(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function alarm(trigger: string, description: string): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(description)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

export function buildCalendar(input: CalendarInput): string {
  const parsed = Date.parse(input.generatedAt);
  const generatedMs = Number.isNaN(parsed) ? 0 : parsed;
  const stamp = stampValue(generatedMs);
  const sequence = Math.max(0, Math.floor((generatedMs - SEQUENCE_EPOCH) / 60_000));
  const taxUrl = input.appUrl ? `${input.appUrl.replace(/\/+$/, "")}/tax` : "/tax";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Walkup//Taxes//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(`Walkup: ${input.associationName} taxes`)}`,
  ];

  // Shared by a deadline and its milestones: an all-day event that doesn't
  // block the day (TRANSP), stamped and sequenced from this download.
  const event = (uid: string, on: string, summary: string, description: string, tentative: boolean, alarms: string[]) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(uid)}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${sequence}`,
      `DTSTART;VALUE=DATE:${dateValue(on)}`,
      `DTEND;VALUE=DATE:${nextDay(on)}`,
      `SUMMARY:${escapeText(summary)}`,
      `STATUS:${tentative ? "TENTATIVE" : "CONFIRMED"}`,
      "TRANSP:TRANSPARENT",
      `DESCRIPTION:${escapeText(description)}`,
      ...alarms,
      "END:VEVENT",
    );
  };

  for (const d of input.deadlines) {
    if (!d.dueOn) continue;
    const tentative = d.basis !== "verified";
    const uid = `walkup-tax-${input.associationId}-${d.key}@walkup.app`;
    const summary = `Walkup: ${d.name} due${tentative ? " (estimated)" : ""}`;
    // The description carries the date's provenance, exactly as the tab shows
    // it: the citation when a person has checked the rule, else the estimate's
    // own words. The template's notes (weekend rule, extension form) ride along.
    const description = [
      d.kind,
      d.citation ? `Due date from: ${d.citation}` : null,
      d.note,
      taxUrl,
    ]
      .filter((x): x is string => Boolean(x))
      .join("\n");
    const triggers = [...(EARLY_ALARM_FORMS.has(d.formCode) ? ["-P60D"] : []), "-P30D", "-P7D"];
    event(uid, d.dueOn, summary, description, tentative, triggers.flatMap((t) => alarm(t, summary)));

    for (const m of d.milestones) {
      const label = `Walkup: ${m.label}`;
      const when = `${d.name} is due ${longDate(d.dueOn)}${tentative ? " (estimated)" : ""}.`;
      event(`${uid.replace("@walkup.app", "")}-${m.key}@walkup.app`, m.on, label, `${when}\n${taxUrl}`, tentative, alarm("-P0D", label));
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}
