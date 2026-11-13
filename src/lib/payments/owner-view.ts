/**
 * What the owner's "Pay online" card says for one unit (DECISIONS #57).
 * Pure, so the wording and the rules are testable without Stripe or a page.
 * A failed payment counts as not paid; a started one shows as pending, never
 * as paid, until the board confirms the deposit.
 */

export type OnlinePaymentStatus =
  | "creating"
  | "checkout"
  | "processing"
  | "succeeded"
  | "deposited"
  | "failed"
  | "canceled"
  | "refunded"
  | "disputed";

export interface OnlinePaymentRow {
  status: OnlinePaymentStatus;
  amountCents: number;
  createdAt: string;
  failureReason: string | null;
}

export type PayOnlineLine =
  | { kind: "pay"; amountCents: number; buttonLabel: string; note: string | null }
  | { kind: "pending"; text: string }
  | { kind: "nothing_owed" };

const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: c % 100 === 0 ? 0 : 2 }).format(c / 100);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function day(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** A Checkout left open this long has expired at Stripe; the database frees the unit at 40 minutes. */
const CHECKOUT_STALE_MS = 40 * 60_000;

export function payOnlineLine(input: {
  owedCents: number;
  latest: OnlinePaymentRow | null;
  now?: number;
}): PayOnlineLine {
  const now = input.now ?? Date.now();
  const p = input.latest;

  if (p && (p.status === "processing" || p.status === "succeeded")) {
    return {
      kind: "pending",
      text:
        p.status === "processing"
          ? `Payment of ${money(p.amountCents)} started ${day(p.createdAt)}. Bank transfers take about 4 business days. It shows as paid once it clears.`
          : `Your bank sent ${money(p.amountCents)} on ${day(p.createdAt)}. It shows as paid once it reaches the association's bank.`,
    };
  }
  if (p && (p.status === "checkout" || p.status === "creating") && now - Date.parse(p.createdAt) < CHECKOUT_STALE_MS) {
    return { kind: "pending", text: "You opened a payment on Stripe. If you finished it, it shows here in a moment." };
  }

  if (input.owedCents <= 0) return { kind: "nothing_owed" };

  const note =
    p && p.status === "failed"
      ? `Your payment of ${money(p.amountCents)} on ${day(p.createdAt)} didn't go through${p.failureReason ? ` (${p.failureReason})` : ""}. Nothing was paid, so it still counts as owed.`
      : null;
  return {
    kind: "pay",
    amountCents: input.owedCents,
    buttonLabel: `Pay ${money(input.owedCents)} by bank transfer`,
    note,
  };
}

/** The message after coming back from Stripe (?paid=). */
export function returnMessage(paid: string | undefined): { tone: "good" | "neutral"; text: string } | null {
  if (paid === "started") return { tone: "good", text: "Thanks. Your payment is on its way. Bank transfers take about 4 business days to clear." };
  if (paid === "canceled") return { tone: "neutral", text: "You left Stripe before paying. Nothing was charged." };
  return null;
}
