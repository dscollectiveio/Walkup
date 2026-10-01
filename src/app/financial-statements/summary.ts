import { money } from "@/components/ui";
import { monthBounds, quarterBounds, type FiscalYear, type PeriodGrain } from "./periods";

/**
 * Pure helpers for the statement page: the budget share for a period, the
 * period dropdown's options, the plain-English headline, and the words for
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

export interface PeriodOption {
  label: string;
  period: PeriodGrain;
  offset: number;
  group: "Months" | "Quarters" | "Years";
}

/**
 * Months and quarters back to the start of the earliest fiscal year (capped
 * so the list stays short), then every fiscal year. One list, three groups.
 */
export function periodOptions(fiscalYears: FiscalYear[], now: Date = new Date()): PeriodOption[] {
  const earliest = fiscalYears.length > 0 ? fiscalYears[fiscalYears.length - 1].starts_on : null;
  const options: PeriodOption[] = [];

  for (let offset = 0; offset < 24; offset++) {
    const b = monthBounds(offset, now);
    if (earliest && b.end < earliest) break;
    if (!earliest && offset >= 12) break;
    options.push({ label: b.label, period: "monthly", offset, group: "Months" });
  }
  for (let offset = 0; offset < 8; offset++) {
    const b = quarterBounds(offset, now);
    if (earliest && b.end < earliest) break;
    if (!earliest && offset >= 4) break;
    options.push({ label: b.label, period: "quarterly", offset, group: "Quarters" });
  }
  fiscalYears.forEach((fy, offset) => {
    options.push({ label: fy.label, period: "annual", offset, group: "Years" });
  });
  return options;
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
