// Premium installments and cost figures (insurance-spec §6.6). Installment k
// is always effective_from + k × (12/n) months, from the start date and never
// chained, with the day clamped to the month's end: exactly what Postgres's
// `date + interval` gives in insurance_premium_bill_advance() (0052 part 18).
// tests/fixtures/premium-cases.ts holds the cases both sides are tested on.
// Money is integer cents throughout. Pure.

import { fromCents, toCents } from "@/lib/money/cents";

export type Frequency = "monthly" | "quarterly" | "semiannual" | "annual";

const PER_YEAR: Record<Frequency, number> = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };

/** semi_annual → semiannual; unknown (or anything else) → annual. */
export function frequencyFor(schedule: string): Frequency {
  switch (schedule) {
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "semi_annual":
    case "semiannual":
      return "semiannual";
    default:
      return "annual";
  }
}

/** "2026-01-31" + 1 month = "2026-02-28" (the day clamps to the month's end). */
export function addMonthsClamped(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1;
  const d = Number(iso.slice(8, 10));
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export interface PremiumPolicy {
  annual_premium: string;
  payment_schedule: string;
  effective_from: string;
  effective_to: string;
}

/**
 * Installment dates run from effective_from every 12/n months (only those
 * before effective_to). nextDueOn is the first installment on or after today;
 * once all are past, the renewal date (effective_to). perInstallment splits
 * the cents evenly with the remainder on the first installment (returned
 * separately as firstInstallment).
 */
export function premiumSchedule(p: PremiumPolicy, todayIso: string): {
  frequency: Frequency; installments: number; perInstallment: string; firstInstallment: string; nextDueOn: string; dueDates: string[];
} {
  const frequency = frequencyFor(p.payment_schedule);
  const n = PER_YEAR[frequency];
  const step = 12 / n;
  const dueDates: string[] = [];
  for (let k = 0; k < n; k++) {
    const due = addMonthsClamped(p.effective_from, k * step);
    if (k > 0 && due >= p.effective_to) break;
    dueDates.push(due);
  }
  const installments = dueDates.length;
  const cents = toCents(p.annual_premium);
  const per = Math.floor(cents / installments);
  const first = per + (cents - per * installments);
  const nextDueOn = dueDates.find((d) => d >= todayIso) ?? p.effective_to;
  return { frequency, installments, perInstallment: fromCents(per), firstInstallment: fromCents(first), nextDueOn, dueDates };
}

/**
 * For the bill list and Home: is this policy's bill finished? True when the
 * policy has a non-archived successor (pass its effective_from, else null) and
 * nextDueOn >= successor.effective_from.
 */
export function premiumBillRetires(p: PremiumPolicy, successorStart: string | null, todayIso: string): boolean {
  if (!successorStart) return false;
  return premiumSchedule(p, todayIso).nextDueOn >= successorStart;
}

/** Sum of annual premiums, as money text. */
export function premiumTotals(policies: { annual_premium: string }[]): string {
  return fromCents(policies.reduce((sum, p) => sum + toCents(p.annual_premium), 0));
}

/** Per unit, a year and a month, rounded to the cent. Null when there are no units. */
export function perUnitCost(total: string, units: number): { perYear: string; perMonth: string } | null {
  if (!Number.isFinite(units) || units <= 0) return null;
  const cents = toCents(total);
  return { perYear: fromCents(Math.round(cents / units)), perMonth: fromCents(Math.round(cents / (units * 12))) };
}

/** Percent change with one decimal ("12.5", "-4.0"); null when previous is 0. Exact (BigInt), rounded half away from zero. */
export function changePercent(previous: string, current: string): string | null {
  const prev = BigInt(toCents(previous));
  const cur = BigInt(toCents(current));
  if (prev === BigInt(0)) return null;
  const num = (cur - prev) * BigInt(2000); // twice the change in tenths of a percent, times prev
  const den = prev;
  const neg = (num < BigInt(0)) !== (den < BigInt(0));
  const absNum = num < BigInt(0) ? -num : num;
  const absDen = den < BigInt(0) ? -den : den;
  const tenths = (absNum / absDen + BigInt(1)) / BigInt(2); // floor(2x) -> round half up on the magnitude
  const t = Number(tenths);
  if (t === 0) return "0.0";
  return `${neg ? "-" : ""}${Math.floor(t / 10)}.${t % 10}`;
}
