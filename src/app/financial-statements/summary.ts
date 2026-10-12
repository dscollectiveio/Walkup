import { money } from "@/components/ui";
import type { PeriodGrain } from "./periods";

/**
 * Pure helpers for the statement page: the budget share for a period, the
 * picker's date math, the plain-English headline, and the words for
 * a budget variance. No queries, so all of it is unit-tested.
 */

/** A twelfth of the annual budget for a month, a quarter of it for a quarter, all of it for the year. */
export function prorateBudget(
  annual: Record<string, number>,
  period: PeriodGrain,
): { byAccount: Record<string, number>; note: string } {
  const divisor = period === "monthly" ? 12 : period === "quarterly" ? 4 : 1;
  const byAccount: Record<string, number> = {};
  for (const [id, amount] of Object.entries(annual)) byAccount[id] = Math.round((amount / divisor) * 100) / 100;
  const note = period === "monthly" ? "A twelfth" : period === "quarterly" ? "A quarter" : "All";
  return { byAccount, note };
}

const ym = (iso: string): [number, number] => {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return [y, m];
};

/** How many months back from today's month a given calendar month is (0 = this month). */
export function monthOffsetFor(year: number, month1: number, todayIso: string): number {
  const [ty, tm] = ym(todayIso);
  return (ty * 12 + (tm - 1)) - (year * 12 + (month1 - 1));
}

/** How many quarters back from today's quarter a given quarter (1–4) is. */
export function quarterOffsetFor(year: number, quarter: number, todayIso: string): number {
  const [ty, tm] = ym(todayIso);
  return (ty * 4 + Math.floor((tm - 1) / 3)) - (year * 4 + (quarter - 1));
}

/**
 * What the picker may offer: nothing in the future, and nothing before the
 * earliest fiscal year (or twelve months back when none exists yet).
 */
export function pickerBounds(
  fiscalYears: { starts_on: string }[],
  todayIso: string,
): { minYear: number; minMonthIndex: number; maxYear: number; maxMonthIndex: number } {
  const [ty, tm] = ym(todayIso);
  const earliest = fiscalYears.length > 0 ? fiscalYears[fiscalYears.length - 1].starts_on : null;
  const minMonthIndex = earliest ? ym(earliest)[0] * 12 + (ym(earliest)[1] - 1) : ty * 12 + (tm - 1) - 11;
  return { minYear: Math.floor(minMonthIndex / 12), minMonthIndex, maxYear: ty, maxMonthIndex: ty * 12 + (tm - 1) };
}

/** Most periods that can be compared at once; wider than this stops being readable. */
export const MAX_SELECTED = 12;

/**
 * What identifies a period in the URL and the picker: a month is "2026-10", a
 * quarter "2026-Q4", a fiscal year "FY:2026" (its label). One grain per
 * selection, so periods never overlap and a total is a clean sum.
 */
export function periodKeyFor(period: PeriodGrain, bounds: { start: string; label: string }): string {
  if (period === "monthly") return bounds.start.slice(0, 7);
  if (period === "quarterly") {
    const [y, m] = ym(bounds.start);
    return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  }
  return `FY:${bounds.label}`;
}

export interface PeriodSelection {
  grain: PeriodGrain;
  /** Oldest first. `offset` is what loadStatement takes (periods back from now / fiscal-year index). */
  items: { key: string; offset: number }[];
}

/**
 * Reads ?periods=2026-08,2026-09,2026-10. Mixed types, duplicates, unknown
 * fiscal years and periods in the future are dropped; more than MAX_SELECTED
 * keeps the newest. Null when nothing valid is left.
 */
export function parseSelection(
  raw: string | undefined,
  fiscalYears: { label: string }[],
  todayIso: string,
): PeriodSelection | null {
  if (!raw) return null;
  const month = /^(\d{4})-(\d{2})$/;
  const quarter = /^(\d{4})-Q([1-4])$/;
  const year = /^FY:(.+)$/;
  type Item = { key: string; grain: PeriodGrain; offset: number };
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const key of raw.split(",").map((k) => k.trim()).filter(Boolean)) {
    if (seen.has(key)) continue;
    seen.add(key);
    let m: RegExpMatchArray | null;
    if ((m = key.match(month)) && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
      items.push({ key, grain: "monthly", offset: monthOffsetFor(Number(m[1]), Number(m[2]), todayIso) });
    } else if ((m = key.match(quarter))) {
      items.push({ key, grain: "quarterly", offset: quarterOffsetFor(Number(m[1]), Number(m[2]), todayIso) });
    } else if ((m = key.match(year))) {
      items.push({ key, grain: "annual", offset: fiscalYears.findIndex((f) => f.label === m![1]) });
    }
  }
  const valid = items.filter((i) => i.offset >= 0);
  if (valid.length === 0) return null;
  const grain = valid[0].grain;
  const sameGrain = valid.filter((i) => i.grain === grain);
  // Oldest first: the higher the offset, the older the period.
  const ordered = sameGrain.sort((a, b) => b.offset - a.offset);
  const kept = ordered.slice(Math.max(0, ordered.length - MAX_SELECTED));
  return { grain, items: kept.map(({ key, offset }) => ({ key, offset })) };
}

export interface MergedRow {
  account_id: string;
  code: string;
  account_name: string;
  /** One amount per period, in the order the periods were given. */
  amounts: number[];
  total: number;
}

/**
 * Lines up several periods' income or expense rows by account, so each
 * account appears once with an amount per period (0 where it had none) and
 * a total across them.
 */
export function mergeRows(
  periods: { rows: { account_id: string; code: string; account_name: string; amount: number }[] }[],
  order: "account" | "size" = "account",
): MergedRow[] {
  const byId = new Map<string, MergedRow>();
  periods.forEach((p, i) => {
    for (const r of p.rows) {
      const row =
        byId.get(r.account_id) ??
        { account_id: r.account_id, code: r.code, account_name: r.account_name, amounts: periods.map(() => 0), total: 0 };
      row.amounts[i] += r.amount;
      row.total += r.amount;
      byId.set(r.account_id, row);
    }
  });
  const rows = [...byId.values()];
  return order === "size" ? rows.sort((a, b) => b.total - a.total) : rows.sort((a, b) => a.code.localeCompare(b.code));
}

export interface HeadlineInput {
  label: string;
  totalIncome: number;
  totalExpenses: number;
  hasActivity: boolean;
  prior: { label: string; netIncome: number; hasActivity: boolean } | null;
}

export function headlineFor(input: HeadlineInput): {
  status: "good" | "bad" | "neutral";
  headline: string;
  detail?: string;
} {
  if (!input.hasActivity) {
    return { status: "neutral", headline: `Nothing has been posted for ${input.label} yet.` };
  }
  const net = input.totalIncome - input.totalExpenses;
  const tail =
    Math.abs(net) < 0.005
      ? "broke even"
      : net > 0
        ? `${money(net)} ahead`
        : `${money(Math.abs(net))} behind`;
  const headline = `You took in ${money(input.totalIncome)} and spent ${money(input.totalExpenses)} in ${input.label} — ${tail}.`;

  let detail: string | undefined;
  if (input.prior?.hasActivity) {
    const diff = net - input.prior.netIncome;
    detail =
      Math.abs(diff) < 1
        ? `About the same as ${input.prior.label}.`
        : `That's ${money(Math.abs(diff))} ${diff > 0 ? "better" : "worse"} than ${input.prior.label}.`;
  }
  return { status: net < 0 ? "bad" : "good", headline, detail };
}

/** "$120 over" / "$80 under" / "on budget", with whether that's good news for this kind of account. */
export function varianceWords(
  actual: number,
  budget: number,
  type: "income" | "expense",
): { words: string; tone: "good" | "bad" | "neutral" } {
  const diff = actual - budget;
  if (Math.abs(diff) < 1) return { words: "on budget", tone: "neutral" };
  const over = diff > 0;
  const words = `${money(Math.abs(diff))} ${over ? "over" : "under"}`;
  // Spending over budget is bad; income over budget is good.
  const good = type === "expense" ? !over : over;
  return { words, tone: good ? "good" : "bad" };
}
