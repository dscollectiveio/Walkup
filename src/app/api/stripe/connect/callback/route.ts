import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { StripeError } from "@/lib/billing/stripe";
import { exchangeConnectCode, fetchConnectAccountStatus, verifyConnectState } from "@/lib/payments/connect";
import { paymentsServiceRpc } from "@/lib/payments/service-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where Stripe sends the board admin back after connecting the association's
 * Stripe account (DECISIONS #57). Trusts nothing in the URL until the signed
 * state checks out and names the person who is signed in now. Then it trades
 * the code for the account id, saves it in that person's own session (the
 * database checks they are a board admin with MFA), and reads whether Stripe
 * is ready to take payments. Stores no token.
 */

type Outcome = "connected" | "canceled" | "expired" | "taken" | "mode" | "error";

function back(request: NextRequest, outcome: Outcome): NextResponse {
  const url = new URL("/dues", request.nextUrl.origin);
  url.searchParams.set("online", outcome);
  url.hash = "online-payments";
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;

  // The board admin pressed "back" or declined on Stripe's page.
  if (q.get("error")) return back(request, "canceled");

  const state = verifyConnectState(q.get("state"));
  const code = q.get("code");
  if (!state || !code) return back(request, "expired");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) return back(request, "expired");

  let account: { stripeAccountId: string; livemode: boolean };
  try {
    account = await exchangeConnectCode(code);
  } catch (e) {
    return back(request, e instanceof StripeError && e.code === "mode_mismatch" ? "mode" : "error");
  }

  const { error } = await supabase.rpc("connect_payment_account", {
    p_association_id: state.associationId,
    p_stripe_account_id: account.stripeAccountId,
    p_livemode: account.livemode,
  });
  if (error) return back(request, /another association/.test(error.message) ? "taken" : "error");

  // Best effort: the account.updated webhook would set this too.
  try {
    const s = await fetchConnectAccountStatus(account.stripeAccountId);
    await paymentsServiceRpc("connect_apply_account", {
      p_stripe_account_id: account.stripeAccountId,
      p_charges_enabled: s.chargesEnabled,
      p_payouts_enabled: s.payoutsEnabled,
      p_details_submitted: s.detailsSubmitted,
    });
  } catch {
    // Connected; the panel shows "Stripe needs a few details" with a Check again button.
  }

  return back(request, "connected");
}
