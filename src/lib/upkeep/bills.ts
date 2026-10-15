/**
 * Pure date and money rules for recurring bills (repairs-spec §4.14).
 * billNextDue mirrors public.bill_next_due (0053) exactly;
 * tests/fixtures/bill-cases.ts holds the cases both are tested against.
 */

import { toCents } from "@/lib/tax/form1120h";
import { addMonthsClamped } from "./schedule";

export const FREQUENCY_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as const;
export type BillFrequency = keyof typeof FREQUENCY_MONTHS;

/**
 * The next due date one billing period after `fromIso`, landing on `dueDay`
 * when there is one (clamped to the month's last day: due day 31 in April is
 * April 30). Mirrors public.bill_next_due.
 */
export function billNextDue(fromIso: string, frequency: BillFrequency, dueDay: number | null): string {
  const next = addMonthsClamped(fromIso, FREQUENCY_MONTHS[frequency] ?? 12);
  if (dueDay === null || dueDay === undefined) return next;
  const [y, m] = next.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${next.slice(0, 8)}${String(Math.min(dueDay, last)).padStart(2, "0")}`;
}

/**
 * For autopay bills: the stored date rolled forward until it is today or
 * later, so the list shows the next charge rather than a past one. Display
 * only; never written back.
 */
export function rollForward(nextDueIso: string, frequency: BillFrequency, dueDay: number | null, todayIso: string): string {
  const today = todayIso.slice(0, 10);
  let d = nextDueIso.slice(0, 10);
  // A bound so a corrupt date can't spin: 100 years of monthly bills.
  for (let i = 0; i < 1_200 && d < today; i++) d = billNextDue(d, frequency, dueDay);
  return d;
}

/**
 * What a bill costs per month, in integer cents, rounded half away from zero
 * ("300.00" quarterly is 10000; "100.00" quarterly is 3333; "0.05" quarterly
 * is 2). No typical amount is 0. Money arrives as numeric(14,2) text.
 */
export function monthlyEquivalentCents(typicalAmount: string | null, frequency: BillFrequency): number {
  if (typicalAmount === null || typicalAmount === undefined || String(typicalAmount).trim() === "") return 0;
  const cents = toCents(typicalAmount);
  const months = FREQUENCY_MONTHS[frequency] ?? 12;
  const rounded = Math.floor((2 * Math.abs(cents) + months) / (2 * months));
  return cents < 0 ? -rounded : rounded;
}
