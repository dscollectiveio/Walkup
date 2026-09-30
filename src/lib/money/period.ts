import { addMonths, monthKey, monthKeyOf, monthLongLabel, monthsBetween } from "./months";

export type PeriodKey = "year" | "12m" | "month";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  year: "This year",
  "12m": "Last 12 months",
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
  /** Share of the annual budget that applies to this period. */
  budgetShare: number;
  /** Plain-words explanation of that share, shown under the budget bars. */
  budgetCaption: string;
  /** First and last calendar day covered, for filtering dated rows. */
  startDate: string;
  endDate: string;
  label: string;
}

export function parsePeriod(raw: string | undefined): PeriodKey {
  return raw === "12m" || raw === "month" ? raw : "year";
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
  const fyMonths = Math.max(1, monthsBetween(fyStart, fyEnd).length);

  let startKey: string;
  let endKey: string;
  let label: string;
  if (key === "month") {
    startKey = current;
    endKey = current;
    label = monthLongLabel(current);
  } else if (key === "12m") {
    startKey = addMonths(current, -11);
    endKey = current;
    label = `${monthLongLabel(startKey)} – ${monthLongLabel(current)}`;
  } else {
    startKey = fyStart;
    endKey = current < fyEnd ? current : fyEnd;
    label = `Fiscal year ${fy.label}`;
  }
  if (endKey < startKey) endKey = startKey;

  const months = monthsBetween(startKey, endKey);
  const share = Math.min(1, months.length / fyMonths);

  const budgetCaption =
    key === "month"
      ? `Compared with 1/${fyMonths} of each annual budget — one month's share.`
      : key === "12m"
        ? "Compared with each full annual budget — twelve months' worth."
        : `Compared with ${months.length}/${fyMonths} of each annual budget — the share for the months so far this year, not the full-year number.`;

  return {
    key,
    startKey,
    endKey,
    months,
    budgetShare: share,
    budgetCaption,
    startDate: startKey.slice(0, 10),
    endDate: lastDayOfMonth(endKey),
    label,
  };
}
