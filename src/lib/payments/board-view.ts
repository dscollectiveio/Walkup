/**
 * What the board sees about online dues payments on the Dues tab and in the
 * bank feed (DECISIONS #57, plan Phase 5). Pure, so the rules are testable.
 */

import type { OnlinePaymentStatus } from "./owner-view";

export interface BoardOnlineRow {
  id: string;
  unitId: string;
  status: OnlinePaymentStatus;
  amountCents: number;
  createdAt: string;
  failureReason: string | null;
}

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

/** "$400 paid online, pending" per unit: started or settled at Stripe, not yet in the books. */
export function pendingBadges(rows: BoardOnlineRow[]): Map<string, string> {
  const cents = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "processing" || r.status === "succeeded") cents.set(r.unitId, (cents.get(r.unitId) ?? 0) + r.amountCents);
  }
  return new Map([...cents].map(([unit, c]) => [unit, `${money(c)} paid online, pending`]));
}

export interface AttentionItem {
  id: string;
  unitId: string;
  tone: "bad" | "warning";
  text: string;
}

const LOOK_BACK_MS = 45 * 86_400_000;

/**
 * Online payments a person should know about: a failed one (the unit still
 * owes it), a refund or a dispute (if it was already in the books, the board
 * reverses it by hand). Only the last 45 days, newest first.
 */
export function attentionItems(rows: BoardOnlineRow[], unitLabel: (id: string) => string, now = Date.now()): AttentionItem[] {
  return rows
    .filter((r) => (r.status === "failed" || r.status === "refunded" || r.status === "disputed") && now - Date.parse(r.createdAt) < LOOK_BACK_MS)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((r) => {
      const who = `${unitLabel(r.unitId)}: ${money(r.amountCents)} paid online ${day(r.createdAt)}`;
      if (r.status === "failed") {
        return {
          id: r.id,
          unitId: r.unitId,
          tone: "bad" as const,
          text: `${who} didn't go through${r.failureReason ? ` (${r.failureReason})` : ""}. It still counts as owed, and the owner has been shown this.`,
        };
      }
      return {
        id: r.id,
        unitId: r.unitId,
        tone: "warning" as const,
        text:
          r.status === "refunded"
            ? `${who} was refunded in Stripe. If it was already confirmed in the bank feed, record the refund by hand.`
            : `${who} is disputed by the owner's bank. Respond in Stripe; if Stripe takes the money back, record it by hand.`,
      };
    });
}

export interface PayoutMatchInput {
  payoutId: string;
  amountCents: number;
  arrivalDate: string | null;
  payments: { unitId: string; amountCents: number; feeCents: number | null }[];
}

/** The one-line suggestion on a bank deposit that is a Stripe payout. */
export function payoutSuggestion(p: PayoutMatchInput, unitLabel: (id: string) => string): { ready: boolean; text: string; detail: string } {
  const gross = p.payments.reduce((s, x) => s + x.amountCents, 0);
  const fees = p.payments.reduce((s, x) => s + (x.feeCents ?? 0), 0);
  const n = p.payments.length;
  const ready = n > 0 && p.payments.every((x) => x.feeCents !== null) && gross - fees === p.amountCents;
  const text = `Stripe payout: ${n} online dues payment${n === 1 ? "" : "s"}, ${money(gross)} less ${money(fees)} in fees`;
  const detail = p.payments.map((x) => `${unitLabel(x.unitId)} ${money(x.amountCents)}`).join(" · ");
  return { ready, text, detail };
}
