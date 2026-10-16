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
}): Promise<{ id: string; url: string }> {
  const s = await stripeRequest<{ id: string; url: string }>("POST", "/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price: input.priceId, quantity: 1 }],
    client_reference_id: input.associationId,
    customer: input.customerId ?? undefined,
    customer_email: input.customerId ? undefined : (input.customerEmail ?? undefined),
    subscription_data: { metadata: { association_id: input.associationId } },
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
  items?: { data?: { current_period_end?: number; price?: { id?: string; recurring?: { interval?: string } } }[] };
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
