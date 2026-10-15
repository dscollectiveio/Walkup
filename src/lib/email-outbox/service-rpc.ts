import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The only place the service key is read for email (DECISIONS #36, money spec
 * 4.4). It can call six named functions and nothing else: there is no way to
 * read or write a table from here. Imported by exactly two routes, the
 * reminder cron and the Resend webhook; a unit test fails on any other import.
 */
export const SERVICE_RPC_ALLOWED = [
  "email_run_rules",
  "email_claim",
  "email_mark_sent",
  "email_mark_failed",
  "email_record_event",
  "email_purge",
] as const;

export type ServiceRpcName = (typeof SERVICE_RPC_ALLOWED)[number];

export interface ServiceRpcResult<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

export async function serviceRpc<T = unknown>(name: ServiceRpcName, args: Record<string, unknown>): Promise<ServiceRpcResult<T>> {
  if (!(SERVICE_RPC_ALLOWED as readonly string[]).includes(name)) {
    throw new Error(`serviceRpc: ${String(name)} is not an allowed function`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { data: null, error: { message: "The service key is not configured." } };

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc(name, args);
  if (error) return { data: null, error: { code: error.code, message: error.message } };
  return { data: data as T, error: null };
}
