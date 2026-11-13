"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * "Confirm Stripe payout" (DECISIONS #57, plan Phase 5): the one click that
 * puts online dues into the books. post_stripe_payout() checks the books duty,
 * that the deposit equals the payout to the cent, and that the payout is only
 * dues less Stripe's fees, then posts it all in one entry.
 */
export async function confirmStripePayout(bankTransactionId: string, payoutId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_stripe_payout", {
    p_bank_transaction_id: bankTransactionId,
    p_payout_id: payoutId,
  });
  if (error) {
    const m = error.message;
    if (/not authorized/.test(m)) return { error: "Only the board or the Treasurer can post to the books." };
    if (/already in the books/.test(m)) return { error: "This deposit is already in the books." };
    if (/doesn't match|isn't the dues collected|fee on every payment|no settled dues payments|finished paying/.test(m)) {
      return { error: `${m.charAt(0).toUpperCase()}${m.slice(1)}.` };
    }
    return { error: "We couldn't post this payout. Try again." };
  }
  revalidatePath("/bank-feed");
  revalidatePath("/dues");
  revalidatePath("/");
  return { ok: true };
}
