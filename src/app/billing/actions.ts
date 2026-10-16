"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { SITE_URL } from "@/lib/site-config";
import { getBilling } from "@/lib/billing/entitlement";
import { createCheckoutSession, createPortalSession } from "@/lib/billing/stripe";
import {
  TOO_MANY_UNITS_MESSAGE,
  billingEnabled,
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
      successUrl: `${base}/billing?checkout=done`,
      cancelUrl: `${base}/billing?checkout=cancelled`,
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
    const session = await createPortalSession({ customerId, returnUrl: `${await origin()}/billing` });
    url = session.url;
  } catch (cause) {
    console.error("[walkup-billing] portal_failed", (cause as { status?: number }).status ?? "-");
    return { error: "Stripe couldn't open the billing page. Try again in a minute." };
  }
  redirect(url);
}
