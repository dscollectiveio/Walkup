"use server";

import { readBankToken } from "@/lib/plaid/token";
import { sealSecret } from "@/lib/security/secret-box";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, plaidErrorLog, describePlaidError } from "@/lib/plaid";
import { syncOneConnection } from "@/lib/plaid/sync";
import { plaidClientUserId } from "@/lib/plaid/client-user-id";
import { forgetBalance } from "@/lib/plaid/balance-cache";
import { matchRule, type CategorizationRule } from "@/lib/plaid/dedupe";
import { isMatchableDescription, normalizeDescription } from "@/lib/plaid/similar";
import { CountryCode, Products } from "plaid";

async function currentClientUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? plaidClientUserId(data.user.id) : null;
}

/**
 * Link's webhook URL, from one env var: Production only, left unset on
 * Preview and local dev so Plaid never posts to a URL that cannot verify it
 * (same reasoning as PLAID_REDIRECT_URI, DECISIONS #27).
 */
function webhookParam() {
  return process.env.PLAID_WEBHOOK_URL ? { webhook: process.env.PLAID_WEBHOOK_URL } : {};
}

async function currentAssociationId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  return data?.[0]?.id ?? null;
}

const BOARD_ADMIN_ONLY = "Only a board admin can connect a bank.";

/**
 * Connecting a bank is a board-admin job and the database decides it. Every
 * Plaid call that creates or exchanges something checks this first: a Link
 * token or an exchanged Item for anyone else is a billable Item Walkup could
 * not store or retire (REVIEW-2 #2).
 */
async function isBoardAdmin(associationId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  return data === true;
}

/**
 * Creates a Plaid Link token so the client can open the Link widget. The
 * widget itself never sees PLAID_SECRET — only this short-lived token.
 */
export async function createLinkToken(): Promise<{ linkToken?: string; error?: string }> {
  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };
  if (!(await isBoardAdmin(associationId))) return { error: BOARD_ADMIN_ONLY };
  const clientUserId = await currentClientUserId();
  if (!clientUserId) return { error: "You are not signed in." };

  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: clientUserId },
      ...webhookParam(),
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
    console.error("Plaid linkTokenCreate failed", plaidErrorLog(cause));
    return { error: describePlaidError(cause) };
  }
}

/**
 * A Link token for update mode: the bank wants the person to sign in again
 * (ITEM_LOGIN_REQUIRED and friends). Plaid takes the existing access token
 * and no products — Link only redoes the sign-in; the Item, its ID and its
 * transaction history stay the same, so nothing is re-imported.
 */
export async function createUpdateLinkToken(
  connectionId: string,
): Promise<{ linkToken?: string; error?: string }> {
  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };
  const clientUserId = await currentClientUserId();
  if (!clientUserId) return { error: "You are not signed in." };

  const supabase = await createClient();
  const { token: accessToken, error: tokenError } = await readBankToken(supabase, connectionId);
  if (tokenError || !accessToken) return { error: tokenError?.message ?? "No access token on file." };

  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: clientUserId },
      ...webhookParam(),
      client_name: "Walkup",
      country_codes: [CountryCode.Us],
      language: "en",
      access_token: accessToken,
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
        : {}),
    });
    return { linkToken: response.data.link_token };
  } catch (cause) {
    console.error("Plaid linkTokenCreate (update mode) failed", plaidErrorLog(cause));
    return { error: describePlaidError(cause) };
  }
}

/**
 * Which fund one bank account's money belongs to (0063 bank_account_funds):
 * the checking account for day-to-day, the savings for the reserve, even at
 * the same bank. An empty fundId goes back to the connection's own fund.
 * Board admin only (RLS).
 */
export async function setBankAccountFund(
  connectionId: string,
  plaidAccountId: string,
  fundId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data: conn } = await supabase.from("bank_connections").select("association_id").eq("id", connectionId).limit(1);
  const associationId = conn?.[0]?.association_id as string | undefined;
  if (!associationId) return { error: "That bank connection isn't available." };
  const { error } = fundId
    ? await supabase.from("bank_account_funds").upsert({
        bank_connection_id: connectionId,
        plaid_account_id: plaidAccountId,
        association_id: associationId,
        fund_id: fundId,
        updated_at: new Date().toISOString(),
      })
    : await supabase
        .from("bank_account_funds")
        .delete()
        .eq("bank_connection_id", connectionId)
        .eq("plaid_account_id", plaidAccountId);
  if (error) return { error: error.code === "42501" ? "Only a board admin can change this." : "Couldn't save that. Try again." };
  revalidatePath("/bank-feed");
  revalidatePath("/");
  revalidatePath("/financial-statements");
  return { ok: true };
}

/**
 * One-off for a bank connected before PLAID_WEBHOOK_URL existed: tells Plaid
 * where to post this Item's webhooks. Board admin only (the token comes
 * through the same RLS-gated path as a manual sync); never a bulk read of
 * tokens. No-ops when PLAID_WEBHOOK_URL is unset.
 */
export async function registerBankWebhook(connectionId: string): Promise<{ ok?: true; error?: string }> {
  const webhook = process.env.PLAID_WEBHOOK_URL;
  if (!webhook) return { error: "PLAID_WEBHOOK_URL is not set." };
  const supabase = await createClient();
  const { token: accessToken, error: tokenError } = await readBankToken(supabase, connectionId);
  if (tokenError || !accessToken) return { error: tokenError?.message ?? "No access token on file." };
  try {
    await plaidClient().itemWebhookUpdate({ access_token: accessToken, webhook });
    return { ok: true };
  } catch (cause) {
    console.error("Plaid itemWebhookUpdate failed", plaidErrorLog(cause));
    return { error: describePlaidError(cause) };
  }
}

/**
 * After Link's update mode succeeds: the login is repaired, so mark the
 * connection active again and pull whatever the bank held back meanwhile.
 * Same sync as the "Sync now" button — a board member's own click.
 */
export async function reconnectBank(
  connectionId: string,
): Promise<{ ok?: true; count?: number; posted?: number; warning?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .update({ status: "active" })
    .eq("id", connectionId)
    .neq("status", "disconnected")
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board admin can reconnect a bank." };
  forgetBalance(connectionId);
  return syncBankTransactions(connectionId);
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
  // Before anything is exchanged: an exchanged Item for a caller who cannot
  // store it is a live, billable Item nobody can retire.
  if (!(await isBoardAdmin(associationId))) return { error: BOARD_ADMIN_ONLY };

  let accessToken: string;
  let itemId: string;
  try {
    const response = await plaidClient().itemPublicTokenExchange({
      public_token: publicToken,
    });
    accessToken = response.data.access_token;
    itemId = response.data.item_id;
  } catch (cause) {
    console.error("Plaid itemPublicTokenExchange failed", plaidErrorLog(cause));
    return { error: describePlaidError(cause) };
  }

  const supabase = await createClient();
  const { data: connectionId, error } = await supabase.rpc("store_bank_connection", {
    p_association_id: associationId,
    p_institution_name: institutionName,
    p_plaid_item_id: itemId,
    p_access_token: sealSecret(accessToken),
  });

  if (error) {
    // The Item exists at Plaid but Walkup could not keep its token. Retire it
    // now, while this function still holds the only copy.
    try {
      await plaidClient().itemRemove({ access_token: accessToken });
    } catch (cause) {
      console.error("Plaid itemRemove after a failed store failed", plaidErrorLog(cause));
    }
    console.error("store_bank_connection failed", error.code);
    return { error: "Walkup couldn't save this bank connection, so it was not connected. Try again." };
  }

  // Every posting needs a cash leg. Default to Operating Cash / Operating
  // fund so the first sync can post; the board can change it on the page.
  // A second bank is different: if another live connection already posts
  // to Operating Cash, defaulting this one there too would merge two banks
  // into one ledger account. Leave it unset so the page asks which account
  // this bank is (the "pick one before posting" prompt) before anything posts.
  const [{ data: cashAccounts }, { data: funds }] = await Promise.all([
    supabase.from("accounts").select("id").eq("code", "1000").eq("is_cash_account", true).limit(1),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  const { count: alreadyUsing } = cashAccounts?.[0]
    ? await supabase
        .from("bank_connections")
        .select("id", { count: "exact", head: true })
        .eq("cash_account_id", cashAccounts[0].id)
        .neq("status", "disconnected")
        .neq("id", connectionId)
    : { count: 0 };
  if (cashAccounts?.[0] && funds?.[0] && (alreadyUsing ?? 0) === 0) {
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

  const { token: accessToken, error: tokenError } = await readBankToken(supabase, connectionId);

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
        console.error("Plaid itemRemove failed", plaidErrorLog(cause));
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
 * Only the bank feed itself is revalidated after a posting. The ledger pages
 * that read the result (financial statements, budget, dues, delinquency,
 * home) are dynamic and re-render on their next visit anyway; the only
 * thing revalidating them would buy is skipping the 30-second router cache
 * (next.config.ts staleTimes), at the cost of six invalidations on every
 * click while someone works through forty rows.
 */
function revalidateLedgerPages() {
  revalidatePath("/bank-feed");
}

type BatchRow = { id: string; ok: boolean; error: string | null };

/**
 * Posts (or unposts) many rows in one round trip via post_bank_transactions /
 * unpost_bank_transactions (0046), which loop over the per-row RPCs — nothing
 * is bypassed, one failing row does not stop the rest. Returns how many
 * succeeded and a plain-words line for each that did not.
 */
async function postBatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fn: "post_bank_transactions" | "unpost_bank_transactions",
  rows: { id: string; description?: string }[],
): Promise<{ done: number; errors: string[]; failedIds: Set<string> }> {
  if (rows.length === 0) return { done: 0, errors: [], failedIds: new Set() };
  const { data, error } = await supabase.rpc(fn, { p_ids: rows.map((r) => r.id) });
  if (error) {
    return { done: 0, errors: [error.message], failedIds: new Set(rows.map((r) => r.id)) };
  }
  const descriptionById = new Map(rows.map((r) => [r.id, r.description]));
  const errors: string[] = [];
  const failedIds = new Set<string>();
  let done = 0;
  for (const r of (data ?? []) as BatchRow[]) {
    if (r.ok) {
      done += 1;
      continue;
    }
    failedIds.add(r.id);
    const description = descriptionById.get(r.id);
    errors.push(description ? `${description}: ${r.error}` : (r.error ?? "Couldn't be posted."));
  }
  return { done, errors, failedIds };
}

/**
 * Pulls new activity for one connection via Plaid's cursor-based sync.
 * Because this runs as the signed-in board member, rows matched by an
 * auto-post rule are posted to the ledger here too — the cron never does
 * that (DECISIONS #29).
 */
export async function syncBankTransactions(
  connectionId: string,
): Promise<{
  ok?: true;
  count?: number;
  posted?: number;
  warning?: string;
  error?: string;
  /** The bank wants a fresh sign-in; the fix is the Reconnect button, not a retry. */
  needsReconnect?: boolean;
}> {
  const supabase = await createClient();

  const { data: connectionRows, error: connectionError } = await supabase
    .from("bank_connections")
    .select("id, association_id, sync_cursor")
    .eq("id", connectionId)
    .limit(1);

  if (connectionError) return { error: connectionError.message };
  const connection = connectionRows?.[0];
  if (!connection) return { error: "Bank connection not found." };

  const { token: accessToken, error: tokenError } = await readBankToken(supabase, connectionId);
  if (tokenError || !accessToken) return { error: tokenError?.message ?? "No access token on file." };

  const result = await syncOneConnection(supabase, connection, accessToken, { autoPost: true });
  // The person asked for fresh numbers, so the bank card re-asks Plaid too.
  forgetBalance(connectionId);
  if ("error" in result) {
    if (result.needsReconnect || result.deadConnection) revalidatePath("/bank-feed");
    return { error: result.error, needsReconnect: result.needsReconnect };
  }

  revalidateLedgerPages();
  return {
    ok: true,
    count: result.count,
    posted: result.posted,
    warning:
      [
        ...result.postErrors,
        ...(result.more ? ["Imported part of the history. Sync again to continue."] : []),
      ].join(" · ") || undefined,
  };
}

export type PostingKind = "expense" | "income" | "dues" | "transfer" | "excluded";

const POSTING_KINDS: PostingKind[] = ["expense", "income", "dues", "transfer", "excluded"];

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface Categorization {
  posting_kind: PostingKind;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
  /** A person chose this, so it is no longer "filed by a rule". */
  rule_id: null;
  /** Leaving "Not for the books" clears the stamp post_bank_transaction() put on it. */
  excluded_at?: null;
}

/** The columns bank_transactions gets from a (kind, account, unit, vendor) choice. */
function categorizationOf(item: {
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
}): Categorization {
  return {
    posting_kind: item.kind,
    account_id: ["expense", "income", "transfer"].includes(item.kind) ? item.accountId : null,
    matched_unit_id: item.kind === "dues" ? item.unitId : null,
    vendor_id: item.kind === "expense" ? item.vendorId : null,
    rule_id: null,
    ...(item.kind === "excluded" ? {} : { excluded_at: null }),
  };
}

/** Plain-words reason a choice can't be saved, or null when it can. */
function invalidChoice(item: { kind: PostingKind; accountId: string | null; unitId: string | null }): string | null {
  if (!POSTING_KINDS.includes(item.kind)) return "Choose how this should be recorded.";
  if (["expense", "income", "transfer"].includes(item.kind) && !item.accountId) return "Choose an account.";
  if (item.kind === "dues" && !item.unitId) return "Choose the unit this is dues for.";
  return null;
}

/**
 * The pattern a rule is saved under: the payee key (normalizeDescription —
 * lowercase, digits and punctuation dropped), the same key the tally and
 * matchRule() use. "COMED 8841 10/03" becomes "comed", so the rule fires on
 * next month's "COMED 8841 11/03" too. Null when there is too little left to
 * mean anything ("1234 #").
 */
function rulePatternFor(description: string): string | null {
  const key = normalizeDescription(description);
  return isMatchableDescription(key) ? key : null;
}

/**
 * After a choice made by hand in the form: is this at least the second time
 * the board has filed this payee this way, with no rule yet? Then the client
 * can ask "Always file X as Y?" — one click, one explicit yes. Nothing is
 * remembered on its own, so a one-off "Not for the books" or a duplicate
 * guard never turns into a standing rule (that happened; see DECISIONS #29).
 * Reads the trigger-kept tally (0046), which already includes the row just
 * filed, so "second time" is count >= 2.
 */
async function suggestRule(
  supabase: Supabase,
  row: { association_id: string; description: string; amount: string | number },
  c: Categorization,
): Promise<{ pattern: string } | null> {
  const pattern = rulePatternFor(row.description);
  const direction = Math.sign(Number(row.amount));
  if (!pattern || direction === 0) return null;

  const tallyQuery = supabase
    .from("bank_payee_history")
    .select("count")
    .eq("association_id", row.association_id)
    .eq("payee_key", pattern)
    .eq("direction", direction)
    .eq("posting_kind", c.posting_kind);
  const [{ data: tally }, { data: rules }] = await Promise.all([
    (c.posting_kind === "dues"
      ? tallyQuery.eq("matched_unit_id", c.matched_unit_id)
      : c.posting_kind === "excluded"
        ? tallyQuery
        : tallyQuery.eq("account_id", c.account_id)
    ).limit(1),
    supabase
      .from("bank_categorization_rules")
      .select("id, pattern, posting_kind, account_id, matched_unit_id, vendor_id, auto_post")
      .eq("association_id", row.association_id),
  ]);

  if (Number(tally?.[0]?.count ?? 0) < 2) return null;
  if (matchRule(row.description, (rules ?? []) as CategorizationRule[])) return null;
  return { pattern };
}

/**
 * Saves "payee key contains pattern ⇒ this choice" for future syncs. The
 * table's RLS makes this board_admin-only. Never auto-posts: a rule
 * pre-fills, a person posts (DECISIONS #29).
 */
export async function saveCategorizationRule(input: {
  pattern: string;
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
}): Promise<{ ok?: true; error?: string }> {
  const pattern = rulePatternFor(input.pattern);
  if (!pattern) return { error: "The description is too short to make a rule from." };
  const invalid = invalidChoice(input);
  if (invalid) return { error: invalid };

  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };

  const supabase = await createClient();
  const { posting_kind, account_id, matched_unit_id, vendor_id } = categorizationOf(input);
  const { error } = await supabase
    .from("bank_categorization_rules")
    .upsert(
      { association_id: associationId, pattern, posting_kind, account_id, matched_unit_id, vendor_id, auto_post: false },
      { onConflict: "association_id,pattern" },
    );
  if (error) return { error: error.message };
  revalidatePath("/bank-feed");
  return { ok: true };
}

/**
 * Records how a bank transaction should hit the books and optionally posts
 * it right now. The categorization itself is a board_admin UPDATE
 * (bank_transactions_update, 0016); the posting is post_bank_transaction()
 * (0036), which does its own checks and is the only thing that ever sets
 * journal_entry_id. `ruleSuggestion` says when it's worth asking "Always
 * file X as Y?"; no rule is saved without that yes.
 */
export async function categorizeBankTransaction(input: {
  transactionId: string;
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
  postNow: boolean;
}): Promise<{
  ok?: true;
  posted?: boolean;
  /** Set when this is at least the second time the payee was filed this way and no rule exists yet. */
  ruleSuggestion?: { pattern: string };
  error?: string;
}> {
  const invalid = invalidChoice(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const categorization = categorizationOf(input);

  const { data, error } = await supabase
    .from("bank_transactions")
    .update(categorization)
    .eq("id", input.transactionId)
    .is("journal_entry_id", null)
    .select("id, association_id, description, amount");

  if (error) return { error: error.message };
  const row = data?.[0];
  if (!row) return { error: "Only a board admin can categorize a transaction, and it can't already be posted." };

  const ruleSuggestion = await suggestRule(supabase, row, categorization);

  let posted = false;
  if (input.postNow) {
    const { error: postError } = await supabase.rpc("post_bank_transaction", {
      p_transaction_id: input.transactionId,
    });
    if (postError) return { error: `Categorized, but not posted: ${postError.message}` };
    posted = true;
  }

  revalidateLedgerPages();
  return { ok: true, posted, ...(ruleSuggestion ? { ruleSuggestion } : {}) };
}

/**
 * Same as categorizeBankTransaction, but for many rows at once with one
 * shared categorization — the bulk-review tool on the bank feed. No rule is
 * offered here (a rule is one pattern → one target; a batch of differently-
 * worded transactions sharing a category doesn't have a single pattern to
 * save). Same board_admin-gated UPDATE, same post_bank_transaction() per
 * row if postNow is set. `applied` is every row that took the category;
 * `posted` how many of those reached the books.
 */
export async function categorizeBankTransactionsBulk(input: {
  transactionIds: string[];
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
  postNow: boolean;
}): Promise<{ ok?: true; applied?: string[]; posted?: number; errors?: string[]; error?: string }> {
  if (input.transactionIds.length === 0) return { error: "Nothing selected." };
  const invalid = invalidChoice(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const categorization = categorizationOf(input);

  const { data, error } = await supabase
    .from("bank_transactions")
    .update(categorization)
    .in("id", input.transactionIds)
    .is("journal_entry_id", null)
    .select("id, association_id, description");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "None of those could be categorized: only a board admin can, and none can already be posted." };
  }

  const { done: posted, errors } = input.postNow
    ? await postBatch(supabase, "post_bank_transactions", data)
    : { done: 0, errors: [] };

  revalidateLedgerPages();
  return { ok: true, applied: data.map((r) => r.id), posted, errors };
}

export interface CategorizationItem {
  id: string;
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
}

/**
 * Categorizes many rows where each can have its own target — what "Post all
 * recommended", one-click suggestion chips, and "apply to similar" need
 * (categorizeBankTransactionsBulk shares one target across every row). Rows
 * that share a choice go in one UPDATE, so a batch across six categories is
 * six round trips, not one per row. Same board_admin UPDATE and the same
 * post_bank_transaction() per row when postNow is set; a row that can't be
 * applied is reported, not fatal.
 */
export async function applyCategorizations(input: {
  items: CategorizationItem[];
  postNow: boolean;
}): Promise<{ ok?: true; applied?: string[]; posted?: number; errors?: string[]; error?: string }> {
  if (input.items.length === 0) return { error: "Nothing to apply." };
  const supabase = await createClient();

  const applied: { id: string; description: string }[] = [];
  const errors: string[] = [];
  const groups = new Map<string, { categorization: Categorization; ids: string[] }>();
  for (const item of input.items) {
    const invalid = invalidChoice(item);
    if (invalid) {
      errors.push(invalid);
      continue;
    }
    const categorization = categorizationOf(item);
    const key = JSON.stringify(categorization);
    const group = groups.get(key) ?? { categorization, ids: [] };
    group.ids.push(item.id);
    groups.set(key, group);
  }

  for (const { categorization, ids } of groups.values()) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .update(categorization)
      .in("id", ids)
      .is("journal_entry_id", null)
      .select("id, description");
    if (error) {
      errors.push(error.message);
      continue;
    }
    applied.push(...(data ?? []));
    const missing = ids.length - (data?.length ?? 0);
    if (missing > 0) {
      errors.push(
        `${missing} transaction${missing === 1 ? "" : "s"} couldn't be changed: already posted, or you may not be a board admin.`,
      );
    }
  }

  const { done: posted, errors: postErrors } = input.postNow
    ? await postBatch(supabase, "post_bank_transactions", applied)
    : { done: 0, errors: [] };
  errors.push(...postErrors);

  revalidateLedgerPages();
  if (applied.length === 0) return { error: errors[0] ?? "Nothing could be applied." };
  return { ok: true, applied: applied.map((r) => r.id), posted, errors };
}

/** What a row looked like before a categorization, so it can be put back. */
export interface PriorState {
  id: string;
  posting_kind: PostingKind | null;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
  excluded_at: string | null;
  rule_id: string | null;
}

/**
 * Undo for the actions above: takes back any posting made since (via
 * unpost_bank_transaction, which writes a reversing entry — nothing is
 * deleted from the ledger) and restores the earlier categorization. No rule
 * is ever saved by those actions without a separate yes, so there is none
 * to take back here.
 */
export async function revertCategorizations(
  prior: PriorState[],
): Promise<{ ok?: true; reverted?: number; error?: string }> {
  if (prior.length === 0) return { error: "Nothing to undo." };
  const supabase = await createClient();

  const { data: current, error: readError } = await supabase
    .from("bank_transactions")
    .select("id, journal_entry_id")
    .in(
      "id",
      prior.map((p) => p.id),
    );
  if (readError) return { error: readError.message };
  const postedIds = new Set((current ?? []).filter((r) => r.journal_entry_id).map((r) => r.id));

  // Take back every posting first, in one call; a row whose reversal failed
  // is still in the books and must keep its categorization.
  const unposted = await postBatch(
    supabase,
    "unpost_bank_transactions",
    prior.filter((p) => postedIds.has(p.id)),
  );
  let reverted = 0;
  const errors: string[] = [...unposted.errors];
  for (const p of prior) {
    if (unposted.failedIds.has(p.id)) continue;
    const { data, error } = await supabase
      .from("bank_transactions")
      .update({
        posting_kind: p.posting_kind,
        account_id: p.account_id,
        matched_unit_id: p.matched_unit_id,
        vendor_id: p.vendor_id,
        excluded_at: p.excluded_at,
        rule_id: p.rule_id,
      })
      .eq("id", p.id)
      .is("journal_entry_id", null)
      .select("id");
    if (error) errors.push(error.message);
    else if (data?.[0]) reverted += 1;
  }

  revalidateLedgerPages();
  if (reverted === 0) return { error: errors[0] ?? "Nothing could be undone." };
  return { ok: true, reverted };
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

  const { done: posted, errors } = await postBatch(supabase, "post_bank_transactions", ready ?? []);

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
