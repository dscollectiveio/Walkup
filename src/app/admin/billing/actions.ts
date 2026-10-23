"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { retrieveSubscription } from "@/lib/billing/stripe";
import { stripeConfigProblem } from "@/lib/billing/config";

// Platform admin only (DECISIONS #31): complimentary access, trials and a
// manual refresh from Stripe. Every function re-checks is_platform_admin()
// in the database (0062); the check here only gives a plain message.

export interface AdminBillingState {
  ok?: boolean;
  error?: string;
}

const KINDS = ["early_access", "founding", "friend", "pilot", "nonprofit", "other"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function platformAdmin() {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  return isAdmin === true ? supabase : null;
}

function associationId(formData: FormData): string | null {
  const id = String(formData.get("association_id") ?? "");
  return UUID.test(id) ? id : null;
}

function done(): AdminBillingState {
  revalidatePath("/admin/billing");
  revalidatePath("/billing");
  revalidatePath("/account");
  return { ok: true };
}

export async function grantComp(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can give complimentary access." };
  const id = associationId(formData);
  const kind = String(formData.get("kind") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const expires = String(formData.get("expires_on") ?? "").trim();
  if (!id) return { error: "Pick an association." };
  if (!(KINDS as readonly string[]).includes(kind)) return { error: "Pick a kind." };
  if (!reason) return { error: "A reason is required." };
  if (reason.length > 300) return { error: "Keep the reason under 300 characters." };
  if (expires && !DATE.test(expires)) return { error: "The end date is not a date." };

  const { error } = await supabase.rpc("billing_grant_comp", {
    p_association_id: id,
    p_kind: kind,
    p_reason: reason,
    p_expires_on: expires || null,
  });
  if (error) return { error: error.message };
  return done();
}

export async function revokeComp(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can end complimentary access." };
  const id = associationId(formData);
  if (!id) return { error: "Pick an association." };
  const { error } = await supabase.rpc("billing_revoke_comp", { p_association_id: id });
  if (error) return { error: error.message };
  return done();
}

export async function extendTrial(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can change a trial." };
  const id = associationId(formData);
  const until = String(formData.get("trial_until") ?? "").trim();
  if (!id) return { error: "Pick an association." };
  if (!DATE.test(until)) return { error: "Pick the new last day of the trial." };
  const { error } = await supabase.rpc("billing_extend_trial", { p_association_id: id, p_new_end: until });
  if (error) return { error: error.message };
  return done();
}

/**
 * Sets the day an early-access building's free use ends. The database insists on at least 90 days' notice
 * (DECISIONS #44); the daily run then emails the board admins and shows the notice in Walkup.
 */
export async function endEarlyAccess(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can end early access." };
  const id = associationId(formData);
  const ends = String(formData.get("ends_on") ?? "").trim();
  if (!id) return { error: "Pick an association." };
  if (!DATE.test(ends)) return { error: "Pick the day free early access ends." };
  const { error } = await supabase.rpc("billing_end_early_access", { p_association_id: id, p_ends_on: ends });
  if (error) return { error: error.message };
  return done();
}

/** Schedules a price change for every building: a notice each, at least 30 days ahead. */
export async function schedulePriceChange(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can schedule a price change." };
  const effective = String(formData.get("effective_on") ?? "").trim();
  const detail = String(formData.get("detail") ?? "").trim();
  if (!DATE.test(effective)) return { error: "Pick the day the new price starts." };
  if (!detail) return { error: "Say what is changing." };
  if (detail.length > 600) return { error: "Keep it under 600 characters." };
  const { error } = await supabase.rpc("billing_schedule_price_change", { p_effective_on: effective, p_detail: detail });
  if (error) return { error: error.message };
  return done();
}

/** Marks a refund request (or a taken offer) done or dismissed once it has been handled by hand in Stripe. */
export async function resolveRefund(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can handle a refund request." };
  const id = String(formData.get("request_id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!UUID.test(id)) return { error: "Pick a request." };
  if (status !== "done" && status !== "dismissed") return { error: "Mark it done or dismissed." };
  const { error } = await supabase.rpc("billing_resolve_refund", { p_id: id, p_status: status });
  if (error) return { error: error.message };
  return done();
}

/** For a missed webhook: fetch the subscription from Stripe and apply it as the platform admin. */
export async function refreshFromStripe(_prev: AdminBillingState | null, formData: FormData): Promise<AdminBillingState> {
  const supabase = await platformAdmin();
  if (!supabase) return { error: "Only a platform admin can refresh from Stripe." };
  const problem = stripeConfigProblem();
  if (problem) return { error: problem };
  const id = associationId(formData);
  const subscriptionId = String(formData.get("subscription_id") ?? "");
  if (!id || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) return { error: "This building has no Stripe subscription." };

  let sub;
  try {
    sub = await retrieveSubscription(subscriptionId);
  } catch (cause) {
    return { error: `Stripe answered: ${(cause as Error).message}` };
  }
  const { error } = await supabase.rpc("billing_apply_subscription", {
    p_subscription_id: sub.id,
    p_customer_id: sub.customerId,
    p_association_id: id,
    p_status: sub.status,
    p_plan_key: sub.planKey,
    p_price_id: sub.priceId,
    p_interval: sub.interval,
    p_current_period_end: sub.currentPeriodEnd,
    p_cancel_at_period_end: sub.cancelAtPeriodEnd,
    p_event_created: new Date().toISOString(),
  });
  if (error) return { error: error.message };
  return done();
}
