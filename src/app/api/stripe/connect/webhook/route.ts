import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { verifyStripeSignature } from "@/lib/billing/stripe-signature";
import { StripeError } from "@/lib/billing/stripe";
import { stripeConfigProblem, stripeIsLive } from "@/lib/billing/config";
import { fetchConnectAccountStatus } from "@/lib/payments/connect";
import { retrieveDuesCheckout, statusFromCheckout } from "@/lib/payments/checkout";
import { paymentIntentOfCharge, readPaymentIntent, readPayout } from "@/lib/payments/stripe-objects";
import { paymentsServiceRpc } from "@/lib/payments/service-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe's webhook for events on associations' connected accounts: online
 * dues payments (DECISIONS #57, plan Phase 4). Separate from Walkup's own
 * billing webhook, with its own signing secret (STRIPE_CONNECT_WEBHOOK_SECRET).
 *
 * Public by necessity, so it trusts nothing until the Stripe-Signature over
 * the raw body checks out. Then, for an allowlist of event types only, it
 * claims the event id once, reads the object fresh from Stripe on the event's
 * own connected account, and moves a status through paymentsServiceRpc. The
 * database matches every update to the account it came from, and statuses only
 * move forward. Nothing here reaches the ledger: a person confirms the payout
 * in the bank feed (#29).
 *
 * Responses: 500 when the secret or Stripe key is missing, or our own work
 * fails, so Stripe retries; 400 for a bad signature (no database call); 200
 * for every verified delivery, including repeats, other types and mode mismatches.
 */

const CONNECT_HANDLED = new Set([
  "account.updated",
  "account.application.deauthorized",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
]);

type Outcome = "applied" | "ignored" | "stale" | "failed";

interface ConnectEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string;
  data: { object: Record<string, unknown> };
}

const ACCT = /^acct_[A-Za-z0-9]{1,250}$/;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : typeof v === "object" && v && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null;

class RpcFailure extends Error {
  constructor(readonly code: string | undefined) {
    super("rpc failed");
  }
}

async function rpc(name: Parameters<typeof paymentsServiceRpc>[0], args: Record<string, unknown>): Promise<Outcome> {
  const r = await paymentsServiceRpc<string>(name, args);
  if (r.error) throw new RpcFailure(r.error.code);
  return r.data === "applied" ? "applied" : r.data === "stale" ? "stale" : "ignored";
}

async function applyIntent(account: string, intentId: string, walkupPaymentId: string | null): Promise<Outcome> {
  const pi = await readPaymentIntent(intentId, account);
  const status =
    pi.status === "succeeded" ? "succeeded" : pi.status === "processing" ? "processing" : pi.status === "requires_payment_method" && pi.failureReason ? "failed" : null;
  if (!status) return "ignored";
  return rpc("connect_apply_payment", {
    p_stripe_account_id: account,
    p_checkout_session_id: null,
    p_payment_intent_id: pi.id,
    p_status: status,
    p_fee: pi.fee,
    p_failure_reason: status === "failed" ? pi.failureReason : null,
    p_payment_id: pi.walkupPaymentId ?? walkupPaymentId,
  });
}

async function handleConnectEvent(event: ConnectEvent): Promise<Outcome> {
  const account = event.account!;
  const obj = event.data.object;

  switch (event.type) {
    case "account.updated": {
      const s = await fetchConnectAccountStatus(account);
      return rpc("connect_apply_account", {
        p_stripe_account_id: account,
        p_charges_enabled: s.chargesEnabled,
        p_payouts_enabled: s.payoutsEnabled,
        p_details_submitted: s.detailsSubmitted,
      });
    }
    case "account.application.deauthorized":
      return rpc("connect_account_deauthorized", { p_stripe_account_id: account });

    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired": {
      // Only Walkup's dues Checkouts carry this; anything else on the account is the association's own business.
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      const sessionId = str(obj.id);
      if (!sessionId || !meta.walkup_payment_id) return "ignored";
      const s = await retrieveDuesCheckout(sessionId, account);
      if (event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.async_payment_failed") {
        if (!s.paymentIntentId) return "ignored";
        // The payment intent has the fee and the failure reason.
        return applyIntent(account, s.paymentIntentId, meta.walkup_payment_id);
      }
      const next = statusFromCheckout(s);
      if (!next) return "ignored";
      return rpc("connect_apply_payment", {
        p_stripe_account_id: account,
        p_checkout_session_id: sessionId,
        p_payment_intent_id: s.paymentIntentId,
        p_status: next,
        p_payment_id: meta.walkup_payment_id,
      });
    }

    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      const id = str(obj.id);
      const meta = (obj.metadata ?? {}) as Record<string, string>;
      if (!id || !meta.walkup_payment_id) return "ignored";
      return applyIntent(account, id, meta.walkup_payment_id);
    }

    case "charge.refunded": {
      const chargeId = str(obj.id);
      if (!chargeId) return "ignored";
      const intentId = await paymentIntentOfCharge(chargeId, account);
      if (!intentId) return "ignored";
      const pi = await readPaymentIntent(intentId, account);
      // A partial refund leaves the payment as it is; the board sees it in Stripe.
      if (!pi.refunded) return "ignored";
      return rpc("connect_apply_payment", {
        p_stripe_account_id: account,
        p_checkout_session_id: null,
        p_payment_intent_id: intentId,
        p_status: "refunded",
      });
    }

    case "charge.dispute.created": {
      const chargeId = str(obj.charge);
      if (!chargeId) return "ignored";
      const intentId = await paymentIntentOfCharge(chargeId, account);
      if (!intentId) return "ignored";
      return rpc("connect_apply_payment", {
        p_stripe_account_id: account,
        p_checkout_session_id: null,
        p_payment_intent_id: intentId,
        p_status: "disputed",
      });
    }

    default: {
      // payout.*
      const payoutId = str(obj.id);
      if (!payoutId) return "ignored";
      const po = await readPayout(payoutId, account);
      if (po.amount <= 0) return "ignored";
      return rpc("connect_apply_payout", {
        p_stripe_account_id: account,
        p_payout_id: po.id,
        p_amount: po.amount,
        p_arrival_date: po.arrivalDate,
        p_status: po.status,
        p_payment_intent_ids: po.paymentIntentIds,
      });
    }
  }
}

export async function POST(request: NextRequest) {
  const raw = await request.text(); // exact bytes: the signature covers them
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_CONNECT_WEBHOOK_SECRET is not configured." }, { status: 500 });

  if (!verifyStripeSignature({ secret, header: request.headers.get("stripe-signature"), body: raw })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: ConnectEvent;
  try {
    event = JSON.parse(raw) as ConnectEvent;
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const valid =
    typeof event?.id === "string" &&
    /^evt_[A-Za-z0-9_]{1,250}$/.test(event.id) &&
    typeof event.type === "string" &&
    typeof event.created === "number" &&
    typeof event.account === "string" &&
    ACCT.test(event.account) &&
    typeof event.data?.object === "object" &&
    event.data.object !== null;
  if (!valid || !CONNECT_HANDLED.has(event.type)) return NextResponse.json({ ok: true, ignored: true });

  if (stripeConfigProblem()) {
    console.error("[walkup-connect] webhook_not_configured", event.type);
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not configured." }, { status: 500 });
  }
  if (event.livemode !== stripeIsLive()) {
    console.info("[walkup-connect] webhook", { id: event.id, type: event.type, outcome: "ignored_mode" });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const claim = await paymentsServiceRpc<boolean>("connect_claim_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_account: event.account,
    p_created: new Date(event.created * 1000).toISOString(),
  });
  if (claim.error) {
    console.error("[walkup-connect] claim_failed", claim.error.code ?? "-");
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }
  if (claim.data !== true) return NextResponse.json({ ok: true, duplicate: true });

  let outcome: Outcome;
  let retry = false;
  try {
    outcome = await handleConnectEvent(event);
  } catch (cause) {
    outcome = "failed";
    // A Stripe object that no longer exists (404) won't appear on retry; anything else might.
    retry = !(cause instanceof StripeError && cause.status === 404);
    console.error("[walkup-connect] handle_failed", {
      id: event.id,
      type: event.type,
      code: cause instanceof RpcFailure ? (cause.code ?? "-") : cause instanceof StripeError ? `stripe_${cause.status}` : "error",
    });
  }

  await paymentsServiceRpc("connect_finish_event", { p_event_id: event.id, p_outcome: outcome });
  console.info("[walkup-connect] webhook", { id: event.id, type: event.type, outcome });
  if (retry) return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  return NextResponse.json({ ok: true, outcome });
}
