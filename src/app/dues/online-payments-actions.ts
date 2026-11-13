"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { SITE_URL } from "@/lib/site-config";
import {
  connectAuthorizeUrl,
  connectConfigProblem,
  deauthorizeConnectAccount,
  fetchConnectAccountStatus,
  signConnectState,
} from "@/lib/payments/connect";
import { paymentsServiceRpc } from "@/lib/payments/service-rpc";

/**
 * Board admin setup for online dues payments (DECISIONS #57, plan Phase 2).
 * Setting up sends the board admin to Stripe's own page; Walkup never sees
 * the association's bank details or the board member's identity documents.
 */

export interface OnlinePaymentsState {
  error?: string;
  ok?: string;
}

async function origin(): Promise<string> {
  if (process.env.VERCEL_ENV === "production") return SITE_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return SITE_URL;
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

async function connectCallbackUrl(): Promise<string> {
  return `${await origin()}/api/stripe/connect/callback`;
}

async function boardAdmin() {
  const viewer = await getViewer();
  if (!viewer?.isBoardAdmin) return { error: "Only a board admin can set up online payments." } as const;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." } as const;
  return { viewer, supabase, user } as const;
}

export async function startOnlinePaymentsSetup(): Promise<OnlinePaymentsState> {
  const who = await boardAdmin();
  if ("error" in who) return { error: who.error };
  const problem = connectConfigProblem();
  if (problem) return { error: problem };

  const state = signConnectState({ associationId: who.viewer.associationId, userId: who.user.id });
  redirect(connectAuthorizeUrl({ state, redirectUri: await connectCallbackUrl() }));
}

/** "Check again": reads the account from Stripe, for when the board admin just finished Stripe's questions. */
export async function refreshOnlinePaymentsStatus(): Promise<OnlinePaymentsState> {
  const who = await boardAdmin();
  if ("error" in who) return { error: who.error };
  const problem = connectConfigProblem();
  if (problem) return { error: problem };

  const { data: acct } = await who.supabase
    .from("association_payment_accounts")
    .select("stripe_account_id")
    .eq("association_id", who.viewer.associationId)
    .is("disconnected_at", null)
    .maybeSingle();
  if (!acct) return { error: "Online payments aren't set up." };

  try {
    const s = await fetchConnectAccountStatus(acct.stripe_account_id);
    const { error } = await paymentsServiceRpc("connect_apply_account", {
      p_stripe_account_id: acct.stripe_account_id,
      p_charges_enabled: s.chargesEnabled,
      p_payouts_enabled: s.payoutsEnabled,
      p_details_submitted: s.detailsSubmitted,
    });
    if (error) return { error: "We couldn't save Stripe's answer. Try again in a minute." };
    revalidatePath("/dues");
    return s.chargesEnabled && s.payoutsEnabled
      ? { ok: "Stripe is ready. Owners can pay online." }
      : { ok: "Stripe still needs a few details." };
  } catch {
    return { error: "We couldn't reach Stripe. Try again in a minute." };
  }
}

/** Hides the Pay button and disconnects Walkup at Stripe. Payments already started still finish. */
export async function turnOffOnlinePayments(): Promise<OnlinePaymentsState> {
  const who = await boardAdmin();
  if ("error" in who) return { error: who.error };

  const { data: acct, error } = await who.supabase.rpc("disconnect_payment_account", {
    p_association_id: who.viewer.associationId,
  });
  if (error) return { error: "We couldn't turn off online payments. Try again." };
  revalidatePath("/dues");

  if (typeof acct === "string" && acct && !connectConfigProblem()) {
    try {
      await deauthorizeConnectAccount(acct);
    } catch {
      return {
        ok: "Online payments are off in Walkup. Stripe didn't confirm the disconnect, so you may also want to remove Walkup in your Stripe dashboard.",
      };
    }
  }
  return { ok: "Online payments are off." };
}
