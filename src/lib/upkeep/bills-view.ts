// What the Bills view says (repairs-spec §13.2): the filter, the headline
// answer, the monthly figure and each bill's dates. Pure; money is
// numeric(14,2) text handled in cents.

import { fromCents } from "@/lib/tax/form1120h";
import { humanDate, moneyText } from "@/lib/repairs/format";
import { monthlyEquivalentCents, rollForward, type BillFrequency } from "./bills";
import { daysUntil } from "./schedule";

export type BillShow = "active" | "paused" | "archived";

export function parseBillShow(v: string | undefined): BillShow {
  return v === "paused" || v === "archived" ? v : "active";
}

export const FREQUENCY_WORDS: Record<BillFrequency, string> = {
  monthly: "Every month",
  quarterly: "Every 3 months",
  semiannual: "Twice a year",
  annual: "Once a year",
};

export interface BillLike {
  name: string;
  frequency: BillFrequency;
  typical_amount: string | null;
  due_day: number | null;
  next_due_on: string | null;
  autopay_arranged: boolean;
  is_active: boolean;
  paused_at: string | null;
}

export function billShowFilter(b: Pick<BillLike, "is_active" | "paused_at">, show: BillShow): boolean {
  if (show === "archived") return !b.is_active;
  if (show === "paused") return b.is_active && b.paused_at !== null;
  return b.is_active && b.paused_at === null;
}

/** Due within 14 days (or overdue), paid by hand, active and not paused. */
export function manualDueSoon<T extends BillLike>(bills: T[], todayIso: string): T[] {
  return bills
    .filter((b) => b.is_active && !b.paused_at && !b.autopay_arranged && b.next_due_on !== null && daysUntil(b.next_due_on, todayIso) <= 14)
    .sort((a, b) => (a.next_due_on! < b.next_due_on! ? -1 : a.next_due_on! > b.next_due_on! ? 1 : 0));
}

export function billsAnswer(bills: BillLike[], todayIso: string): { status: "attention" | "good"; headline: string; detail: string } {
  const soon = manualDueSoon(bills, todayIso);
  if (soon.length > 0) {
    return {
      status: "attention",
      headline: `${soon.length} ${soon.length === 1 ? "bill" : "bills"} to pay by hand soon`,
      detail: soon.map((b) => `${b.name} due ${humanDate(b.next_due_on!, todayIso)}`).join(" · "),
    };
  }
  const active = bills.filter((b) => b.is_active && !b.paused_at);
  return {
    status: "good",
    headline: "Nothing to pay by hand in the next two weeks",
    detail: `${active.filter((b) => b.autopay_arranged).length} of ${active.length} bills are on autopay with the provider.`,
  };
}

/** "$1,240" a month over active, unpaused bills, from monthlyEquivalentCents. */
export function monthlyTotal(bills: BillLike[]): string {
  const cents = bills
    .filter((b) => b.is_active && !b.paused_at)
    .reduce((s, b) => s + monthlyEquivalentCents(b.typical_amount, b.frequency), 0);
  return moneyText(fromCents(cents)) || "$0";
}

/** "next Thu, Oct 22" or, for autopay, the next charge rolled forward: "next Nov 1 (autopay)". */
export function nextDueText(b: BillLike, todayIso: string): string | null {
  if (!b.next_due_on) return null;
  if (b.autopay_arranged) {
    const d = rollForward(b.next_due_on, b.frequency, b.due_day, todayIso);
    return `next ${humanDate(d, todayIso)} (autopay)`;
  }
  return `next ${humanDate(b.next_due_on, todayIso)}`;
}
