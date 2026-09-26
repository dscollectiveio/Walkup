import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { syncOneConnection } from "@/lib/plaid/sync";

export const dynamic = "force-dynamic";

/**
 * Daily unattended bank sync — Vercel Cron hits this once a day (see
 * vercel.json), and there is deliberately no signed-in board member for it
 * to act as. Every other Plaid code path in this app runs as the actual
 * user, RLS-gated, per DECISIONS #18 ("no service-role client anywhere") —
 * this route is the one narrow, explicit exception to that, scoped to
 * exactly this file. It never handles a browser request and is not part of
 * the normal request flow; nothing else in the app should import or reuse
 * this service-role client.
 *
 * Auth is a shared secret, not a user session: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically when that env var is
 * set (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Without a matching CRON_SECRET, this route refuses to run rather than
 * silently allowing anyone who finds the URL to trigger it.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 },
    );
  }
  const supabase = createServiceClient(supabaseUrl, serviceRoleKey);

  const { data: connections, error: connectionsError } = await supabase
    .from("bank_connections")
    .select("id, association_id, sync_cursor")
    .eq("status", "active");

  if (connectionsError) {
    return NextResponse.json({ error: connectionsError.message }, { status: 500 });
  }

  const results = [];
  for (const connection of connections ?? []) {
    const { data: secretRow, error: secretError } = await supabase
      .from("bank_connection_secrets")
      .select("plaid_access_token")
      .eq("bank_connection_id", connection.id)
      .limit(1)
      .maybeSingle();

    if (secretError || !secretRow) {
      results.push({
        connectionId: connection.id,
        error: secretError?.message ?? "No stored access token.",
      });
      continue;
    }

    // autoPost: false, always. This runs with no human behind it; it may
    // fetch and pre-categorize, but writing to the ledger waits for a board
    // member's own sync or "post all ready" click — DECISIONS #29.
    const result = await syncOneConnection(supabase, connection, secretRow.plaid_access_token, {
      autoPost: false,
    });
    results.push({
      connectionId: connection.id,
      ...("error" in result
        ? { error: result.error }
        : { count: result.count, categorized: result.categorized }),
    });
  }

  // Automated deprovisioning (0037, DECISIONS #30): revoke owner access once
  // a sale/transfer has closed and record expired accountant grants. Runs
  // here because this is the one scheduled, service-role path — it touches
  // role_grants only, never the ledger.
  const { data: deprovisioned, error: deprovisionError } = await supabase.rpc(
    "deprovision_stale_access",
    { p_association_id: null },
  );

  return NextResponse.json({
    synced: results.length,
    results,
    deprovisioned: deprovisionError ? { error: deprovisionError.message } : deprovisioned,
  });
}
