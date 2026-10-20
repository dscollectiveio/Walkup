// What the regular bills add up to over a stretch of the calendar, from each
// bill's own schedule. Pure. A bill falls due every `step` months from its
// next due date (in both directions), so a month or a year can be asked about
// whether the dates are past or still to come. Bills with no typical amount
// are counted but add nothing, and are reported so the total isn't read as complete.

import { FREQUENCY_MONTHS, type BillFrequency } from "./bills";

export interface TotalsBill {
  frequency: BillFrequency;
  next_due_on: string | null;
  typical_amount: string | null;
  /** The expense category it is booked to, for the donut. */
  category: string;
}

export interface BillTotals {
  totalCents: number;
  /** How many payments fall due in the range. */
  payments: number;
  /** Payments from bills with no typical amount. */
  withoutAmount: number;
  byCategory: { label: string; valueCents: number }[];
}

const toCents = (v: string): number => Math.round(Number(v) * 100);

/** A calendar month as a count of months since year 0, so a range is two integers. */
export const monthIndex = (year: number, month1: number): number => year * 12 + (month1 - 1);

/** Active-bill totals for the months from `fromIdx` to `toIdx` inclusive. */
export function billTotals(bills: TotalsBill[], fromIdx: number, toIdx: number): BillTotals {
  let totalCents = 0;
  let payments = 0;
  let withoutAmount = 0;
  const by = new Map<string, number>();
  for (const b of bills) {
    if (!b.next_due_on) continue;
    const [y, m] = b.next_due_on.split("-").map(Number);
    const anchor = monthIndex(y, m);
    const step = FREQUENCY_MONTHS[b.frequency] ?? 12;
    // Every month index in the range that is a whole number of steps from the anchor.
    for (let mi = fromIdx; mi <= toIdx; mi++) {
      if ((((mi - anchor) % step) + step) % step !== 0) continue;
      payments += 1;
      if (b.typical_amount === null || String(b.typical_amount).trim() === "") {
        withoutAmount += 1;
        continue;
      }
      const cents = toCents(b.typical_amount);
      totalCents += cents;
      by.set(b.category, (by.get(b.category) ?? 0) + cents);
    }
  }
  return {
    totalCents,
    payments,
    withoutAmount,
    byCategory: [...by.entries()].map(([label, valueCents]) => ({ label, valueCents })).sort((a, b) => b.valueCents - a.valueCents),
  };
}
