import "server-only";
import { planForPriceId, stripeConfigProblem, type BillingInterval, type PlanKey } from "./config";

/**
 * A minimal Stripe REST client over fetch (no stripe package): hosted
 * Checkout, the hosted Customer Portal, and reading a subscription. Walkup
 * never sees or stores a card or bank number; the board enters them on
 * Stripe's pages. Server only: STRIPE_SECRET_KEY never reaches the browser.
 */

export const STRIPE_API_VERSION = "2025-03-31.basil";
const BASE = "https://api.stripe.com/v1";

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

/** Stripe's form encoding: nested keys as a[b][c]=v, arrays as a[0]=v. */
export function formEncode(params: Record<string, Param>): string {
  const out: string[] = [];
  const walk = (prefix: string, value: Param) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    else if (typeof value === "object") for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return out.join("&");
}

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, Param>,
  opts: { idempotencyKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const problem = stripeConfigProblem();
  if (problem) throw new StripeError(problem, 0, "not_configured");
  const key = process.env.STRIPE_SECRET_KEY!.trim();
  const body = params ? formEncode(params) : "";
  const url = method === "GET" && body ? `${BASE}${path}?${body}` : `${BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_API_VERSION,
  };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await (opts.fetchImpl ?? fetch)(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
  if (!res.ok) {
    throw new StripeError(json?.error?.message ?? `Stripe answered ${res.status}`, res.status, json?.error?.code);
  }
  return json as T;
}

export async function createCheckoutSession(input: {
  priceId: string;
  associationId: string;
  customerId: string | null;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
  /**
   * When the building's free time ends (its Walkup trial or a comp), so
   * choosing a plan early keeps the free days: Stripe starts the subscription
   * as trialing and takes the first payment on this date. Stripe needs it at
   * least 48 hours ahead; anything sooner is dropped and billing starts now.
   */
  freeUntil?: string | null;
}): Promise<{ id: string; url: string }> {
  const trialEnd = checkoutTrialEnd(input.freeUntil);
  const s = await stripeRequest<{ id: string; url: string }>("POST", "/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.associationId,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : (input.customerEmail ?? undefined),
    subscription_data: { metadata: { association_id: input.associationId }, trial_end: trialEnd ?? undefined },
    metadata: { association_id: input.associationId },
    allow_promotion_codes: true,
    consent_collection: { terms_of_service: "required" },
    billing_address_collection: "auto",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });
  if (!s.url) throw new StripeError("Stripe did not return a checkout page.", 502);
  return s;
}

const HOURS_48 = 48 * 3_600_000;

/** Unix seconds for subscription_data.trial_end, or null when there is no usable free time left. */
export function checkoutTrialEnd(freeUntil: string | null | undefined, now: Date = new Date()): number | null {
  if (!freeUntil) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(freeUntil) ? `${freeUntil}T23:59:59Z` : freeUntil);
  if (Number.isNaN(t) || t - now.getTime() < HOURS_48 + 3_600_000) return null;
  return Math.floor(t / 1000);
}

export async function createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
  return stripeRequest<{ url: string }>("POST", "/billing_portal/sessions", {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
}

/** The parts of a subscription Walkup keeps (no amounts, no card details). */
export interface SubscriptionSnapshot {
  id: string;
  customerId: string | null;
  associationId: string | null;
  status: string;
  priceId: string | null;
  planKey: PlanKey | null;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

interface RawSubscription {
  id: string;
  customer: string | { id: string } | null;
  status: string;
  metadata?: Record<string, string>;
  cancel_at_period_end?: boolean;
  current_period_end?: number;
  items?: { data?: { id?: string; current_period_end?: number; price?: { id?: string; recurring?: { interval?: string } } }[] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function snapshotSubscription(sub: RawSubscription, env: NodeJS.ProcessEnv = process.env): SubscriptionSnapshot {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const mapped = planForPriceId(priceId, env);
  const rawInterval = item?.price?.recurring?.interval;
  // Since API 2025-03-31 the period end lives on the item; older versions had it on the subscription.
  const periodEnd = item?.current_period_end ?? sub.current_period_end ?? null;
  const assoc = sub.metadata?.association_id ?? null;
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null),
    associationId: assoc && UUID.test(assoc) ? assoc : null,
    status: sub.status,
    priceId,
    planKey: mapped?.key ?? null,
    interval: mapped?.interval ?? (rawInterval === "month" || rawInterval === "year" ? rawInterval : null),
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
  };
}

export async function retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
  if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new StripeError("Not a subscription id.", 400);
  const sub = await stripeRequest<RawSubscription>("GET", `/subscriptions/${id}`);
  return snapshotSubscription(sub);
}

/** The customer's one live subscription, or null. Used to change its billing interval. */
export async function findLiveSubscription(customerId: string): Promise<(SubscriptionSnapshot & { itemId: string | null }) | null> {
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new StripeError("Not a customer id.", 400);
  const list = await stripeRequest<{ data?: (RawSubscription & { items?: { data?: { id?: string }[] } })[] }>("GET", "/subscriptions", {
    customer: customerId,
    status: "active",
    limit: 1,
  });
  const sub = list.data?.[0];
  if (!sub) return null;
  return { ...snapshotSubscription(sub), itemId: sub.items?.data?.[0]?.id ?? null };
}

/**
 * Moves a subscription to another price of the same plan (monthly to yearly).
 * Stripe credits the unused part of the current period and charges the new
 * price now, in one invoice, and the new period starts today. If the card
 * fails the switch is refused and nothing changes (error_if_incomplete).
 */
export async function switchSubscriptionPrice(subscriptionId: string, itemId: string, priceId: string): Promise<SubscriptionSnapshot> {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !/^si_[A-Za-z0-9]+$/.test(itemId)) throw new StripeError("Not a subscription.", 400);
  const sub = await stripeRequest<RawSubscription>(
    "POST",
    `/subscriptions/${subscriptionId}`,
    {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: "always_invoice",
      billing_cycle_anchor: "now",
      payment_behavior: "error_if_incomplete",
    },
    { idempotencyKey: `switch-${subscriptionId}-${priceId}` },
  );
  return snapshotSubscription(sub);
}

/**
 * The customer's one subscription that can still be renewed or ended (active, in a Stripe trial, or past due), or
 * null. Used by the auto-renew switch, which has to reach a subscription that is still in its free days too.
 */
export async function findManageableSubscription(customerId: string): Promise<(SubscriptionSnapshot & { cancelAtPeriodEnd: boolean }) | null> {
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId)) throw new StripeError("Not a customer id.", 400);
  const list = await stripeRequest<{ data?: RawSubscription[] }>("GET", "/subscriptions", { customer: customerId, status: "all", limit: 5 });
  const sub = (list.data ?? []).find((s) => ["active", "trialing", "past_due"].includes(String((s as { status?: string }).status)));
  if (!sub) return null;
  return { ...snapshotSubscription(sub), cancelAtPeriodEnd: snapshotSubscription(sub).cancelAtPeriodEnd };
}

/**
 * Turns automatic renewal off or on. Off ends the plan when the paid period runs out (Stripe's
 * cancel_at_period_end), with nothing refunded and nothing charged again; on keeps it going. Either can be
 * undone any time before the period ends.
 */
export async function setSubscriptionAutoRenew(subscriptionId: string, renew: boolean): Promise<SubscriptionSnapshot> {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw new StripeError("Not a subscription.", 400);
  const sub = await stripeRequest<RawSubscription>(
    "POST",
    `/subscriptions/${subscriptionId}`,
    { cancel_at_period_end: !renew },
    { idempotencyKey: `autorenew-${subscriptionId}-${renew ? "on" : "off"}-${Math.floor(Date.now() / 60_000)}` },
  );
  return snapshotSubscription(sub);
}

/**
 * Moves a subscription to another price at its next renewal: the price changes now, with nothing credited or
 * charged now (proration_behavior none), so the new price is the one on the invoice Stripe makes when the period
 * ends. Used for a tier change after its 30 days' notice (DECISIONS #44).
 */
export async function moveSubscriptionPriceAtRenewal(subscriptionId: string, priceId: string): Promise<SubscriptionSnapshot> {
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId) || !/^price_[A-Za-z0-9_]+$/.test(priceId)) throw new StripeError("Not a subscription or price.", 400);
  const current = await stripeRequest<RawSubscription>("GET", `/subscriptions/${subscriptionId}`);
  const itemId = current.items?.data?.[0]?.id;
  if (!itemId) throw new StripeError("The subscription has no item to change.", 400);
  const sub = await stripeRequest<RawSubscription>(
    "POST",
    `/subscriptions/${subscriptionId}`,
    { items: [{ id: itemId, price: priceId }], proration_behavior: "none" },
    { idempotencyKey: `tier-${subscriptionId}-${priceId}` },
  );
  return snapshotSubscription(sub);
}
