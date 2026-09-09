import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidClient, describePlaidError } from "@/lib/plaid";

/**
 * The actual Plaid-calling half of a sync — shared between the "Sync now"
 * button (bank-feed/actions.ts, running as the signed-in board member) and
 * the daily cron job (api/cron/sync-bank-feeds, running with a service-role
 * client since nobody's signed in at noon). Both already have a resolved
 * access token by the time they call this; how that token gets resolved
 * differs (an RLS-gated RPC for a real user, a direct table read for the
 * cron job) and stays outside this function.
 */
export async function syncOneConnection(
  supabase: SupabaseClient,
  connection: { id: string; association_id: string; sync_cursor: string | null },
  accessToken: string,
): Promise<{ count: number } | { error: string }> {
  const client = plaidClient();
  let cursor = connection.sync_cursor ?? undefined;
  const added: {
    transaction_id: string;
    date: string;
    amount: number;
    name: string;
    pending: boolean;
    category?: string[] | null;
  }[] = [];
  const removed: string[] = [];
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      added.push(...response.data.added, ...response.data.modified);
      removed.push(...response.data.removed.map((r) => r.transaction_id));
      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }
  } catch (cause) {
    return { error: describePlaidError(cause) };
  }

  if (removed.length > 0) {
    await supabase.from("bank_transactions").delete().in("plaid_transaction_id", removed);
  }

  if (added.length > 0) {
    const { error: upsertError } = await supabase.from("bank_transactions").upsert(
      added.map((t) => ({
        association_id: connection.association_id,
        bank_connection_id: connection.id,
        plaid_transaction_id: t.transaction_id,
        posted_on: t.date,
        // Inverted from Plaid's convention — see the migration 0016 comment.
        // Plaid: positive = money out. Walkup: positive = money in.
        amount: -1 * t.amount,
        description: t.name,
        pending: t.pending,
        raw_category: t.category?.[0] ?? null,
      })),
      { onConflict: "plaid_transaction_id" },
    );
    if (upsertError) return { error: upsertError.message };
  }

  await supabase
    .from("bank_connections")
    .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() })
    .eq("id", connection.id);

  return { count: added.length };
}
