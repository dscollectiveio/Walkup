// Display helpers for Repairs (repairs-spec §4.6). Pure; client components
// may import them. Dates are "YYYY-MM-DD" (a timestamp's date part is used
// as is, no zone shift); money is numeric(14,2) text handled in cents.

import { toCents } from "@/lib/tax/form1120h";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(iso: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? [y, mo, d] : null;
}

const dayNumber = ([y, m, d]: [number, number, number]) => Date.UTC(y, m - 1, d) / 86_400_000;

/**
 * "today" / "tomorrow" / "yesterday" when adjacent; "Thu, Oct 22" this year;
 * "Oct 22, 2027" otherwise. Unreadable input passes through.
 */
export function humanDate(dateIso: string, todayIso: string): string {
  const date = ymd(dateIso);
  if (!date) return dateIso;
  const today = ymd(todayIso);
  if (today) {
    const diff = dayNumber(date) - dayNumber(today);
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff === -1) return "yesterday";
  }
  const [y, m, d] = date;
  if (today && today[0] === y) {
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return `${weekday}, ${SHORT_MONTHS[m - 1]} ${d}`;
  }
  return `${SHORT_MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Sep 2026" from a date: for "last used" lines. */
export function monthYear(dateIso: string): string {
  const date = ymd(dateIso);
  return date ? `${SHORT_MONTHS[date[1] - 1]} ${date[0]}` : dateIso;
}

/**
 * "$1,250" for whole dollars, "$1,250.50" otherwise, from numeric(14,2)
 * text. Null or blank is "". Uses toCents, so a float that slipped past the
 * API's ::text casts fails loudly instead of rounding quietly.
 */
export function moneyText(numeric: string | null): string {
  if (numeric === null || numeric === undefined || String(numeric).trim() === "") return "";
  const cents = toCents(numeric);
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = abs % 100;
  return `${cents < 0 ? "-" : ""}$${dollars}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
}

/** "Shared area", "Shared area: back stairwell", "Inside Unit 2", "Inside Unit 2: kitchen". */
export function whereLabel(unitLabel: string | null, locationDetail: string | null): string {
  const base = unitLabel?.trim() ? `Inside ${unitLabel.trim()}` : "Shared area";
  const detail = locationDetail?.trim();
  return detail ? `${base}: ${detail}` : base;
}
