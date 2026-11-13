import "server-only";
import { stripeRequest } from "@/lib/billing/stripe";

/**
 * Stripe Checkout for one owner's dues payment, on the association's own
 * connected account (DECISIONS #57). ACH only, the amount the database
 * computed, no surcharge and no application fee. Stripe hosts the page and
 * collects the bank link; Walkup never sees an account or routing number.
 */

/** Stripe needs a Checkout session to live at least 30 minutes; the database frees the unit after 40. */
export const CHECKOUT_MINUTES = 31;

export interface DuesCheckoutInput {
  paymentId: string;
  associationId: string;
  unitId: string;
  unitLabel: string;
  associationName: string;
  amountCents: number;
  stripeAccountId: string;
  successUrl: string;
  cancelUrl: string;
  now?: number;
}

/** The exact Stripe parameters, separate so a test can pin them. */
export function duesCheckoutParams(input: DuesCheckoutInput) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amount must be positive whole cents");
  const metadata = {
    walkup_payment_id: input.paymentId,
    association_id: input.associationId,
    unit_id: input.unitId,
  };
  return {
    mode: "payment",
    payment_method_types: ["us_bank_account"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          product_data: { name: `HOA dues, ${input.unitLabel}`, description: input.associationName },
        },
      },
    ],
    client_reference_id: input.paymentId,
    metadata,
    payment_intent_data: { metadata, description: `HOA dues, ${input.unitLabel}` },
    payment_method_options: { us_bank_account: { verification_method: "automatic" } },
    expires_at: Math.floor((input.now ?? Date.now()) / 1000) + CHECKOUT_MINUTES * 60,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}

export async function createDuesCheckout(input: DuesCheckoutInput): Promise<{ id: string; url: string }> {
  const s = await stripeRequest<{ id: string; url: string | null }>("POST", "/checkout/sessions", duesCheckoutParams(input), {
    stripeAccount: input.stripeAccountId,
    // One session per payment row, even if the action runs twice.
    idempotencyKey: `dues-checkout-${input.paymentId}`,
  });
  if (!s.url) throw new Error("Stripe did not return a checkout page.");
  return { id: s.id, url: s.url };
}

export interface DuesCheckoutState {
  status: "open" | "complete" | "expired";
  paymentStatus: "paid" | "unpaid" | "no_payment_required";
  paymentIntentId: string | null;
}

export async function retrieveDuesCheckout(sessionId: string, stripeAccountId: string): Promise<DuesCheckoutState> {
  const s = await stripeRequest<{ status: DuesCheckoutState["status"]; payment_status: DuesCheckoutState["paymentStatus"]; payment_intent: string | { id: string } | null }>(
    "GET",
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    { stripeAccount: stripeAccountId },
  );
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
  return { status: s.status, paymentStatus: s.payment_status, paymentIntentId: pi };
}

/** Closes an unfinished Checkout so it can't be paid later. Throws if it was already completed. */
export async function expireDuesCheckout(sessionId: string, stripeAccountId: string): Promise<void> {
  await stripeRequest("POST", `/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, { stripeAccount: stripeAccountId });
}

/** What a Checkout's state means for the payment row: the status to move it to, or null for "leave it". */
export function statusFromCheckout(s: DuesCheckoutState): "processing" | "succeeded" | "canceled" | null {
  if (s.status === "expired") return "canceled";
  if (s.status === "complete") return s.paymentStatus === "paid" ? "succeeded" : "processing";
  return null;
}
