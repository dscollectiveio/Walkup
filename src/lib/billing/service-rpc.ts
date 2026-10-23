import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The only place the service key is read for billing (subscriptions plan
 * 2.6), a sibling of src/lib/email-outbox/service-rpc.ts with its own list.
 * It can call fourteen named functions (0062, 0084, 0086, 0088) and nothing else: no table can be
 * read or written from here. Imported only by the Stripe webhook route
 * (src/app/api/stripe/webhook/route.ts) and the daily notices run (src/app/api/cron/billing-notices/route.ts); a unit test fails on any other
 * import.
 */
export const BILLING_SERVICE_RPC_ALLOWED = [
  "billing_claim_event",
  "billing_finish_event",
  "billing_link_checkout",
  "billing_apply_subscription",
  "billing_record_payment",
  // The daily notices run (migration 0084): turns comp end dates and lapses into notices, then emails them.
  "billing_generate_comp_notices",
  "billing_notice_candidates",
  "billing_open_read_only_notice",
  "billing_notice_claim",
  "billing_notice_mark",
  // The same run tells the platform admins about a new signup (migration 0086).
  "platform_signup_alerts_claim",
  "platform_signup_alert_mark",
  // Tier changes at renewal (migration 0088).
  "billing_tier_candidates",
  "billing_open_tier_notice",
] as const;

export type BillingServiceRpcName = (typeof BILLING_SERVICE_RPC_ALLOWED)[number];

export interface BillingServiceRpcResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

export async function billingServiceRpc<T = unknown>(
  name: BillingServiceRpcName,
  args: Record<string, unknown>,
): Promise<BillingServiceRpcResult<T>> {
  if (!(BILLING_SERVICE_RPC_ALLOWED as readonly string[]).includes(name)) {
    throw new Error(`billingServiceRpc: ${String(name)} is not an allowed function`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { data: null, error: { message: "The service key is not configured." } };

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc(name, args);
  if (error) return { data: null, error: { code: error.code, message: error.message } };
  return { data: data as T, error: null };
}
