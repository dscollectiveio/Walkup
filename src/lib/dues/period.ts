export type DuesFrequency = "monthly" | "quarterly" | "annual" | "one_time";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The period that `today` falls in, as its first day. A schedule that starts
 * later than that period returns null — there is nothing to charge yet — and
 * one that has ended returns null too.
 */
export function currentPeriodStart(
  frequency: DuesFrequency,
  today: Date,
  startsOn: string,
  endsOn: string | null,
): string | null {
  let start: string;
  if (frequency === "one_time") {
    start = startsOn;
  } else if (frequency === "monthly") {
    start = iso(new Date(today.getFullYear(), today.getMonth(), 1));
  } else if (frequency === "quarterly") {
    start = iso(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1));
  } else {
    start = iso(new Date(today.getFullYear(), 0, 1));
  }

  if (start < startsOn) return null;
  if (endsOn && start > endsOn) return null;
  return start;
}

export function periodLabel(frequency: DuesFrequency, periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00`);
  if (frequency === "monthly") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (frequency === "quarterly") return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  if (frequency === "annual") return String(d.getFullYear());
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** What one unit owes for a period under each allocation method Walkup's form offers. */
export function perUnitAmount(
  allocation: "fixed_per_unit" | "equal",
  totalAmount: number,
  unitCount: number,
): number {
  if (allocation === "fixed_per_unit") return totalAmount;
  if (unitCount === 0) return 0;
  return Math.round((totalAmount / unitCount) * 100) / 100;
}
