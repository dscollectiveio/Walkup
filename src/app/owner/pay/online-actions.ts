"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { SITE_URL } from "@/lib/site-config";
import { stripeIsLive } from "@/lib/billing/config";
import { connectConfigProblem } from "@/lib/payments/connect";
import { createDuesCheckout } from "@/lib/payments/checkout";
import { reconcileOpenCheckouts } from "@/lib/payments/reconcile";

/**
 * The owner's Pay button (DECISIONS #57, plan Phase 3). The amount is the
 * unit's full open balance, worked out by the database; the browser sends
 * only which unit. Stripe's hosted page collects the bank link.
 */

export interface PayOnlineState {
  error?: string;
}

async function origin(): Promise<string> {
  if (process.env.VERCEL_ENV === "production") return SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return SITE_URL;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

const FRIENDLY: [RegExp, string][] = [
  [/already in progress/, "A payment for this unit is already in progress. It shows below once Stripe confirms it."],
  [/nothing is owed/, "Nothing is owed on this unit right now."],
  [/aren't turned on/, "Online payments aren't turned on for your building right now."],
  [/unit you own/, "You can only pay for a unit you own."],
];

export async function payDuesOnline(unitId: string): Promise<PayOnlineState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (connectConfigProblem()) return { error: "Online payments aren't available right now." };
  const supabase = await createClient();

  // First settle any Checkout this owner left open, so a finished payment is never paid twice.
  const settled = await reconcileOpenCheckouts(supabase, viewer.associationId);
  if (!settled.ok) return { error: "We couldn't reach Stripe to check an earlier payment. Try again in a minute." };

  const { data, error } = await supabase.rpc("start_online_dues_payment", {
    p_association_id: viewer.associationId,
    p_unit_id: unitId,
  });
  if (error) {
    const hit = FRIENDLY.find(([re]) => re.test(error.message));
    return { error: hit ? hit[1] : "We couldn't start the payment. Try again." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { payment_id: string; amount: string | number; stripe_account_id: string; livemode: boolean }
    | undefined;
  if (!row) return { error: "We couldn't start the payment. Try again." };

  const cancel = () => supabase.rpc("cancel_online_dues_payment", { p_payment_id: row.payment_id });
  if (row.livemode !== stripeIsLive()) {
    await cancel();
    return { error: "Online payments aren't available right now." };
  }

  const unit = viewer.ownedUnitIds.includes(unitId)
    ? ((await supabase.from("units").select("label").eq("id", unitId).maybeSingle()).data?.label ?? "your unit")
    : "your unit";
  const base = await origin();
  const back = (r: "done" | "cancel") =>
    `${base}/api/stripe/connect/checkout-return?p=${encodeURIComponent(row.payment_id)}&r=${r}`;

  let url: string;
  try {
    const session = await createDuesCheckout({
      paymentId: row.payment_id,
      associationId: viewer.associationId,
      unitId,
      unitLabel: unit,
      associationName: viewer.associationName,
      amountCents: Math.round(Number(row.amount) * 100),
      stripeAccountId: row.stripe_account_id,
      successUrl: back("done"),
      cancelUrl: back("cancel"),
    });
    const { error: attachError } = await supabase.rpc("attach_online_dues_checkout", {
      p_payment_id: row.payment_id,
      p_checkout_session_id: session.id,
    });
    if (attachError) {
      await cancel();
      return { error: "We couldn't start the payment. Try again." };
    }
    url = session.url;
  } catch {
    await cancel();
    return { error: "We couldn't reach Stripe. Nothing was charged. Try again in a minute." };
  }
  redirect(url);
}
