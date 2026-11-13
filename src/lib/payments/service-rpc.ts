import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The only place the service key is read for online dues payments
 * (DECISIONS #57, migration 0097), a sibling of the billing and email
 * service-rpc modules with its own list. It can call the named connect_*
 * functions and nothing else: no table can be read or written from here, and
 * none of them writes the ledger.
 */
export const PAYMENTS_SERVICE_RPC_ALLOWED = [
  "connect_apply_account",
  "connect_account_deauthorized",
  "connect_apply_payment",
  // The Connect webhook (Phase 4).
  "connect_claim_event",
  "connect_finish_event",
  "connect_apply_payout",
] as const;

export type PaymentsServiceRpcName = (typeof PAYMENTS_SERVICE_RPC_ALLOWED)[number];

export async function paymentsServiceRpc<T = unknown>(
  name: PaymentsServiceRpcName,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { code?: string; message: string } | null }> {
  if (!(PAYMENTS_SERVICE_RPC_ALLOWED as readonly string[]).includes(name)) {
    throw new Error(`paymentsServiceRpc: ${String(name)} is not an allowed function`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { data: null, error: { message: "The service key is not configured." } };

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc(name, args);
  if (error) return { data: null, error: { code: error.code, message: error.message } };
  return { data: data as T, error: null };
}
