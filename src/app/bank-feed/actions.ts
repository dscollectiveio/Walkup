"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { plaidClient } from "@/lib/plaid";
import { CountryCode, Products } from "plaid";

async function currentAssociationId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("associations").select("id").limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Creates a Plaid Link token so the client can open the Link widget. The
 * widget itself never sees PLAID_SECRET — only this short-lived token.
 */
export async function createLinkToken(): Promise<{ linkToken?: string; error?: string }> {
  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };

  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: associationId },
      client_name: "Walkup",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      // Needed only for OAuth institutions (most large US banks in
      // production). Omitted, not defaulted, when unset — unlike PLAID_ENV,
      // a missing redirect_uri only breaks the OAuth handoff specifically;
      // everything else (local dev, non-OAuth institutions) keeps working.
      // Never derived from VERCEL_URL or a request header: Plaid requires
      // exact pre-registration, and a per-deployment preview URL changes
      // every push, so it could never be registered. See DECISIONS #27.
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
        : {}),
    });
    return { linkToken: response.data.link_token };
  } catch (cause) {
    return { error: describePlaidError(cause) };
  }
}

/**
 * Exchanges Link's public token for a real access token and stores it via
 * store_bank_connection() — the token passes through this function's memory
 * and nowhere else; it is never returned to the client.
 */
export async function connectBank(
  publicToken: string,
  institutionName: string,
): Promise<{ ok?: true; error?: string }> {
  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };

  let accessToken: string;
  let itemId: string;
  try {
    const response = await plaidClient().itemPublicTokenExchange({
      public_token: publicToken,
    });
    accessToken = response.data.access_token;
    itemId = response.data.item_id;
  } catch (cause) {
    return { error: describePlaidError(cause) };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("store_bank_connection", {
    p_association_id: associationId,
    p_institution_name: institutionName,
    p_plaid_item_id: itemId,
    p_access_token: accessToken,
  });

  if (error) return { error: error.message };

  revalidatePath("/bank-feed");
  return { ok: true };
}

/**
 * Disconnects a bank connection — but tells Plaid first.
 *
 * The old version only called revoke_bank_connection(), which deletes the
 * local access token. In sandbox that's invisible; against a real bank it
 * would mean the token needed to remove the Item is destroyed before Plaid
 * ever hears about it, leaving a live, billable credential against a real
 * account with no way left to retire it — itemRemove() takes an access
 * token, and this would have just deleted the only copy.
 *
 * So: fetch the token, tell Plaid, THEN revoke locally. revoke_bank_connection
 * always runs, whether or not Plaid could be reached — a live token sitting
 * in Walkup's own database after someone asked to disconnect is worse than
 * an Item that's merely still live at Plaid, because plaid_item_id survives
 * in bank_connections forever (rows are never hard-deleted) and can be
 * removed by hand in the Plaid dashboard if this call ever fails. See
 * DECISIONS #27.
 */
export async function disconnectBank(
  connectionId: string,
): Promise<{ ok?: true; warning?: string; error?: string }> {
  const supabase = await createClient();

  const { data: accessToken, error: tokenError } = await supabase.rpc(
    "get_bank_access_token",
    { p_connection_id: connectionId },
  );

  let warning: string | undefined;

  // No stored token means it was already revoked (or never connected) —
  // nothing to tell Plaid, so this is a no-op re-click, not a failure.
  const alreadyRevoked = tokenError?.message?.includes("no stored access token");

  if (tokenError && !alreadyRevoked) {
    return { error: tokenError.message };
  }

  if (accessToken && !alreadyRevoked) {
    try {
      await plaidClient().itemRemove({ access_token: accessToken });
      await supabase
        .from("bank_connections")
        .update({ plaid_item_removed_at: new Date().toISOString() })
        .eq("id", connectionId);
    } catch (cause) {
      if (isItemAlreadyGone(cause)) {
        await supabase
          .from("bank_connections")
          .update({ plaid_item_removed_at: new Date().toISOString() })
          .eq("id", connectionId);
      } else {
        // Disconnect proceeds anyway — see the function comment. Surfaced as
        // a warning, not blocked: the board admin still gets what they
        // asked for locally, with an honest note that Plaid-side cleanup is
        // still outstanding.
        warning =
          "Disconnected here, but couldn't confirm with the bank that the connection was closed on their end. " +
          describePlaidError(cause);
      }
    }
  }

  const { error } = await supabase.rpc("revoke_bank_connection", {
    p_connection_id: connectionId,
  });

  if (error) return { error: error.message };

  revalidatePath("/bank-feed");
  return { ok: true, warning };
}

/** Plaid returns a specific code when the Item/token is already gone — that
 * counts as success, not a failure to report. */
function isItemAlreadyGone(cause: unknown): boolean {
  const code = (cause as { response?: { data?: { error_code?: string } } })?.response?.data
    ?.error_code;
  return code === "ITEM_NOT_FOUND" || code === "INVALID_ACCESS_TOKEN";
}

/**
 * Pulls new activity for one connection via Plaid's cursor-based sync and
 * writes it into bank_transactions. Manually triggered by a "Sync now"
 * button rather than a background job or webhook — this is a v1 read-only
 * feed, not infrastructure worth running unattended yet.
 */
export async function syncBankTransactions(
  connectionId: string,
): Promise<{ ok?: true; count?: number; error?: string }> {
  const supabase = await createClient();

  const { data: connectionRows, error: connectionError } = await supabase
    .from("bank_connections")
    .select("id, association_id, sync_cursor")
    .eq("id", connectionId)
    .limit(1);

  if (connectionError) return { error: connectionError.message };
  const connection = connectionRows?.[0];
  if (!connection) return { error: "Bank connection not found." };

  const { data: accessToken, error: tokenError } = await supabase.rpc(
    "get_bank_access_token",
    { p_connection_id: connectionId },
  );
  if (tokenError) return { error: tokenError.message };

  const client = plaidClient();
  let cursor = connection.sync_cursor ?? undefined;
  const added: { transaction_id: string; date: string; amount: number; name: string; pending: boolean; category?: string[] | null }[] = [];
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
        bank_connection_id: connectionId,
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
    .eq("id", connectionId);

  revalidatePath("/bank-feed");
  return { ok: true, count: added.length };
}

/** Plaid's own error shape carries a plain-English display_message. Falls
 * back to something a board member can still act on when it doesn't. */
function describePlaidError(cause: unknown): string {
  const plaidMessage = (
    cause as { response?: { data?: { error_message?: string; display_message?: string } } }
  )?.response?.data;
  return (
    plaidMessage?.display_message ??
    plaidMessage?.error_message ??
    "Couldn't reach the bank. Try again in a moment."
  );
}
