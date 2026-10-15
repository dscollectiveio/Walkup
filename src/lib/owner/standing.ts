// A unit's position, in plain words (owner-portal-spec 4.2). Pure: money
// arrives as text from unit_statement_summary() and is only compared and
// formatted here, never summed (DECISIONS #20).

import { money } from "@/components/ui";
import { longDate } from "@/lib/dates";

/** One row of unit_statement_summary(). Money is text with two decimals. */
export interface UnitSummary {
  unit_id: string;
  unit_label: string;
  as_of: string;
  owed: string;
  overdue: string;
  credit: string;
  net: string;
  open_charges: number;
  oldest_overdue_on: string | null;
  next_due_on: string | null;
  next_due_amount: string | null;
  last_payment_on: string | null;
  last_payment_amount: string | null;
}

export type OwnerStanding = "behind" | "due_soon" | "current" | "ahead" | "not_charged";

/** Whole cents from a money string; display and comparison only. */
function cents(text: string | null | undefined): number {
  const n = Number(text ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * behind: something is past due. due_soon: owes, nothing late. ahead: owes
 * nothing and has money not yet applied. current: owes nothing and has been
 * charged before. not_charged: nothing has ever happened for this unit.
 * "hasEverBeenCharged" is true when the statement has any line.
 */
/**
 * The net rule, the same one the statement and the dues emails use: open
 * charges minus payments not yet applied to a charge, never below zero. The
 * credit pays the oldest charges first, so it comes off what is overdue too.
 */
function netOwedCents(s: UnitSummary): number {
  return Math.max(cents(s.owed) - cents(s.credit), 0);
}
function netOverdueCents(s: UnitSummary): number {
  return Math.max(cents(s.overdue) - cents(s.credit), 0);
}
function fromCents(c: number): string {
  return (c / 100).toFixed(2);
}

export function ownerStanding(s: UnitSummary, hasEverBeenCharged: boolean, _todayIso?: string): OwnerStanding {
  void _todayIso;
  if (netOverdueCents(s) > 0) return "behind";
  if (netOwedCents(s) > 0) return "due_soon";
  if (cents(s.credit) - cents(s.owed) > 0) return "ahead";
  if (hasEverBeenCharged || s.open_charges > 0 || s.last_payment_on !== null) return "current";
  return "not_charged";
}

export interface MoneyAnswer {
  status: "good" | "attention" | "bad" | "neutral";
  headline: string;
  detail: string;
}

export function moneyAnswer(s: UnitSummary, standing: OwnerStanding, _todayIso?: string): MoneyAnswer {
  void _todayIso;
  switch (standing) {
    case "behind": {
      let detail = `${money(fromCents(netOverdueCents(s)))} of that was due on or before ${s.oldest_overdue_on ? longDate(s.oldest_overdue_on) : "an earlier date"}.`;
      if (s.next_due_on && s.next_due_amount) {
        detail += ` Next payment of ${money(s.next_due_amount)} is due ${longDate(s.next_due_on)}.`;
      }
      if (cents(s.credit) > 0) {
        detail += ` That is after taking off your ${money(s.credit)} in payments not yet applied; the board applies them to charges.`;
      }
      return { status: "bad", headline: `You owe ${money(fromCents(netOwedCents(s)))}`, detail };
    }
    case "due_soon":
      return {
        status: "attention",
        headline: `You owe ${money(fromCents(netOwedCents(s)))}`,
        detail:
          s.next_due_on && s.next_due_amount
            ? `Nothing is late. The next payment of ${money(s.next_due_amount)} is due ${longDate(s.next_due_on)}.`
            : "Nothing is late.",
      };
    case "current":
      return {
        status: "good",
        headline: "You're all paid up",
        detail:
          s.last_payment_on && s.last_payment_amount
            ? `Your last payment was ${money(s.last_payment_amount)} on ${longDate(s.last_payment_on)}.`
            : "Nothing is owed right now.",
      };
    case "ahead":
      return {
        status: "neutral",
        headline: `You're ${money(fromCents(cents(s.credit) - cents(s.owed)))} ahead`,
        detail: "That is money you paid that has not been applied to a charge yet. The board usually applies it to your next charges. Ask the board if you are unsure.",
      };
    default:
      return {
        status: "neutral",
        headline: "Nothing has been charged yet",
        detail: `When the board posts dues for ${s.unit_label}, they show here.`,
      };
  }
}
