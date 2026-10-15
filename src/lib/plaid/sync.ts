import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  plaidClient,
  plaidErrorLog,
  describePlaidError,
  isLoginRequired,
  isSyncMutationDuringPagination,
  deadConnectionReason,
} from "@/lib/plaid";
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
  /** True when the page cap stopped the run; the cursor is saved and the next run resumes. */
  more?: boolean;
}

export type SyncFailure = {
  error: string;
  needsReconnect?: boolean;
  /** The Item or its token is gone for good; reconnecting in update mode cannot help. */
  deadConnection?: boolean;
};

/** Pages of /transactions/sync fetched per run. A resumed run continues from the saved cursor. */
export const MAX_PAGES_PER_RUN = 20;
/** Plaid's documented recovery for a mutation mid-pagination is to start the pagination again. */
export const MAX_PAGINATION_RESTARTS = 3;

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
  options: { autoPost: boolean; maxPages?: number },
): Promise<SyncResult | SyncFailure> {
  const client = plaidClient();
  const maxPages = options.maxPages ?? MAX_PAGES_PER_RUN;
  // The cursor this run began with: the restart point if Plaid reports the
  // data changed while we were paging through it.
  const startCursor = connection.sync_cursor ?? undefined;
  let cursor = startCursor;
  const seen = new Set<string>();
  let categorized = 0;
  let posted = 0;
  const postErrors: string[] = [];
  let pages = 0;
  let restarts = 0;
  let more = false;

  for (;;) {
    let page;
    try {
      page = await client.transactionsSync({ access_token: accessToken, cursor });
    } catch (cause) {
      if (isSyncMutationDuringPagination(cause) && restarts < MAX_PAGINATION_RESTARTS) {
        // Batches already committed are idempotent (upserts keyed on the Plaid
        // id, retraction only sets removed_at), so replaying from the start is safe.
        restarts += 1;
        cursor = startCursor;
        pages = 0;
        continue;
      }
      if (isLoginRequired(cause)) {
        // The bank wants a person to sign in again. status 'error' is what
        // the Home tile already reads as "needs reconnecting"; the cron only
        // syncs 'active' rows, so it stops hammering a dead login. A
        // successful sync (below) flips it back.
        await markError(supabase, connection.id);
        return { error: describePlaidError(cause), needsReconnect: true };
      }
      const dead = deadConnectionReason(cause);
      if (dead) {
        // The token or Item is gone at Plaid. Retrying daily cannot fix it and
        // update mode needs a live token, so stop the cron ('error') and say
        // what to do. The distinct code goes to the log, never the token.
        console.error("Plaid connection is dead", plaidErrorLog(cause));
        await markError(supabase, connection.id);
        return { error: dead.message, deadConnection: true };
      }
      console.error("Plaid transactionsSync failed", plaidErrorLog(cause));
      return { error: describePlaidError(cause) };
    }

    const data = page.data;
    const batch = await applyBatch(
      supabase,
      connection,
      [...data.added, ...data.modified],
      data.removed.map((r) => r.transaction_id),
      options,
    );
    if ("error" in batch) return { error: batch.error };
    for (const t of [...data.added, ...data.modified]) seen.add(t.transaction_id);
    categorized += batch.categorized;
    posted += batch.posted;
    postErrors.push(...batch.postErrors);

    // The batch is committed, so remember where it ended: if a later page or a
    // timeout kills this run, the next one resumes here instead of from the start.
    cursor = data.next_cursor;
    const { error: cursorError } = await supabase
      .from("bank_connections")
      .update({ sync_cursor: cursor })
      .eq("id", connection.id)
      .neq("status", "disconnected");
    if (cursorError) return { error: cursorError.message };

    pages += 1;
    if (!data.has_more) break;
    if (pages >= maxPages) {
      more = true;
      break;
    }
  }

  // A sync that got this far means the login works: clear a stale 'error'.
  await supabase
    .from("bank_connections")
    .update({ last_synced_at: new Date().toISOString(), status: "active" })
    .eq("id", connection.id)
    .neq("status", "disconnected");

  return { count: seen.size, categorized, posted, postErrors, ...(more ? { more } : {}) };
}

async function markError(supabase: SupabaseClient, connectionId: string) {
  await supabase
    .from("bank_connections")
    .update({ status: "error" })
    .eq("id", connectionId)
    .neq("status", "disconnected");
}

/** One page of Plaid's changes, written and categorized. Safe to run twice on the same page. */
async function applyBatch(
  supabase: SupabaseClient,
  connection: { id: string; association_id: string },
  incoming: IncomingTransaction[],
  removed: string[],
  options: { autoPost: boolean },
): Promise<{ categorized: number; posted: number; postErrors: string[] } | { error: string }> {
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
          // Which rule pre-filled it, so the page can say "from your rule".
          rule_id: rule.id,
        })
        .eq("id", row.id);
      if (error) continue;
      categorized += 1;
      if (rule.auto_post && !row.pending) readyToAutoPost.push(row.id);
    }

    // One round trip; post_bank_transactions() loops the per-row RPC with
    // its own checks (0046), so nothing is bypassed.
    if (options.autoPost && readyToAutoPost.length > 0) {
      const { data, error } = await supabase.rpc("post_bank_transactions", { p_ids: readyToAutoPost });
      if (error) postErrors.push(error.message);
      for (const r of (data ?? []) as { ok: boolean; error: string | null }[]) {
        if (r.ok) posted += 1;
        else postErrors.push(r.error ?? "Couldn't be posted.");
      }
    }
  }

  return { categorized, posted, postErrors };
}
