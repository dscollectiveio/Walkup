import type { DuesFrequency } from "./period";

/**
 * Per-unit dues plans: a yearly amount and how often it's paid. Pure math
 * the row editor, the charging action and the page all share.
 */

export const PLAN_FREQUENCIES: Exclude<DuesFrequency, "one_time">[] = ["monthly", "quarterly", "annual"];

export const FREQUENCY_WORDS: Record<Exclude<DuesFrequency, "one_time">, string> = {
  monthly: "monthly",
  quarterly: "quarterly",
  annual: "once a year",
};

export function periodsPerYear(frequency: DuesFrequency): number {
  return frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : 1;
}

/** What one period costs, in cents, from a yearly figure. Rounded to the cent. */
export function perPeriodCents(annualCents: number, frequency: DuesFrequency): number {
  return Math.round(annualCents / periodsPerYear(frequency));
}

/** The yearly figure a per-period amount implies — used for schedules created before annual_amount existed. */
export function annualFromPeriodCents(periodCents: number, frequency: DuesFrequency): number {
  return periodCents * periodsPerYear(frequency);
}

/** First day of the period `today` is in, for a plan's cadence. */
export function periodStartFor(frequency: DuesFrequency, today: Date): string {
  const y = today.getFullYear();
  const m = frequency === "monthly" ? today.getMonth() : frequency === "quarterly" ? Math.floor(today.getMonth() / 3) * 3 : 0;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** First day of the period after the one `today` is in. */
export function nextPeriodStartFor(frequency: DuesFrequency, today: Date): string {
  const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const cur = periodStartFor(frequency, today);
  const [y, m] = cur.split("-").map(Number);
  const d = new Date(y, m - 1 + step, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Which starting period a new or changed plan should apply from: this
 * period if it hasn't been charged yet, otherwise the next one. Changing a
 * plan never rewrites a charge that's already in the books.
 */
export function planStartsOn(frequency: DuesFrequency, today: Date, currentPeriodCharged: boolean): string {
  return currentPeriodCharged ? nextPeriodStartFor(frequency, today) : periodStartFor(frequency, today);
}
