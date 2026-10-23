"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/site-config";
import { getBilling } from "@/lib/billing/entitlement";
import { renderRefundNotice, type RefundKind } from "@/lib/billing/refund";
import { sendConfig } from "@/lib/email-outbox/config";
import { sendViaResend } from "@/lib/email-outbox/resend";
import {
  createCheckoutSession,
  createPortalSession,
  findLiveSubscription,
  findManageableSubscription,
  setSubscriptionAutoRenew,
  switchSubscriptionPrice,
} from "@/lib/billing/stripe";
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

/**
 * The auto-renew switch (DECISIONS #52). Plans renew by themselves; a board admin can turn that off, which ends the
 * plan when the paid period runs out, and back on any time before. The subscription must be this building's own.
 * The webhook (customer.subscription.updated) updates Walkup's record, so this page catches up within a minute.
 */
export async function setAutoRenew(_prev: (BillingActionState & { ok?: boolean }) | null, formData: FormData): Promise<BillingActionState & { ok?: boolean }> {
  const ctx = await boardAdminBilling();
  if ("error" in ctx) return { error: ctx.error };
  const { viewer, view } = ctx;
  const f = view.facts;
  const renew = formData.get("renew") === "on";
  if (!f.stripeCustomerId || !f.hasSubscription) return { error: "There's no plan to change yet. Choose a plan first." };
  if (renew === !f.cancelAtPeriodEnd) return { error: renew ? "Auto-renew is already on." : "Auto-renew is already off." };

  try {
    const sub = await findManageableSubscription(f.stripeCustomerId);
    if (!sub) return { error: "We couldn't find an active plan at Stripe. Nothing has changed." };
    if (sub.associationId && sub.associationId !== viewer.associationId) return { error: "That plan belongs to another building." };
    await setSubscriptionAutoRenew(sub.id, renew);
  } catch (cause) {
    console.error("[walkup-billing] autorenew_failed", (cause as { status?: number }).status ?? "-", (cause as { code?: string }).code ?? "-");
    return { error: "Stripe couldn't change auto-renew. Nothing has changed. Try again in a minute." };
  }
  revalidatePath("/account");
  return { ok: true };
}

/**
 * A yearly refund request, or the retention offer taken instead (migration 0087, DECISIONS #53). Walkup never moves
 * money: this records the request, tells support by email so it is not missed, and the refund or credit is made by
 * hand in Stripe. The database checks that the caller is a board admin, the plan is yearly and paid, the charge is
 * inside the 14 days, and no request is already open.
 */
export async function requestRefund(kind: RefundKind, reason: string): Promise<BillingActionState & { ok?: boolean }> {
  if (kind !== "refund" && kind !== "offer") return { error: "Choose a refund or the offer." };
  const viewer = await getViewer();
  if (!viewer?.isBoardAdmin) return { error: "Only a board admin can ask for a refund." };
  const view = await getBilling(viewer.associationId);
  if (!view) return { error: "We couldn't load your building's plan. Try again in a minute." };
  const note = reason.trim().slice(0, 500);

  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_request_refund", { p_association_id: viewer.associationId, p_kind: kind, p_reason: note || null });
  if (error) {
    if (error.code === "42501") return { error: "Only a board admin can ask for a refund." };
    if (error.code === "23505") return { error: "A request for your building is already with us." };
    if (error.code === "22023") return { error: error.message };
    console.error("[walkup-billing] refund_request_failed", error.code ?? "-");
    return { error: "Couldn't send that. Try again in a minute, or email support." };
  }

  // Tell support, best effort: the request is saved either way and shows on the billing admin page.
  const config = sendConfig();
  if (config.ok) {
    const mail = renderRefundNotice({
      kind,
      associationName: viewer.associationName,
      requesterName: viewer.fullName,
      planName: planByKey(view.facts.planKey)?.name ?? null,
      chargedOn: view.refund?.chargedOn ?? null,
      reason: note || null,
    });
    const sent = await sendViaResend(config.apiKey, {
      from: `"Walkup" <${config.from}>`,
      to: SUPPORT_EMAIL,
      replyTo: SUPPORT_EMAIL,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: {},
      tags: [{ name: "kind", value: `billing_refund_${kind}` }],
      idempotencyKey: `wk-refund-${viewer.associationId}-${view.refund?.chargedOn ?? "x"}-${kind}`,
    });
    if (!sent.ok) console.error("[walkup-billing] refund_notice_failed", sent.status);
  }
  revalidatePath("/account");
  revalidatePath("/admin/billing");
  return { ok: true };
}
