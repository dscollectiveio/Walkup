import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plaidClient, describePlaidError } from "@/lib/plaid";
import {
  matchRule,
  planSyncWrites,
  walkupAmount,
  type CategorizationRule,
  type IncomingTransaction,
} from "./dedupe";

export interface SyncResult {
  count: number;
  categorized: number;
  posted: number;
  postErrors: string[];
}

/**
 * The actual Plaid-calling half of a sync — shared between the "Sync now"
 * button (bank-feed/actions.ts, running as the signed-in board member) and
 * the daily cron job (api/cron/sync-bank-feeds, running with a service-role
 * client since nobody's signed in at noon). Both already have a resolved
 * access token by the time they call this; how that token gets resolved
 * differs (an RLS-gated RPC for a real user, a direct table read for the
 * cron job) and stays outside this function.
 *
 * Since DECISIONS #29 the feed is how entries reach the ledger, so this
 * function also (a) adopts prior-connection rows by fingerprint instead of
 * inserting duplicates after a reconnect, (b) never hard-deletes — Plaid
 * retractions set removed_at, and (c) pre-fills categorization from the
 * board's rules. Posting is the one thing it does NOT do on its own:
 * `autoPost` is only ever true on the manual path, where a board member is
 * the caller. The cron passes false — an unattended process never writes to
 * the ledger.
 */
export async function syncOneConnection(
  supabase: SupabaseClient,
  connection: { id: string; association_id: string; sync_cursor: string | null },
  accessToken: string,
  options: { autoPost: boolean },
): Promise<SyncResult | { error: string }> {
  const client = plaidClient();
  let cursor = connection.sync_cursor ?? undefined;
  const incoming: IncomingTransaction[] = [];
  const removed: string[] = [];
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        cursor,
      });
      incoming.push(...response.data.added, ...response.data.modified);
      removed.push(...response.data.removed.map((r) => r.transaction_id));
      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }
  } catch (cause) {
    return { error: describePlaidError(cause) };
  }

  if (removed.length > 0) {
    const { error } = await supabase
      .from("bank_transactions")
      .update({ removed_at: new Date().toISOString() })
      .in("plaid_transaction_id", removed)
      .is("removed_at", null);
    if (error) return { error: error.message };
  }

  const touchedIds: string[] = [];

  if (incoming.length > 0) {
    const incomingIds = incoming.map((t) => t.transaction_id);
    const [{ data: existing, error: existingError }, { data: prior, error: priorError }] =
      await Promise.all([
        supabase
          .from("bank_transactions")
          .select("plaid_transaction_id")
          .eq("bank_connection_id", connection.id)
          .in("plaid_transaction_id", incomingIds),
        supabase
          .from("bank_transactions")
          .select("id, posted_on, amount, description")
          .eq("association_id", connection.association_id)
          .neq("bank_connection_id", connection.id)
          .is("removed_at", null),
      ]);
    if (existingError) return { error: existingError.message };
    if (priorError) return { error: priorError.message };

    const plan = planSyncWrites(
      incoming,
      new Set((existing ?? []).map((r) => r.plaid_transaction_id)),
      prior ?? [],
    );

    const rowFor = (t: IncomingTransaction) => ({
      association_id: connection.association_id,
      bank_connection_id: connection.id,
      plaid_transaction_id: t.transaction_id,
      plaid_account_id: t.account_id ?? null,
      pending_transaction_id: t.pending_transaction_id ?? null,
      posted_on: t.date,
      amount: walkupAmount(t.amount),
      description: t.name,
      pending: t.pending,
      raw_category: t.category?.[0] ?? null,
      synced_at: new Date().toISOString(),
    });

    for (const { priorId, incoming: t } of plan.adoptions) {
      const { error } = await supabase
        .from("bank_transactions")
        .update(rowFor(t))
        .eq("id", priorId);
      if (error) return { error: error.message };
      touchedIds.push(t.transaction_id);
    }

    const writes = [...plan.upserts, ...plan.inserts];
    if (writes.length > 0) {
      const { error } = await supabase
        .from("bank_transactions")
        .upsert(writes.map(rowFor), { onConflict: "plaid_transaction_id" });
      if (error) return { error: error.message };
      touchedIds.push(...writes.map((t) => t.transaction_id));
    }
  }

  let categorized = 0;
  let posted = 0;
  const postErrors: string[] = [];

  if (touchedIds.length > 0) {
    const [{ data: rules }, { data: uncategorized }] = await Promise.all([
      supabase
        .from("bank_categorization_rules")
        .select("id, pattern, posting_kind, account_id, matched_unit_id, vendor_id, auto_post")
        .eq("association_id", connection.association_id)
        .order("created_at"),
      supabase
        .from("bank_transactions")
        .select("id, description, pending")
        .in("plaid_transaction_id", touchedIds)
        .is("posting_kind", null)
        .is("removed_at", null),
    ]);

    const readyToAutoPost: string[] = [];
    for (const row of uncategorized ?? []) {
      const rule = matchRule(row.description, (rules ?? []) as CategorizationRule[]);
      if (!rule) continue;
      const { error } = await supabase
        .from("bank_transactions")
        .update({
          posting_kind: rule.posting_kind,
          account_id: rule.account_id,
          matched_unit_id: rule.matched_unit_id,
          vendor_id: rule.vendor_id,
        })
        .eq("id", row.id);
      if (error) continue;
      categorized += 1;
      if (rule.auto_post && !row.pending) readyToAutoPost.push(row.id);
    }

    if (options.autoPost) {
      for (const id of readyToAutoPost) {
        const { error } = await supabase.rpc("post_bank_transaction", { p_transaction_id: id });
        if (error) postErrors.push(error.message);
        else posted += 1;
      }
    }
  }

  await supabase
    .from("bank_connections")
    .update({ sync_cursor: cursor, last_synced_at: new Date().toISOString() })
    .eq("id", connection.id);

  return { count: incoming.length, categorized, posted, postErrors };
}
