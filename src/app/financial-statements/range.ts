import type { PeriodBounds, FiscalYear } from "./periods";
import { parseSelection, type PeriodSelection } from "./summary";

/** Month index: year * 12 + (month - 1). Everything in the picker and the URL is whole months. */
export type MonthIdx = number;
export interface MonthRange {
  from: MonthIdx;
  to: MonthIdx;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const idxOf = (y: number, m1: number): MonthIdx => y * 12 + (m1 - 1);
export const yearOf = (i: MonthIdx) => Math.floor(i / 12);
export const monthOf = (i: MonthIdx) => ((i % 12) + 12) % 12; // 0-11
/** "2026-07" */
export const keyOf = (i: MonthIdx) => `${yearOf(i)}-${String(monthOf(i) + 1).padStart(2, "0")}`;
export function parseKey(k: string | null | undefined): MonthIdx | null {
  const m = k?.match(/^(\d{4})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return idxOf(Number(m[1]), Number(m[2]));
}
export const idxOfIso = (iso: string): MonthIdx => idxOf(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));

export const monthName = (i: MonthIdx) => `${MON[monthOf(i)]} ${yearOf(i)}`;
export const monthsIn = (r: MonthRange) => r.to - r.from + 1;

/** "Jul 2026", "Jul–Aug 2026", "Nov 2025–Feb 2026": the short name used in column headings. */
export function rangeName(r: MonthRange): string {
  if (r.from === r.to) return monthName(r.from);
  if (yearOf(r.from) === yearOf(r.to)) return `${MON[monthOf(r.from)]}–${MON[monthOf(r.to)]} ${yearOf(r.to)}`;
  return `${monthName(r.from)}–${monthName(r.to)}`;
}
/** "Jul 2026 – Aug 2026": the picker button for a date range. */
export const rangeSpan = (r: MonthRange) => (r.from === r.to ? monthName(r.from) : `${monthName(r.from)} – ${monthName(r.to)}`);

export function boundsOf(r: MonthRange): PeriodBounds {
  const end = new Date(Date.UTC(yearOf(r.to), monthOf(r.to) + 1, 0)).getUTCDate();
  return {
    start: `${keyOf(r.from)}-01`,
    end: `${keyOf(r.to)}-${String(end).padStart(2, "0")}`,
    label: rangeName(r),
  };
}

/** Clamp to what exists (books start .. this month) and put the earlier month first. */
export function clampRange(a: MonthIdx, b: MonthIdx, min: MonthIdx, max: MonthIdx): MonthRange {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const from = Math.min(Math.max(lo, min), max);
  const to = Math.min(Math.max(hi, min), max);
  return { from, to };
}

export type CompareWith = "ly" | "prev" | "pick";

/** Period 2 for each "Compare with" choice. Not clamped: it may reach before the books start. */
export function comparePeriod(p1: MonthRange, with_: CompareWith, picked: MonthRange | null): MonthRange {
  if (with_ === "prev") {
    const n = monthsIn(p1);
    return { from: p1.from - n, to: p1.from - 1 };
  }
  if (with_ === "pick" && picked) return picked;
  return { from: p1.from - 12, to: p1.to - 12 };
}

/** Where the books begin: the earliest fiscal year's first month, or null when none exists yet. */
export function booksStartIdx(fiscalYears: { starts_on: string }[]): MonthIdx | null {
  if (fiscalYears.length === 0) return null;
  return Math.min(...fiscalYears.map((f) => idxOfIso(f.starts_on)));
}

export type QuickPick = "this-month" | "last-month" | "this-quarter" | "year-so-far" | "last-year";
export const QUICK_PICKS: { id: QuickPick; label: string }[] = [
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-quarter", label: "This quarter" },
  { id: "year-so-far", label: "Year so far" },
  { id: "last-year", label: "Last year" },
];

/** What a quick pick means today. Quarters and years follow the fiscal year when one covers today (else the calendar). */
export function quickPickRange(id: QuickPick, todayIso: string, fiscalYears: FiscalYear[], min: MonthIdx | null): MonthRange {
  const now = idxOfIso(todayIso);
  const lo = min ?? now - 11;
  const covering = fiscalYears.find((f) => f.starts_on <= todayIso && f.ends_on >= todayIso);
  const fyStart = covering ? idxOfIso(covering.starts_on) : idxOf(yearOf(now), 1);
  let r: MonthRange;
  switch (id) {
    case "this-month":
      r = { from: now, to: now };
      break;
    case "last-month":
      r = { from: now - 1, to: now - 1 };
      break;
    case "this-quarter": {
      const into = Math.floor((now - fyStart) / 3) * 3;
      r = { from: fyStart + into, to: now };
      break;
    }
    case "year-so-far":
      r = { from: fyStart, to: now };
      break;
    default: {
      // The fiscal year before the covering one; else the twelve months before this year began.
      const prev = covering
        ? fiscalYears.find((f) => f.ends_on < covering.starts_on)
        : [...fiscalYears].sort((a, b) => b.ends_on.localeCompare(a.ends_on)).find((f) => f.ends_on < todayIso);
      r = prev ? { from: idxOfIso(prev.starts_on), to: idxOfIso(prev.ends_on) } : { from: fyStart - 12, to: fyStart - 1 };
    }
  }
  return clampRange(r.from, r.to, lo, now);
}

/** What the page shows, worked out from the URL. */
export type StatementView =
  | { kind: "columns"; selection: PeriodSelection; range: MonthRange | null }
  | { kind: "combined"; range: MonthRange }
  | { kind: "compare"; p1: MonthRange; p2: MonthRange; with: CompareWith };

export const MAX_COLUMNS = 12;

type Query = Record<string, string | string[] | undefined> | URLSearchParams;
const get = (q: Query, k: string): string | undefined => {
  if (q instanceof URLSearchParams) return q.get(k) ?? undefined;
  const v = q[k];
  return Array.isArray(v) ? v[0] : v;
};

/** Default for "Show each month as a column": on for two to six months. */
export const defaultColumns = (months: number) => months >= 2 && months <= 6;

/**
 * Reads the multi-period URLs: ?from=&to=&cols= (a date range), ?cmp=&from=&to=&from2=&to2= (compare),
 * and the older ?periods= links. Null means "the ordinary single-period view".
 */
export function resolveView(
  q: Query,
  fiscalYears: { label: string; starts_on: string }[],
  todayIso: string,
): StatementView | null {
  const now = idxOfIso(todayIso);
  const min = booksStartIdx(fiscalYears) ?? now - 11;
  const a = parseKey(get(q, "from"));
  const b = parseKey(get(q, "to"));
  const cmp = get(q, "cmp");
  if (cmp && a !== null) {
    const p1 = clampRange(a, b ?? a, min, now);
    const w: CompareWith = cmp === "prev" ? "prev" : cmp === "pick" ? "pick" : "ly";
    const a2 = parseKey(get(q, "from2"));
    const b2 = parseKey(get(q, "to2"));
    // Period 2 is not clamped to the books start: the statement shows it blank when nothing is posted there.
    const picked = a2 !== null ? { from: Math.min(a2, b2 ?? a2), to: Math.max(a2, b2 ?? a2) } : null;
    return { kind: "compare", p1, p2: comparePeriod(p1, w, picked), with: w };
  }
  if (a !== null) {
    const r = clampRange(a, b ?? a, min, now);
    const n = monthsIn(r);
    if (n === 1) return null;
    const wantCols = get(q, "cols");
    const cols = wantCols === "1" ? true : wantCols === "0" ? false : defaultColumns(n);
    if (cols && n <= MAX_COLUMNS) {
      const items = Array.from({ length: n }, (_, i) => ({ key: keyOf(r.from + i), offset: now - (r.from + i) }));
      return { kind: "columns", selection: { grain: "monthly", items }, range: r };
    }
    return { kind: "combined", range: r };
  }
  const periods = get(q, "periods");
  if (periods) {
    const sel = parseSelection(periods, fiscalYears, todayIso);
    if (sel && sel.items.length > 1) return { kind: "columns", selection: sel, range: null };
  }
  return null;
}

/** What the picker opens with. Month keys are "2026-07". */
export interface PickerState {
  mode: "range" | "compare";
  from: string;
  to: string;
  /** "Show each month as a column" */
  cols: boolean;
  with: CompareWith;
  from2: string;
  to2: string;
  /** The quick pick that produced this view, if any: names the button. */
  pick: QuickPick | null;
}

export function pickerStateFor(view: StatementView | null, single: MonthRange, pick: QuickPick | null): PickerState {
  const base = { cols: defaultColumns(monthsIn(single)), with: "ly" as CompareWith, pick };
  const ly = comparePeriod(single, "ly", null);
  const state = (r: MonthRange, p2: MonthRange, over: Partial<PickerState>): PickerState => ({
    mode: "range",
    from: keyOf(r.from),
    to: keyOf(r.to),
    from2: keyOf(p2.from),
    to2: keyOf(p2.to),
    ...base,
    ...over,
  });
  if (!view) return state(single, ly, {});
  if (view.kind === "compare") {
    return state(view.p1, view.p2, { mode: "compare", with: view.with, cols: defaultColumns(monthsIn(view.p1)), pick: null });
  }
  const r = view.kind === "combined" ? view.range : view.range ?? single;
  return state(r, comparePeriod(r, "ly", null), { cols: view.kind === "columns", pick });
}

/** The query that reproduces a view: carried to the Excel / PDF links so an export matches the screen. */
export function viewQuery(view: StatementView): Record<string, string> {
  if (view.kind === "compare") {
    return {
      from: keyOf(view.p1.from),
      to: keyOf(view.p1.to),
      cmp: view.with,
      ...(view.with === "pick" ? { from2: keyOf(view.p2.from), to2: keyOf(view.p2.to) } : {}),
    };
  }
  if (view.kind === "combined") return { from: keyOf(view.range.from), to: keyOf(view.range.to), cols: "0" };
  if (view.range) return { from: keyOf(view.range.from), to: keyOf(view.range.to), cols: "1" };
  return { periods: view.selection.items.map((i) => i.key).join(",") };
}

export const isQuickPick = (v: string | undefined): v is QuickPick => QUICK_PICKS.some((q) => q.id === v);

/** The ?pick= name, kept only while the range on screen is still what that pick means today. */
export function activePick(
  raw: string | undefined,
  range: MonthRange,
  todayIso: string,
  fiscalYears: FiscalYear[],
): QuickPick | null {
  if (!isQuickPick(raw)) return null;
  const r = quickPickRange(raw, todayIso, fiscalYears, booksStartIdx(fiscalYears));
  return r.from === range.from && r.to === range.to ? raw : null;
}
