"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, describePlaidError } from "@/lib/plaid";
import { syncOneConnection } from "@/lib/plaid/sync";
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
      // Ask for as much history as Plaid/the institution will give —
      // 730 days (2 years) is the max Plaid accepts here. Some institutions
      // cap actual history well below that regardless; this only requests
      // the extended window, it doesn't guarantee it.
      transactions: { days_requested: 730 },
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
  const { data: connectionId, error } = await supabase.rpc("store_bank_connection", {
    p_association_id: associationId,
    p_institution_name: institutionName,
    p_plaid_item_id: itemId,
    p_access_token: accessToken,
  });

  if (error) return { error: error.message };

  // Every posting needs a cash leg. Default to Operating Cash / Operating
  // fund so the first sync can post; the board can change it on the page.
  const [{ data: cashAccounts }, { data: funds }] = await Promise.all([
    supabase.from("accounts").select("id").eq("code", "1000").eq("is_cash_account", true).limit(1),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  if (cashAccounts?.[0] && funds?.[0]) {
    await supabase
      .from("bank_connections")
      .update({ cash_account_id: cashAccounts[0].id, fund_id: funds[0].id })
      .eq("id", connectionId);
  }

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

function revalidateLedgerPages() {
  revalidatePath("/bank-feed");
  revalidatePath("/financial-statements");
  revalidatePath("/budget");
  revalidatePath("/dues");
  revalidatePath("/delinquency");
  revalidatePath("/");
}

/**
 * Pulls new activity for one connection via Plaid's cursor-based sync.
 * Because this runs as the signed-in board member, rows matched by an
 * auto-post rule are posted to the ledger here too — the cron never does
 * that (DECISIONS #29).
 */
export async function syncBankTransactions(
  connectionId: string,
): Promise<{ ok?: true; count?: number; posted?: number; warning?: string; error?: string }> {
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

  const result = await syncOneConnection(supabase, connection, accessToken, { autoPost: true });
  if ("error" in result) return { error: result.error };

  revalidateLedgerPages();
  return {
    ok: true,
    count: result.count,
    posted: result.posted,
    warning: result.postErrors.length > 0 ? result.postErrors.join(" · ") : undefined,
  };
}

export type PostingKind = "expense" | "income" | "dues" | "transfer" | "excluded";

const POSTING_KINDS: PostingKind[] = ["expense", "income", "dues", "transfer", "excluded"];

/**
 * Records how a bank transaction should hit the books, optionally remembers
 * that as a rule for future rows with the same description, and optionally
 * posts it right now. The categorization itself is a board_admin UPDATE
 * (bank_transactions_update, 0016); the posting is post_bank_transaction()
 * (0036), which does its own checks and is the only thing that ever sets
 * journal_entry_id.
 */
export async function categorizeBankTransaction(input: {
  transactionId: string;
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
  saveRule: boolean;
  autoPostRule: boolean;
  postNow: boolean;
}): Promise<{ ok?: true; posted?: boolean; error?: string }> {
  if (!POSTING_KINDS.includes(input.kind)) return { error: "Choose how this should be recorded." };
  if (["expense", "income", "transfer"].includes(input.kind) && !input.accountId) {
    return { error: "Choose an account." };
  }
  if (input.kind === "dues" && !input.unitId) return { error: "Choose the unit this is dues for." };

  const supabase = await createClient();

  const categorization = {
    posting_kind: input.kind,
    account_id: ["expense", "income", "transfer"].includes(input.kind) ? input.accountId : null,
    matched_unit_id: input.kind === "dues" ? input.unitId : null,
    vendor_id: input.kind === "expense" ? input.vendorId : null,
  };

  const { data, error } = await supabase
    .from("bank_transactions")
    .update(categorization)
    .eq("id", input.transactionId)
    .is("journal_entry_id", null)
    .select("id, association_id, description");

  if (error) return { error: error.message };
  const row = data?.[0];
  if (!row) return { error: "Only a board admin can categorize a transaction, and it can't already be posted." };

  if (input.saveRule) {
    const pattern = row.description.trim();
    if (pattern.length >= 3) {
      const { error: ruleError } = await supabase.from("bank_categorization_rules").upsert(
        {
          association_id: row.association_id,
          pattern,
          ...categorization,
          auto_post: input.autoPostRule,
        },
        { onConflict: "association_id,pattern" },
      );
      if (ruleError) return { error: `Categorized, but the rule couldn't be saved: ${ruleError.message}` };
    }
  }

  let posted = false;
  if (input.postNow) {
    const { error: postError } = await supabase.rpc("post_bank_transaction", {
      p_transaction_id: input.transactionId,
    });
    if (postError) return { error: `Categorized, but not posted: ${postError.message}` };
    posted = true;
  }

  revalidateLedgerPages();
  return { ok: true, posted };
}

export async function postBankTransaction(
  transactionId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_bank_transaction", { p_transaction_id: transactionId });
  if (error) return { error: error.message };
  revalidateLedgerPages();
  return { ok: true };
}

export async function unpostBankTransaction(
  transactionId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unpost_bank_transaction", { p_transaction_id: transactionId });
  if (error) return { error: error.message };
  revalidateLedgerPages();
  return { ok: true };
}

/** Posts every categorized, settled, un-retracted row that isn't in the books yet. */
export async function postAllReady(): Promise<{
  ok?: true;
  posted?: number;
  errors?: string[];
  error?: string;
}> {
  const supabase = await createClient();
  const { data: ready, error } = await supabase
    .from("bank_transactions")
    .select("id, description")
    .not("posting_kind", "is", null)
    .is("journal_entry_id", null)
    .is("removed_at", null)
    .is("excluded_at", null)
    .eq("pending", false)
    .order("posted_on");
  if (error) return { error: error.message };

  let posted = 0;
  const errors: string[] = [];
  for (const row of ready ?? []) {
    const { error: postError } = await supabase.rpc("post_bank_transaction", {
      p_transaction_id: row.id,
    });
    if (postError) errors.push(`${row.description}: ${postError.message}`);
    else posted += 1;
  }

  revalidateLedgerPages();
  return { ok: true, posted, errors };
}

export async function setConnectionLedgerAccount(
  connectionId: string,
  cashAccountId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();

  const { data: account } = await supabase
    .from("accounts")
    .select("id, name, is_cash_account")
    .eq("id", cashAccountId)
    .limit(1);
  if (!account?.[0]?.is_cash_account) return { error: "Choose a cash account." };

  // Reserve Cash belongs to the Reserve fund; anything else is Operating.
  const kind = /reserve/i.test(account[0].name) ? "reserve" : "operating";
  const { data: funds } = await supabase.from("funds").select("id").eq("kind", kind).limit(1);
  if (!funds?.[0]) return { error: `No ${kind} fund is set up.` };

  const { data, error } = await supabase
    .from("bank_connections")
    .update({ cash_account_id: cashAccountId, fund_id: funds[0].id })
    .eq("id", connectionId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board admin can change this." };

  revalidatePath("/bank-feed");
  return { ok: true };
}

export async function createCashAccount(
  name: string,
): Promise<{ ok?: true; accountId?: string; error?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the account a name." };

  const supabase = await createClient();
  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase.rpc("create_cash_account", {
    p_association_id: associationId,
    p_name: trimmed,
  });
  if (error) return { error: error.message };

  revalidatePath("/bank-feed");
  return { ok: true, accountId: (data as { id: string } | null)?.id };
}

export async function deleteCategorizationRule(
  ruleId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_categorization_rules")
    .delete()
    .eq("id", ruleId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board admin can remove a rule." };
  revalidatePath("/bank-feed");
  return { ok: true };
}
