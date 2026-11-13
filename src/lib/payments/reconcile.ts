import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expireDuesCheckout, retrieveDuesCheckout, statusFromCheckout } from "@/lib/payments/checkout";
import { paymentsServiceRpc } from "@/lib/payments/service-rpc";

/**
 * Asks Stripe how the caller's open Checkout pages ended and records it, so a
 * payment the owner finished is never mistaken for an abandoned one (which
 * would let them pay twice). Runs on the return from Stripe and before a new
 * Pay press; the Connect webhook (Phase 4) does the same from Stripe's side.
 *
 * `cancel` names a payment the owner walked away from: its Checkout is closed
 * at Stripe first, so it can't be paid later in another tab.
 */
export async function reconcileOpenCheckouts(
  supabase: SupabaseClient,
  associationId: string,
  opts: { cancel?: string } = {},
): Promise<{ ok: boolean }> {
  const { data, error } = await supabase.rpc("my_open_online_checkouts", { p_association_id: associationId });
  if (error) return { ok: false };
  const rows = (data ?? []) as { payment_id: string; checkout_session_id: string; stripe_account_id: string }[];

  let ok = true;
  for (const r of rows) {
    try {
      if (opts.cancel === r.payment_id) {
        try {
          await expireDuesCheckout(r.checkout_session_id, r.stripe_account_id);
          await supabase.rpc("cancel_online_dues_payment", { p_payment_id: r.payment_id });
          continue;
        } catch {
          // Already completed or expired at Stripe: fall through and record what happened.
        }
      }
      const s = await retrieveDuesCheckout(r.checkout_session_id, r.stripe_account_id);
      const next = statusFromCheckout(s);
      if (!next) continue;
      const { error: applyError } = await paymentsServiceRpc("connect_apply_payment", {
        p_stripe_account_id: r.stripe_account_id,
        p_checkout_session_id: r.checkout_session_id,
        p_payment_intent_id: s.paymentIntentId,
        p_status: next,
      });
      if (applyError) ok = false;
    } catch {
      ok = false;
    }
  }
  return { ok };
}
