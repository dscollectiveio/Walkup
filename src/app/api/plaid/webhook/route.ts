import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { plaidClient, plaidErrorLog } from "@/lib/plaid";
import { cachedKeyFetcher, verifyPlaidWebhook, type PlaidJwk } from "@/lib/plaid/webhook-verify";
import { itemToFlag } from "@/lib/plaid/webhook-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Plaid webhook receiver. Public by necessity (Plaid has no session), so it
 * trusts nothing until the `Plaid-Verification` signature checks out against
 * the exact raw body. Then it acts on a four-event allow-list only: it flags
 * a bank connection as needing attention (status 'error', which the app
 * already shows as "Reconnect") by calling one SECURITY DEFINER function,
 * flag_bank_item_for_attention (0058). It never reads or writes an access
 * token or the ledger.
 *
 * This is the SECOND narrow use of the service-role client, after the daily
 * sync cron (DECISIONS #28). The client is created here, only to call that
 * one RPC, and is not exported. Nothing else should import or copy it.
 *
 * Responses: 401 for anything that fails verification (Plaid does not retry
 * most 4xx, right for forgeries), 503/500 for our own transient failures so
 * Plaid retries, 200 for every verified delivery including no-ops and repeats.
 */
const fetchKey = cachedKeyFetcher(async (kid): Promise<PlaidJwk | null> => {
  try {
    const res = await plaidClient().webhookVerificationKeyGet({ key_id: kid });
    return res.data.key as unknown as PlaidJwk;
  } catch (cause) {
    const status = (cause as { response?: { status?: number } } | null)?.response?.status;
    if (status !== undefined && status >= 400 && status < 500) return null; // Plaid does not know this key id
    throw cause;
  }
});

export async function POST(request: NextRequest) {
  // Exact bytes: the signature covers them, so never re-serialise.
  const rawBody = await request.text();

  let result;
  try {
    result = await verifyPlaidWebhook({
      rawBody,
      verificationHeader: request.headers.get("plaid-verification"),
      fetchKey,
    });
  } catch (cause) {
    console.error("Plaid webhook verification errored", plaidErrorLog(cause));
    return NextResponse.json({ error: "Verification unavailable." }, { status: 503 });
  }
  if (!result.ok) {
    if (result.reason === "key_fetch_failed") {
      console.error("Plaid webhook key fetch failed");
      return NextResponse.json({ error: "Verification unavailable." }, { status: 503 });
    }
    console.warn("Plaid webhook rejected", { reason: result.reason });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, ignored: true });
  }
  const p = payload as { webhook_type?: unknown; webhook_code?: unknown; item_id?: unknown };
  const itemId = itemToFlag(payload);
  // Log type, code and item id only. No body dump.
  console.info("Plaid webhook", {
    type: typeof p.webhook_type === "string" ? p.webhook_type : undefined,
    code: typeof p.webhook_code === "string" ? p.webhook_code : undefined,
    item_id: typeof p.item_id === "string" ? p.item_id.slice(0, 128) : undefined,
    acted: itemId !== null,
  });
  if (!itemId) return NextResponse.json({ ok: true, ignored: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Plaid webhook: Supabase service configuration is missing.");
    return NextResponse.json({ error: "Not configured." }, { status: 500 });
  }
  const supabase = createServiceClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.rpc("flag_bank_item_for_attention", { p_item_id: itemId });
  if (error) {
    console.error("Plaid webhook: flag failed", { code: error.code });
    return NextResponse.json({ error: "Could not record." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
