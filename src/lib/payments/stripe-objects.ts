import "server-only";
import { stripeRequest } from "@/lib/billing/stripe";

/**
 * Fresh reads of Stripe objects on a connected account, for the Connect
 * webhook (DECISIONS #57). The webhook never trusts the copy inside an event:
 * it reads the object again, so delivery order and a forged-but-signed replay
 * of an old event can't move a payment the wrong way.
 */

const dollars = (cents: number | null | undefined) => (typeof cents === "number" ? Math.round(cents) / 100 : null);

export interface PaymentIntentView {
  id: string;
  /** Walkup's payment row id, from the metadata Checkout set. */
  walkupPaymentId: string | null;
  status: string;
  /** Stripe's fee in dollars, once the charge has a balance transaction. */
  fee: number | null;
  failureReason: string | null;
  refunded: boolean;
}

interface RawCharge {
  id: string;
  refunded?: boolean;
  failure_message?: string | null;
  balance_transaction?: string | { fee?: number } | null;
}

export async function readPaymentIntent(id: string, account: string): Promise<PaymentIntentView> {
  const pi = await stripeRequest<{
    id: string;
    status: string;
    metadata?: Record<string, string>;
    last_payment_error?: { message?: string } | null;
    latest_charge?: string | RawCharge | null;
  }>("GET", `/payment_intents/${encodeURIComponent(id)}`, { expand: ["latest_charge.balance_transaction"] }, { stripeAccount: account });
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  const bt = charge?.balance_transaction && typeof charge.balance_transaction === "object" ? charge.balance_transaction : null;
  return {
    id: pi.id,
    walkupPaymentId: pi.metadata?.walkup_payment_id ?? null,
    status: pi.status,
    fee: dollars(bt?.fee),
    failureReason: pi.last_payment_error?.message ?? charge?.failure_message ?? null,
    refunded: charge?.refunded === true,
  };
}

/** The payment intent a charge or dispute belongs to. */
export async function paymentIntentOfCharge(chargeId: string, account: string): Promise<string | null> {
  const c = await stripeRequest<{ payment_intent?: string | null }>("GET", `/charges/${encodeURIComponent(chargeId)}`, undefined, {
    stripeAccount: account,
  });
  return c.payment_intent ?? null;
}

export interface PayoutView {
  id: string;
  amount: number;
  arrivalDate: string | null;
  status: "pending" | "in_transit" | "paid" | "failed" | "canceled";
  paymentIntentIds: string[];
}

/** A payout, and the payment intents of the charges in it (all pages). */
export async function readPayout(id: string, account: string): Promise<PayoutView> {
  const po = await stripeRequest<{ id: string; amount: number; arrival_date?: number | null; status: PayoutView["status"] }>(
    "GET",
    `/payouts/${encodeURIComponent(id)}`,
    undefined,
    { stripeAccount: account },
  );
  const intents = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const list = await stripeRequest<{
      data: { id: string; source?: { object?: string; payment_intent?: string | null } | string | null }[];
      has_more: boolean;
    }>(
      "GET",
      "/balance_transactions",
      { payout: id, limit: 100, starting_after: after, expand: ["data.source"] },
      { stripeAccount: account },
    );
    for (const bt of list.data) {
      const src = bt.source && typeof bt.source === "object" ? bt.source : null;
      if (src?.object === "charge" && src.payment_intent) intents.add(src.payment_intent);
    }
    if (!list.has_more || list.data.length === 0) break;
    after = list.data[list.data.length - 1].id;
  }
  const arrival = typeof po.arrival_date === "number" ? new Date(po.arrival_date * 1000).toISOString().slice(0, 10) : null;
  return { id: po.id, amount: dollars(po.amount) ?? 0, arrivalDate: arrival, status: po.status, paymentIntentIds: [...intents] };
}
