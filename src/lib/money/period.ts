import { addMonths, monthKey, monthKeyOf, monthLongLabel, monthsBetween } from "./months";

export type PeriodKey = "year" | "month";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  year: "This year",
  month: "This month",
};

export interface FiscalYearLike {
  label: string;
  starts_on: string;
  ends_on: string;
}

export interface ResolvedPeriod {
  key: PeriodKey;
  /** First month in the period (inclusive). */
  startKey: string;
  /** Last month in the period (inclusive) — never past the current month. */
  endKey: string;
  months: string[];
  /** Share of the annual budget compared against spending: 1 for This year (the budget as set), the day-based share for a month. */
  budgetShare: number;
  /** Share of the fiscal year elapsed through today (by day), whatever the period; for annualizing spend. */
  elapsedShare: number;
  /** Plain-words explanation of that share, shown under the card title. */
  budgetCaption: string;
  /** "Through Nov 12": the date the budgets are prorated to. */
  throughLabel: string;
  /** First and last calendar day covered, for filtering dated rows. */
  startDate: string;
  endDate: string;
  label: string;
}

export function parsePeriod(raw: string | undefined): PeriodKey {
  return raw === "month" ? raw : "year";
}

function lastDayOfMonth(key: string): string {
  const d = new Date(`${addMonths(key, 1)}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Turns the switcher's choice into concrete months. The budget is one annual
 * number per category, so a shorter period is compared against its share of
 * that number: "This year" in the 9th month of the fiscal year is 9/12.
 */
export function resolvePeriod(key: PeriodKey, fy: FiscalYearLike, today: Date): ResolvedPeriod {
  const current = monthKey(today);
  const fyStart = monthKeyOf(fy.starts_on);
  const fyEnd = monthKeyOf(fy.ends_on);

  let startKey: string;
  let endKey: string;
  let label: string;
  if (key === "month") {
    startKey = current;
    endKey = current;
    label = monthLongLabel(current);
  } else {
    startKey = fyStart;
    endKey = current < fyEnd ? current : fyEnd;
    label = `Fiscal year ${fy.label}`;
  }
  if (endKey < startKey) endKey = startKey;

  const months = monthsBetween(startKey, endKey);

  // Budgets are prorated by the day: days from the period's first day to today
  // (or the period's end, once it is over), over the days in the fiscal year.
  // The same basis the year-end projection uses, so there is one elapsed figure.
  const dayNum = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const budgetStart = key === "year" ? fy.starts_on : `${startKey.slice(0, 7)}-01`;
  const periodEnd = key === "year" ? fy.ends_on : lastDayOfMonth(endKey);
  const through = todayIso < periodEnd ? todayIso : periodEnd;
  const daysIn = Math.max(1, dayNum(through) - dayNum(budgetStart) + 1);
  const fyDays = Math.max(1, dayNum(fy.ends_on) - dayNum(fy.starts_on) + 1);
  const share = Math.min(1, daysIn / fyDays);

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const short = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
  const range = `${short(budgetStart)} to ${short(through)}`;
  // This year is compared with each full-year budget exactly as set; a single month is
  // compared with its day-based share, since a year's number means nothing against one month.
  const budgetCaption =
    key === "year"
      ? `Spending from ${range} against each full-year budget.`
      : through === todayIso
        ? `Each budget is prorated to today, ${range}.`
        : `Each budget covers ${range}.`;
  const throughLabel = through === todayIso ? `Through ${short(through)}` : `Through ${short(through)} (period over)`;

  return {
    key,
    startKey,
    endKey,
    months,
    budgetShare: key === "year" ? 1 : share,
    elapsedShare: share,
    budgetCaption,
    throughLabel,
    startDate: startKey.slice(0, 10),
    endDate: lastDayOfMonth(endKey),
    label,
  };
}
