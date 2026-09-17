export type PeriodGrain = "monthly" | "quarterly" | "annual";
export type ViewMode = "total" | "expenses";

export interface PeriodBounds {
  start: string;
  end: string;
  label: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** offset counts periods back from the current one — 0 is the current month/quarter, 1 is the prior one, etc. */
export function monthBounds(offset: number, now = new Date()): PeriodBounds {
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    start: iso(start),
    end: iso(end),
    label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  };
}

export function quarterBounds(offset: number, now = new Date()): PeriodBounds {
  const currentQuarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  const absoluteMonth = now.getFullYear() * 12 + currentQuarterStartMonth - offset * 3;
  const year = Math.floor(absoluteMonth / 12);
  const startMonth = ((absoluteMonth % 12) + 12) % 12;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);
  const quarter = Math.floor(startMonth / 3) + 1;
  return { start: iso(start), end: iso(end), label: `Q${quarter} ${year}` };
}

/**
 * A calendar month/quarter is well-defined on its own, but "annual" only
 * means something against the association's real fiscal calendar — which
 * doesn't have to be Jan-Dec. Callers pass the fiscal_years rows (newest
 * first) and this just indexes into them by offset, so annual periods are
 * always real fiscal years, never an assumed calendar year.
 */
export function fiscalYearBounds(
  fiscalYears: { label: string; starts_on: string; ends_on: string }[],
  offset: number,
): PeriodBounds | null {
  const fy = fiscalYears[offset];
  if (!fy) return null;
  return { start: fy.starts_on, end: fy.ends_on, label: fy.label };
}
