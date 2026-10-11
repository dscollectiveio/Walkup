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
