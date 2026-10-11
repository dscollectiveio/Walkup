"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { plaidClient, describePlaidError } from "@/lib/plaid";
import { syncOneConnection } from "@/lib/plaid/sync";
import { matchRule, type CategorizationRule } from "@/lib/plaid/dedupe";
import { isMatchableDescription, normalizeDescription } from "@/lib/plaid/similar";
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

  const supabase = await createClient();
  const { data: accessToken, error: tokenError } = await supabase.rpc("get_bank_access_token", {
    p_connection_id: connectionId,
  });
  if (tokenError || !accessToken) return { error: tokenError?.message ?? "No access token on file." };

  try {
    const response = await plaidClient().linkTokenCreate({
      user: { client_user_id: associationId },
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

  const { data: accessToken, error: tokenError } = await supabase.rpc(
    "get_bank_access_token",
    { p_connection_id: connectionId },
  );
  if (tokenError) return { error: tokenError.message };

  const result = await syncOneConnection(supabase, connection, accessToken, { autoPost: true });
  if ("error" in result) {
    if (result.needsReconnect) revalidatePath("/bank-feed");
    return { error: result.error, needsReconnect: result.needsReconnect };
  }

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

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface Categorization {
  posting_kind: PostingKind;
  account_id: string | null;
  matched_unit_id: string | null;
  vendor_id: string | null;
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
 * Transfers and "Not for the books" are never judgement calls twice: a move
 * to the association's own savings is always a transfer, and a payee the
 * board has said to keep out of the books stays out. So the first time a
 * person files one, remember it as a rule for that exact description — no
 * checkbox to find, nothing to ask. auto_post stays false: the rule pre-fills
 * the next matching row and a person still posts it. A rule that already
 * exists for the description is left exactly as it is.
 */
async function rememberObviousRules(
  supabase: Supabase,
  rows: { association_id: string; description: string }[],
  categorization: Categorization,
): Promise<void> {
  if (categorization.posting_kind !== "transfer" && categorization.posting_kind !== "excluded") return;
  const seen = new Set<string>();
  const rules = [];
  for (const r of rows) {
    const pattern = r.description.trim();
    const key = `${r.association_id}:${pattern}`;
    if (pattern.length < 3 || seen.has(key)) continue;
    seen.add(key);
    rules.push({ association_id: r.association_id, pattern, ...categorization, auto_post: false });
  }
  if (rules.length === 0) return;
  const { error } = await supabase
    .from("bank_categorization_rules")
    .upsert(rules, { onConflict: "association_id,pattern", ignoreDuplicates: true });
  // The categorization itself already saved; a rule that didn't is a lost
  // convenience, not an error worth stopping the person for.
  if (error) console.warn("bank_categorization_rules upsert failed", error.message);
}

/**
 * After an expense, income or dues choice: is this at least the second time
 * the board has filed this payee this way, with no rule yet? Then the client
 * can ask "Always file X as Y?" — one click instead of a checkbox nobody
 * finds. Reads the trigger-kept tally (0046), which already includes the row
 * just filed, so "second time" is count >= 2.
 */
async function suggestRule(
  supabase: Supabase,
  row: { association_id: string; description: string; amount: string | number },
  c: Categorization,
): Promise<{ pattern: string; label: string } | null> {
  if (!["expense", "income", "dues"].includes(c.posting_kind)) return null;
  const pattern = row.description.trim();
  const payeeKey = normalizeDescription(row.description);
  const direction = Math.sign(Number(row.amount));
  if (pattern.length < 3 || !isMatchableDescription(payeeKey) || direction === 0) return null;

  const tallyQuery = supabase
    .from("bank_payee_history")
    .select("count")
    .eq("association_id", row.association_id)
    .eq("payee_key", payeeKey)
    .eq("direction", direction)
    .eq("posting_kind", c.posting_kind);
  const labelQuery =
    c.posting_kind === "dues"
      ? supabase
          .from("units")
          .select("label")
          .eq("id", c.matched_unit_id)
          .limit(1)
          .then(({ data }) => (data?.[0]?.label as string | undefined) ?? null)
      : supabase
          .from("accounts")
          .select("name")
          .eq("id", c.account_id)
          .limit(1)
          .then(({ data }) => (data?.[0]?.name as string | undefined) ?? null);
  const [{ data: tally }, { data: rules }, label] = await Promise.all([
    (c.posting_kind === "dues"
      ? tallyQuery.eq("matched_unit_id", c.matched_unit_id)
      : tallyQuery.eq("account_id", c.account_id)
    ).limit(1),
    supabase
      .from("bank_categorization_rules")
      .select("id, pattern, posting_kind, account_id, matched_unit_id, vendor_id, auto_post")
      .eq("association_id", row.association_id),
    labelQuery,
  ]);

  if (Number(tally?.[0]?.count ?? 0) < 2 || !label) return null;
  if (matchRule(row.description, (rules ?? []) as CategorizationRule[])) return null;
  return { pattern, label };
}

/**
 * Saves "description contains pattern ⇒ this choice" for future syncs. The
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
  const pattern = input.pattern.trim();
  if (pattern.length < 3) return { error: "The description is too short to make a rule from." };
  const invalid = invalidChoice(input);
  if (invalid) return { error: invalid };

  const associationId = await currentAssociationId();
  if (!associationId) return { error: "No association is visible to you." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_categorization_rules")
    .upsert(
      { association_id: associationId, pattern, ...categorizationOf(input), auto_post: false },
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
 * journal_entry_id. Transfers and "Not for the books" become rules on their
 * own; for the rest, `ruleSuggestion` says when it's worth asking.
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
  ruleSuggestion?: { pattern: string; label: string };
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

  const [ruleSuggestion] = await Promise.all([
    suggestRule(supabase, row, categorization),
    rememberObviousRules(supabase, [row], categorization),
  ]);

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
 * saved here (a rule is one pattern → one target; a batch of differently-
 * worded transactions sharing a category doesn't have a single pattern to
 * save). Same board_admin-gated UPDATE, same post_bank_transaction() per
 * row if postNow is set.
 */
export async function categorizeBankTransactionsBulk(input: {
  transactionIds: string[];
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
  postNow: boolean;
}): Promise<{ ok?: true; posted?: number; errors?: string[]; error?: string }> {
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
    return { error: "None of those could be categorized — only a board admin can, and none can already be posted." };
  }

  await rememberObviousRules(supabase, data, categorization);

  const { done: posted, errors } = input.postNow
    ? await postBatch(supabase, "post_bank_transactions", data)
    : { done: 0, errors: [] };

  revalidateLedgerPages();
  return { ok: true, posted, errors };
}

export interface CategorizationItem {
  id: string;
  kind: PostingKind;
  accountId: string | null;
  unitId: string | null;
  vendorId: string | null;
}

/**
 * Categorizes many rows where each can have its own target — what "Accept all
 * suggestions", one-click suggestion chips, and "apply to similar" need
 * (categorizeBankTransactionsBulk shares one target across every row). Same
 * board_admin UPDATE and the same post_bank_transaction() per row when
 * postNow is set; a row that can't be applied is reported, not fatal.
 */
export async function applyCategorizations(input: {
  items: CategorizationItem[];
  postNow: boolean;
}): Promise<{ ok?: true; applied?: string[]; posted?: number; errors?: string[]; error?: string }> {
  if (input.items.length === 0) return { error: "Nothing to apply." };
  const supabase = await createClient();

  const applied: { id: string; association_id: string; description: string }[] = [];
  const errors: string[] = [];
  // Rows filed as a transfer or "Not for the books", grouped by the exact
  // choice, so each becomes one rule upsert rather than one per row.
  const obvious = new Map<string, { categorization: Categorization; rows: typeof applied }>();

  for (const item of input.items) {
    const invalid = invalidChoice(item);
    if (invalid) {
      errors.push(invalid);
      continue;
    }
    const categorization = categorizationOf(item);
    const { data, error } = await supabase
      .from("bank_transactions")
      .update(categorization)
      .eq("id", item.id)
      .is("journal_entry_id", null)
      .select("id, association_id, description");
    if (error) {
      errors.push(error.message);
      continue;
    }
    const row = data?.[0];
    if (!row) {
      errors.push("A transaction couldn't be changed — it may already be posted, or you may not be a board admin.");
      continue;
    }
    applied.push(row);
    if (item.kind === "transfer" || item.kind === "excluded") {
      const key = JSON.stringify(categorization);
      const group = obvious.get(key) ?? { categorization, rows: [] };
      group.rows.push(row);
      obvious.set(key, group);
    }
  }

  for (const group of obvious.values()) {
    await rememberObviousRules(supabase, group.rows, group.categorization);
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
}

/**
 * Undo for the actions above: takes back any posting made since (via
 * unpost_bank_transaction, which writes a reversing entry — nothing is
 * deleted from the ledger) and restores the earlier categorization.
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
