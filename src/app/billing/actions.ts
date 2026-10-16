"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { SITE_URL } from "@/lib/site-config";
import { getBilling } from "@/lib/billing/entitlement";
import { createCheckoutSession, createPortalSession, findLiveSubscription, switchSubscriptionPrice } from "@/lib/billing/stripe";
import {
  TOO_MANY_UNITS_MESSAGE,
  billingEnabled,
  planByKey,
  priceIdFor,
  stripeConfigProblem,
  tierForUnits,
  type BillingInterval,
} from "@/lib/billing/config";

/**
 * Board admin billing actions (subscriptions plan 2.5). Both send the board
 * admin to Stripe's own hosted pages; Walkup never sees a card or bank
 * number. The Stripe customer is linked to the association only by the
 * signed webhook (checkout.session.completed), never from here.
 */

export interface BillingActionState {
  error?: string;
}

const NOT_ON = "Paid plans aren't switched on yet. Walkup is free during early access, so there is nothing to pay.";

async function origin(): Promise<string> {
  if (process.env.VERCEL_ENV === "production") return SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return SITE_URL;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

async function boardAdminBilling() {
  const viewer = await getViewer();
  if (!viewer?.isBoardAdmin) return { error: "Only a board admin can manage Walkup's plan." } as const;
  if (!billingEnabled()) return { error: NOT_ON } as const;
  const problem = stripeConfigProblem();
  if (problem) return { error: `${problem} Nothing has been charged.` } as const;
  const view = await getBilling(viewer.associationId);
  if (!view) return { error: "We couldn't load your building's plan. Try again in a minute." } as const;
  return { viewer, view } as const;
}

/** The end of the building's free time still to come: the trial, or a comp with an end date. */
function freeUntil(f: { trialEndsAt: string | null; compActive: boolean; compExpiresOn: string | null }): string | null {
  const now = Date.now();
  const ends = [f.trialEndsAt, f.compActive ? f.compExpiresOn : null]
    .filter((v): v is string => !!v)
    .map((v) => ({ v, t: Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59Z` : v) }))
    .filter((x) => !Number.isNaN(x.t) && x.t > now)
    .sort((a, b) => b.t - a.t);
  return ends[0]?.v ?? null;
}

export async function startCheckout(_prev: BillingActionState | null, formData: FormData): Promise<BillingActionState> {
  const ctx = await boardAdminBilling();
  if ("error" in ctx) return { error: ctx.error };
  const { viewer, view } = ctx;

  const live = ["active", "trialing", "past_due", "unpaid"];
  if (view.facts.hasSubscription && live.includes(view.facts.subscriptionStatus ?? "")) {
    return { error: "Your building already has a plan. Use Manage billing to change it." };
  }
  const interval: BillingInterval = formData.get("interval") === "year" ? "year" : "month";
  const tier = tierForUnits(view.facts.unitCount);
  if (!tier) return { error: TOO_MANY_UNITS_MESSAGE };
  const priceId = priceIdFor(tier.key, interval);
  if (!priceId) return { error: "Payments are not set up yet. Nothing has been charged." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const email = typeof claims?.claims?.email === "string" ? claims.claims.email : null;
  const base = await origin();

  let url: string;
  try {
    const session = await createCheckoutSession({
      priceId,
      associationId: viewer.associationId,
      customerId: view.facts.stripeCustomerId,
      customerEmail: email,
      successUrl: `${base}/account?tab=billing&checkout=done`,
      cancelUrl: `${base}/account?tab=billing&checkout=cancelled`,
      freeUntil: freeUntil(view.facts),
    });
    url = session.url;
  } catch (cause) {
    console.error("[walkup-billing] checkout_failed", (cause as { status?: number }).status ?? "-");
    return { error: "Stripe couldn't open the checkout page. Nothing has been charged. Try again in a minute." };
  }
  redirect(url);
}

export async function openPortal(): Promise<BillingActionState> {
  const ctx = await boardAdminBilling();
  if ("error" in ctx) return { error: ctx.error };
  const customerId = ctx.view.facts.stripeCustomerId;
  if (!customerId) return { error: "There is no payment account yet. Choose a plan first." };

  let url: string;
  try {
    const session = await createPortalSession({ customerId, returnUrl: `${await origin()}/account?tab=billing` });
    url = session.url;
  } catch (cause) {
    console.error("[walkup-billing] portal_failed", (cause as { status?: number }).status ?? "-");
    return { error: "Stripe couldn't open the billing page. Try again in a minute." };
  }
  redirect(url);
}

/**
 * Monthly to yearly on the same plan, with Stripe crediting the unused part of
 * the month (see switchSubscriptionPrice). Board admin only. The webhook
 * (customer.subscription.updated) is what updates Walkup's own record, so the
 * Billing page catches up within a minute.
 */
export async function upgradeToYearly(): Promise<BillingActionState & { ok?: boolean }> {
  const ctx = await boardAdminBilling();
  if ("error" in ctx) return { error: ctx.error };
  const { viewer, view } = ctx;
  const f = view.facts;
  if (!f.stripeCustomerId || !f.hasSubscription) return { error: "There's no plan to change yet. Choose a plan first." };
  if (f.subscriptionStatus !== "active") return { error: "Yearly billing can be chosen once your plan is active." };
  if (f.billingInterval === "year") return { error: "Your plan is already billed yearly." };
  if (f.cancelAtPeriodEnd) return { error: "Your plan is set to end. Keep it going first, in Manage billing, then switch to yearly." };
  const plan = planByKey(f.planKey)?.key;
  if (!plan) return { error: "We couldn't tell which plan you're on. Email support and we'll sort it out." };
  const priceId = priceIdFor(plan, "year");
  if (!priceId) return { error: "Yearly billing isn't set up yet. Nothing has been charged." };

  try {
    const sub = await findLiveSubscription(f.stripeCustomerId);
    // The subscription must be this building's own, never trusted from the customer id alone.
    if (!sub || !sub.itemId) return { error: "We couldn't find your plan at Stripe. Nothing has been charged." };
    if (sub.associationId && sub.associationId !== viewer.associationId) return { error: "That plan belongs to another building." };
    if (sub.interval === "year") return { error: "Your plan is already billed yearly." };
    await switchSubscriptionPrice(sub.id, sub.itemId, priceId);
  } catch (cause) {
    console.error("[walkup-billing] upgrade_failed", (cause as { status?: number }).status ?? "-", (cause as { code?: string }).code ?? "-");
    return { error: "Stripe couldn't switch your plan to yearly. Nothing has changed, and you have not been charged twice. Try again, or use Manage billing." };
  }
  revalidatePath("/account");
  return { ok: true };
}
