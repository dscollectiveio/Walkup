import { fromCents } from "@/lib/tax/form1120h";
import { shortDate } from "@/lib/dates";
import { formatMoney } from "@/lib/email-outbox/format";

/**
 * What to do next about a unit that is behind (money spec 4.7). Advice about
 * process, never legal advice, and never mentions a fee that is not posted.
 * Pure; integer cents.
 */

export type Stage = "current" | "friendly" | "second" | "serious";

export type LastResult = "delivered" | "bounced" | "complained" | "sent" | "by_hand" | null;

export interface CollectionUnit {
  unitId: string;
  label: string;
  ownerNames: string[];
  owedCents: number;
  overdueCents: number;
  oldestOverdueOn: string | null;
  daysOverdue: number;
  aging: { current: number; d1_30: number; d31_60: number; d60plus: number };
  lastReminderOn: string | null;
  remindersSent: number;
  lastResult: LastResult;
  hasEmail: boolean;
  optedOut: boolean;
  bounced: boolean;
  /** The first day Walkup may send this unit's owner another reminder, or null. */
  cappedUntil: string | null;
  openLateFeeChargeId: string | null;
  openLateFeeCents: number;
  suggestion: Suggestion;
}

export type Suggestion =
  | { action: "none"; why: string }
  | { action: "remind"; why: string }
  | { action: "late_fee_notice"; why: string }
  | { action: "call"; why: string }
  | { action: "wait"; why: string };

/** 0 current, 1 to 29 friendly, 30 to 59 second, 60 and over serious. */
export function stageFor(daysOverdue: number): Stage {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue < 30) return "friendly";
  if (daysOverdue < 60) return "second";
  return "serious";
}

export const STAGE_WORDS: Record<Exclude<Stage, "current">, string> = {
  friendly: "Friendly",
  second: "Second notice",
  serious: "Serious",
};

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

export function suggest(u: Omit<CollectionUnit, "suggestion">, todayIso: string): Suggestion {
  if (u.overdueCents <= 0) return { action: "none", why: "Nothing is overdue." };
  if (!u.hasEmail) return { action: "call", why: "No email on file. Call or write to the owner." };
  if (u.bounced) return { action: "call", why: "The last email bounced. Check the address or call the owner." };
  if (u.optedOut) return { action: "call", why: "This owner opted out of email. Call or write to them." };
  if (u.cappedUntil && u.cappedUntil > todayIso && u.lastReminderOn) {
    return { action: "wait", why: `Reminded ${shortDate(u.lastReminderOn, todayIso)}. Walkup sends at most one a week.` };
  }
  if (u.openLateFeeChargeId && u.openLateFeeCents > 0) {
    return {
      action: "late_fee_notice",
      why: `A late fee of ${formatMoney(fromCents(u.openLateFeeCents))} is posted and unpaid. A notice can go with it.`,
    };
  }
  const stage = stageFor(u.daysOverdue);
  if (stage === "serious") {
    return { action: "remind", why: `${days(u.daysOverdue)} overdue. Consider a call before another email.` };
  }
  if (stage === "second") {
    if (u.remindersSent === 0) {
      return { action: "remind", why: `${days(u.daysOverdue)} overdue. No reminder has gone out yet. Send one.` };
    }
    return {
      action: "remind",
      why: `${days(u.daysOverdue)} overdue and ${u.remindersSent} reminder${u.remindersSent === 1 ? "" : "s"} already sent. Send another.`,
    };
  }
  return { action: "remind", why: `${days(u.daysOverdue)} overdue. A friendly reminder is a good first step.` };
}
