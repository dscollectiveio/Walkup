import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { billingServiceRpc } from "@/lib/billing/service-rpc";
import { verifyStripeSignature } from "@/lib/billing/stripe-signature";
import { retrieveSubscription, snapshotSubscription, StripeError, type SubscriptionSnapshot } from "@/lib/billing/stripe";
import { stripeConfigProblem, stripeIsLive } from "@/lib/billing/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stripe's webhook for Walkup's own subscription (subscriptions plan 2.6).
 * Public by necessity (Stripe has no session), so it trusts nothing until the
 * Stripe-Signature over the exact raw body checks out. Then, for an allowlist
 * of six event types only, it claims the event id once (idempotency), fetches
 * the subscription fresh from Stripe (so delivery order does not matter), and
 * records it through billingServiceRpc, which can call five billing functions
 * and nothing else. It never touches the association's books, bank or dues,
 * and stores no card data, names, emails or amounts.
 *
 * Responses: 500 when STRIPE_WEBHOOK_SECRET (or the Stripe key for an event
 * that needs it) is missing, or our own work fails, so Stripe retries; 400
 * for a bad signature (no database call); 200 for every verified delivery,
 * including repeats, other event types and test/live mismatches.
 */

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome = "applied" | "ignored" | "stale" | "failed";

interface StripeEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "object" && v && typeof (v as { id?: unknown }).id === "string" ? (v as { id: string }).id : null);

function outcomeOf(result: unknown): Outcome {
  return result === "applied" ? "applied" : result === "stale" ? "stale" : "ignored";
}

class RpcFailure extends Error {
  constructor(readonly code: string | undefined) {
    super("rpc failed");
  }
}

async function rpc<T>(name: Parameters<typeof billingServiceRpc>[0], args: Record<string, unknown>): Promise<T> {
  const r = await billingServiceRpc<T>(name, args);
  if (r.error) throw new RpcFailure(r.error.code);
  return r.data as T;
}

async function applySubscription(sub: SubscriptionSnapshot, created: string, associationId: string | null): Promise<Outcome> {
  const result = await rpc<string>("billing_apply_subscription", {
    p_subscription_id: sub.id,
    p_customer_id: sub.customerId,
    p_association_id: associationId ?? sub.associationId,
    p_status: sub.status,
    p_plan_key: sub.planKey,
    p_price_id: sub.priceId,
    p_interval: sub.interval,
    p_current_period_end: sub.currentPeriodEnd,
    p_cancel_at_period_end: sub.cancelAtPeriodEnd,
    p_event_created: created,
  });
  return outcomeOf(result);
}

async function handle(event: StripeEvent): Promise<{ outcome: Outcome; associationId: string | null }> {
  const obj = event.data.object;
  const created = new Date(event.created * 1000).toISOString();

  if (event.type === "checkout.session.completed") {
    if (obj.mode !== "subscription") return { outcome: "ignored", associationId: null };
    const ref = str(obj.client_reference_id);
    const associationId = ref && UUID.test(ref) ? ref : null;
    const customerId = str(obj.customer);
    const subscriptionId = str(obj.subscription);
    if (!associationId || !customerId) return { outcome: "ignored", associationId: null };
    const consent = (obj.consent ?? null) as { terms_of_service?: unknown } | null;
    const linked = await rpc<string>("billing_link_checkout", {
      p_association_id: associationId,
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_terms_accepted_at: consent?.terms_of_service === "accepted" ? created : null,
      p_event_created: created,
    });
    if (linked !== "applied") return { outcome: "ignored", associationId: null };
    if (!subscriptionId) return { outcome: "applied", associationId };
    const sub = await retrieveSubscription(subscriptionId);
    await applySubscription(sub, created, associationId);
    return { outcome: "applied", associationId };
  }

  if (event.type.startsWith("customer.subscription.")) {
    const id = str(obj.id);
    if (!id) return { outcome: "ignored", associationId: null };
    let sub: SubscriptionSnapshot;
    try {
      sub = await retrieveSubscription(id);
    } catch (cause) {
      // A deleted subscription Stripe no longer returns: the event's own copy is final.
      if (cause instanceof StripeError && cause.status === 404) sub = snapshotSubscription(obj as never);
      else throw cause;
    }
    return { outcome: await applySubscription(sub, created, null), associationId: sub.associationId };
  }

  // invoice.paid / invoice.payment_failed
  const customerId = str(obj.customer);
  if (!customerId) return { outcome: "ignored", associationId: null };
  const result = await rpc<string>("billing_record_payment", {
    p_customer_id: customerId,
    p_paid: event.type === "invoice.paid",
    p_event_created: created,
  });
  return { outcome: outcomeOf(result), associationId: null };
}

export async function POST(request: NextRequest) {
  const raw = await request.text(); // exact bytes: the signature covers them
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "STRIPE_WEBHOOK_SECRET is not configured." }, { status: 500 });

  if (!verifyStripeSignature({ secret, header: request.headers.get("stripe-signature"), body: raw })) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const valid =
    typeof event?.id === "string" &&
    /^evt_[A-Za-z0-9_]{1,250}$/.test(event.id) &&
    typeof event.type === "string" &&
    typeof event.created === "number" &&
    typeof event.data?.object === "object" &&
    event.data.object !== null;
  if (!valid || !HANDLED.has(event.type)) return NextResponse.json({ ok: true, ignored: true });

  if (stripeConfigProblem()) {
    console.error("[walkup-billing] webhook_not_configured", event.type);
    return NextResponse.json({ error: "STRIPE_SECRET_KEY is not configured." }, { status: 500 });
  }
  // A test event reaching a live deployment, or the reverse.
  if (event.livemode !== stripeIsLive()) {
    console.info("[walkup-billing] webhook", { id: event.id, type: event.type, outcome: "ignored_mode" });
    return NextResponse.json({ ok: true, ignored: true });
  }

  const claim = await billingServiceRpc<boolean>("billing_claim_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_created: new Date(event.created * 1000).toISOString(),
  });
  if (claim.error) {
    console.error("[walkup-billing] claim_failed", claim.error.code ?? "-");
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }
  if (claim.data !== true) return NextResponse.json({ ok: true, duplicate: true });

  let outcome: Outcome;
  let associationId: string | null = null;
  let retry = false;
  try {
    ({ outcome, associationId } = await handle(event));
  } catch (cause) {
    outcome = "failed";
    // A customer or subscription already linked to another association will
    // never succeed on retry; anything else (network, Stripe, database) might.
    retry = !(cause instanceof RpcFailure && cause.code === "23505");
    console.error("[walkup-billing] handle_failed", {
      id: event.id,
      type: event.type,
      code: cause instanceof RpcFailure ? (cause.code ?? "-") : cause instanceof StripeError ? `stripe_${cause.status}` : "error",
    });
  }

  await billingServiceRpc("billing_finish_event", { p_event_id: event.id, p_outcome: outcome, p_association_id: associationId });
  console.info("[walkup-billing] webhook", { id: event.id, type: event.type, outcome });
  if (retry) return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  return NextResponse.json({ ok: true, outcome });
}
