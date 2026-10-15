/**
 * Statement periods (money spec 4.6). Pure: dates are "YYYY-MM-DD" text, all
 * arithmetic in UTC so the server's zone never shifts a day.
 */

export type StatementPeriodKey = "last_month" | "last_quarter" | "year_to_date" | "last_year" | "custom";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function parseIso(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (y < 1990 || y > 2200 || m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) return null;
  return { y, m, d };
}

export function isValidIso(value: string): boolean {
  return parseIso(value) !== null;
}

export function statementPeriods(todayIso: string): { key: StatementPeriodKey; label: string; from: string; to: string }[] {
  const t = parseIso(todayIso);
  if (!t) throw new Error("today must be YYYY-MM-DD");

  // Previous calendar month.
  const pm = t.m === 1 ? 12 : t.m - 1;
  const pmYear = t.m === 1 ? t.y - 1 : t.y;

  // Previous calendar quarter.
  const q = Math.floor((t.m - 1) / 3); // 0..3 this quarter
  const pq = q === 0 ? 3 : q - 1;
  const pqYear = q === 0 ? t.y - 1 : t.y;
  const pqStart = pq * 3 + 1;
  const pqEnd = pq * 3 + 3;

  return [
    { key: "last_month", label: "Last month", from: iso(pmYear, pm, 1), to: iso(pmYear, pm, lastDay(pmYear, pm)) },
    { key: "last_quarter", label: "Last quarter", from: iso(pqYear, pqStart, 1), to: iso(pqYear, pqEnd, lastDay(pqYear, pqEnd)) },
    { key: "year_to_date", label: "This year so far", from: iso(t.y, 1, 1), to: iso(t.y, t.m, t.d) },
    { key: "last_year", label: "Last year", from: iso(t.y - 1, 1, 1), to: iso(t.y - 1, 12, 31) },
  ];
}

/** True for January 1 to December 31 of one year. */
export function isAnnual(from: string, to: string): boolean {
  const a = parseIso(from);
  const b = parseIso(to);
  return !!a && !!b && a.y === b.y && a.m === 1 && a.d === 1 && b.m === 12 && b.d === 31;
}

/**
 * "2025" for a full year, "Q3 2026" for a full quarter, "October 2026" for a
 * full month, otherwise "Oct 1 to Oct 14, 2026" (the word "to", never a dash).
 */
export function periodLabel(from: string, to: string): string {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return `${from} to ${to}`;
  if (isAnnual(from, to)) return String(a.y);
  if (a.y === b.y && a.d === 1 && b.d === lastDay(b.y, b.m)) {
    if (a.m === b.m) return `${MONTHS[a.m - 1]} ${a.y}`;
    if ((a.m - 1) % 3 === 0 && b.m === a.m + 2) return `Q${(a.m - 1) / 3 + 1} ${a.y}`;
  }
  if (a.y === b.y) return `${SHORT[a.m - 1]} ${a.d} to ${SHORT[b.m - 1]} ${b.d}, ${b.y}`;
  return `${SHORT[a.m - 1]} ${a.d}, ${a.y} to ${SHORT[b.m - 1]} ${b.d}, ${b.y}`;
}

/** Whole days between two valid dates (to minus from). */
export function daysBetween(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

const MAX_SPAN_DAYS = 3660;

/** Query-string dates to a usable period, or null when invalid, reversed or longer than about ten years. */
export function parsePeriod(from: string | undefined, to: string | undefined): { from: string; to: string } | null {
  if (!from || !to || !isValidIso(from) || !isValidIso(to)) return null;
  if (to < from) return null;
  if (daysBetween(from, to) > MAX_SPAN_DAYS) return null;
  return { from, to };
}

/** The first day used when a statement is asked for without a start date: all activity on record. */
export const ALL_HISTORY_FROM = "2000-01-01";

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Through October 14, 2026" for an all-activity statement, otherwise periodLabel. */
export function rangeLabel(from: string, to: string, allHistory: boolean): string {
  if (!allHistory) return periodLabel(from, to);
  const t = parseIso(to);
  return t ? `Through ${LONG[t.m - 1]} ${t.d}, ${t.y}` : `Through ${to}`;
}
