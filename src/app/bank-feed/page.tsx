import { readBankToken } from "@/lib/plaid/token";
import Link from "next/link";
import { Suspense } from "react";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { BoardOnly, viewerIsOwnerOnly } from "@/components/board-only";
import { ConnectBankButton } from "./connect-bank-button";
import { TransactionsHelp } from "./transactions-help";
import { type Pickers, type TransactionRecord } from "./transaction-row";
import {
  TransactionsTable,
  type SuggestedTransaction,
} from "./transactions-table";
import { FiltersBar } from "./filters-bar";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  RANGES,
  bankFeedHref,
  type Range,
  type Sort,
  type Status,
} from "./href";
import {
  BankAccountsSection,
  BankAccountsSkeleton,
  getConnectionBalance,
  type ConnectionBalance,
} from "./balances";
import { RulesToggle, type RuleRecord } from "./rules-list";
import {
  buildHistoryIndex,
  recommend,
  typicalAmountCents,
  type ManualPayment,
  type PayeeHistoryRow,
  type Recommendation,
} from "@/lib/plaid/recommend";
import { claimAutoSync, releaseAutoSync } from "@/lib/plaid/auto-sync-claim";
import { syncOneConnection } from "@/lib/plaid/sync";
import { plaidErrorLog } from "@/lib/plaid";
import { StripePayoutsCard } from "./stripe-payouts-card";
import { loadStripePayouts } from "@/lib/payments/payouts-load";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  sort: "To sort",
  needs: "To sort",
  ready: "To sort",
  posted: "Posted",
  excluded: "Not for the books",
  retracted: "Retracted",
};

/** The two tabs. Not for the books and Retracted are a quiet line under the list. */
const MAIN_STATUSES: Status[] = ["sort", "posted"];

const PILL_ACTIVE =
  "inline-flex min-h-[44px] items-center rounded-full bg-ink px-3 py-1 sm:min-h-0 text-[12px] font-medium text-paper";
const PILL =
  "inline-flex min-h-[44px] items-center rounded-full border border-line-strong px-3 py-1 sm:min-h-0 text-[12px] text-ink hover:bg-fill";

const KIND_LABEL: Record<string, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

/** A bank last synced longer ago than this gets a sync kicked off when a board admin opens the page. */
const STALE_SYNC_MS = 12 * 60 * 60 * 1000;
/**
 * When this server last started an auto-sync for a connection. last_synced_at
 * only moves once a sync finishes, and this page re-renders on every search
 * keystroke, filter and action, so without this each render would start
 * another sync of the same cursor while the first still ran — and a bank that
 * kept failing would be retried on every click. Per instance; the daily cron
 * is the backstop.
 */
const autoSyncStartedAt = new Map<string, number>();
const AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

const TRANSACTION_COLUMNS =
  "id, posted_on, description, amount, pending, raw_category, original_description, note, posting_kind, account_id, matched_unit_id, vendor_id, journal_entry_id, excluded_at, removed_at, rule_id, bank_connection_id";

const ORDER: Record<Sort, { column: string; ascending: boolean }> = {
  date_desc: { column: "posted_on", ascending: false },
  date_asc: { column: "posted_on", ascending: true },
  name_asc: { column: "description", ascending: true },
  name_desc: { column: "description", ascending: false },
  amount_desc: { column: "amount", ascending: false },
  amount_asc: { column: "amount", ascending: true },
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The first and last day a range covers (either may be open). Custom dates are used as typed, when they are real dates. */
function rangeBounds(
  range: Range,
  from?: string,
  to?: string,
): { start: string | null; end: string | null } {
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return ymd(d);
  };
  switch (range) {
    case "this_month":
      return { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end: null };
    case "last_month":
      return {
        start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        end: ymd(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case "last_30":
      return { start: daysAgo(30), end: null };
    case "last_90":
      return { start: daysAgo(90), end: null };
    case "this_year":
      return { start: ymd(new Date(now.getFullYear(), 0, 1)), end: null };
    case "custom":
      return {
        start: from && ISO_DAY.test(from) ? from : null,
        end: to && ISO_DAY.test(to) ? to : null,
      };
    default:
      return { start: null, end: null };
  }
}

/**
 * The slice of a PostgREST filter builder these helpers use. Typed by hand
 * because supabase-js's own generics, threaded through a generic helper,
 * send the type checker into "excessively deep" territory; every one of
 * these methods returns the same builder, which is all the helpers rely on.
 */
interface Chain {
  ilike(column: string, pattern: string): Chain;
  gte(column: string, value: string): Chain;
  lte(column: string, value: string): Chain;
  eq(column: string, value: string): Chain;
  is(column: string, value: null | boolean): Chain;
  not(column: string, operator: string, value: unknown): Chain;
  or(filters: string): Chain;
}

interface Filters {
  q?: string;
  start: string | null;
  end: string | null;
  account?: string;
  /** Plaid account id of one connected bank account. */
  bank?: string;
}

/** Search, range and category filters — the same ones on every query so the counts and the rows agree. */
function scoped<T>(query: T, f: Filters): T {
  let q = query as unknown as Chain;
  if (f.q) q = q.ilike("description", `%${f.q}%`);
  if (f.start) q = q.gte("posted_on", f.start);
  if (f.end) q = q.lte("posted_on", f.end);
  if (f.bank) q = q.eq("plaid_account_id", f.bank);
  if (f.account) q = q.eq("account_id", f.account);
  return q as unknown as T;
}

/**
 * One status per row, decided in this order: retracted by the bank, posted,
 * excluded, categorized ("ready"), or still needing a category. "All" hides
 * retracted rows unless they were posted — those still need a human to undo.
 */
function withStatus<T>(query: T, status: Status): T {
  const q = query as unknown as Chain;
  const filtered = (() => {
    switch (status) {
      case "retracted":
        return q.not("removed_at", "is", null);
      case "posted":
        return q.not("journal_entry_id", "is", null).is("removed_at", null);
      case "excluded":
        return q
          .not("excluded_at", "is", null)
          .is("journal_entry_id", null)
          .is("removed_at", null);
      case "ready":
        return q
          .not("posting_kind", "is", null)
          .is("excluded_at", null)
          .is("journal_entry_id", null)
          .is("removed_at", null);
      case "needs":
        return q
          .is("posting_kind", null)
          .is("excluded_at", null)
          .is("journal_entry_id", null)
          .is("removed_at", null);
      case "sort":
        // Needs a category, or has one and is waiting to be posted: one list.
        return q
          .is("excluded_at", null)
          .is("journal_entry_id", null)
          .is("removed_at", null);
      case "all":
        return q.or("removed_at.is.null,journal_entry_id.not.is.null");
    }
  })();
  return filtered as unknown as T;
}

function nextSort(current: Sort, column: "date" | "name" | "amount"): Sort {
  if (column === "date")
    return current === "date_desc" ? "date_asc" : "date_desc";
  if (column === "name")
    return current === "name_asc" ? "name_desc" : "name_asc";
  return current === "amount_desc" ? "amount_asc" : "amount_desc";
}

export default async function BankFeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    range?: string;
    status?: string;
    sort?: string;
    account?: string;
    from?: string;
    to?: string;
    bank?: string;
    limit?: string;
  }>;
}) {
  const {
    q,
    range: rangeParam,
    status: statusParam,
    sort: sortParam,
    account: accountParam,
    from: fromParam,
    to: toParam,
    bank: bankParam,
    limit: limitParam,
  } = await searchParams;
  // An owner has no business here, and RLS would show them a bank-less page
  // that reads as "nothing connected" (owner-portal-spec 2.4).
  if (await viewerIsOwnerOnly()) {
    return (
      <BoardOnly
        what="The bank feed"
        why="It shows the association's bank transactions, which only the board and the accountant can see."
        alternative={{ label: "See your statement", href: "/owner" }}
      />
    );
  }
  // From the Budget page: "see the transactions behind this category".
  const account = accountParam?.trim() || undefined;
  const range: Range =
    rangeParam && (RANGES as string[]).includes(rangeParam)
      ? (rangeParam as Range)
      : "all";
  const from = fromParam && ISO_DAY.test(fromParam) ? fromParam : undefined;
  const to = toParam && ISO_DAY.test(toParam) ? toParam : undefined;
  const bank = bankParam?.trim() || undefined;
  // Every link on this page keeps the date and bank-account filters.
  const hrefFor = (
    q: string | undefined,
    range: Range,
    status: Status,
    sort: Sort,
    account?: string,
    limit: number = DEFAULT_LIMIT,
  ): string =>
    bankFeedHref({ q, range, status, sort, account, from, to, bank, limit });
  // No status in the URL means "show me what needs doing" when there is any.
  const rawStatus: Status | null =
    statusParam && statusParam in STATUS_LABEL ? (statusParam as Status) : null;
  // Older links say needs or ready; both are now the one To sort list.
  const explicitStatus: Status | null =
    rawStatus === "needs" || rawStatus === "ready" ? "sort" : rawStatus;
  const SORTS: Sort[] = [
    "date_desc",
    "date_asc",
    "name_asc",
    "name_desc",
    "amount_desc",
    "amount_asc",
  ];
  const sort: Sort =
    sortParam && SORTS.includes(sortParam as Sort)
      ? (sortParam as Sort)
      : "date_desc";
  const parsedLimit = Number.parseInt(limitParam ?? "", 10);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;
  // The landing render, as opposed to a search, filter, sort or "Load earlier" re-render.
  const plainOpen =
    !q &&
    !rangeParam &&
    !bankParam &&
    !statusParam &&
    !sortParam &&
    !accountParam &&
    !limitParam;

  const supabase = await createClient();

  // Two round trips to the database, no more, in the common case: the
  // association row first (the role check needs its id), then everything
  // else at once. A third happens only when the default status turns out
  // to be "all" rather than "needs category".
  const { data: associations } = await supabase
    .from("associations")
    .select("id")
    .limit(1);
  const associationId = associations?.[0]?.id ?? null;

  const { start, end } = rangeBounds(range, from, to);
  const filters: Filters = { q, start, end, account, bank };
  const countFor = (status: Status) =>
    withStatus(
      scoped(
        supabase
          .from("bank_transactions")
          .select("id", { count: "exact", head: true }),
        filters,
      ),
      status,
    );
  const rowsFor = (status: Status) =>
    withStatus(
      scoped(
        supabase.from("bank_transactions").select(TRANSACTION_COLUMNS),
        filters,
      ),
      status,
    )
      .order(ORDER[sort].column, { ascending: ORDER[sort].ascending })
      .order("id")
      .limit(limit);
  // The best first guess at the status to show; corrected below if needed.
  const firstStatus: Status = explicitStatus ?? (account ? "all" : "sort");
  const now = new Date();
  const since45Days = new Date(now.getTime() - 45 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: isBoardAdminRes },
    { data: units },
    { data: accounts },
    { data: vendors },
    { data: rules },
    { data: historyRows },
    { data: connections },
    { data: manualPaymentRows },
    { count: needsCount },
    { count: readyCount },
    { count: postedCount },
    { count: excludedCount },
    { count: retractedCount },
    { count: retractedPostedCount },
    // History persists across disconnects — a disconnected bank's
    // transactions are still in the books, so they still show here.
    { data: firstRows },
    { data: fundRows },
    { data: accountFundRows },
    { data: cardRows },
    { data: bankAccountRows },
    { data: nicknameRows },
  ] = await Promise.all([
    associationId
      ? supabase.rpc("has_role_in", {
          assoc: associationId,
          roles: ["board_admin"],
        })
      : Promise.resolve({ data: false }),
    supabase.from("units").select("id, label").order("sort_order"),
    supabase
      .from("accounts")
      .select("id, code, name, type, is_cash_account")
      .eq("is_active", true)
      .order("code"),
    supabase.from("vendors").select("id, name").order("name"),
    supabase
      .from("bank_categorization_rules")
      .select(
        "id, pattern, posting_kind, account_id, matched_unit_id, auto_post",
      )
      .order("created_at"),
    // What this board filed each payee as before — the strongest source for
    // the "Recommended" chip. A trigger-maintained tally (0046), one row per
    // payee and choice, instead of re-reading every categorized transaction.
    supabase
      .from("bank_payee_history")
      .select(
        "payee_key, direction, posting_kind, account_id, matched_unit_id, count, amount_cents_total",
      ),
    supabase
      .from("bank_connections")
      .select(
        "id, association_id, institution_name, status, last_synced_at, sync_cursor, cash_account_id, fund_id",
      )
      .order("created_at", { ascending: false }),
    // Dues recorded by hand lately ("Record a payment"): a deposit that
    // matches one is already in the books and must not be posted twice.
    supabase
      .from("payments")
      .select("unit_id, amount, received_on")
      .in("method", ["check", "cash", "other"])
      .not("unit_id", "is", null)
      .gte("received_on", since45Days),
    countFor("needs"),
    countFor("ready"),
    countFor("posted"),
    countFor("excluded"),
    countFor("retracted"),
    countFor("retracted").not("journal_entry_id", "is", null),
    rowsFor(firstStatus),
    supabase.from("funds").select("id, name, kind").order("name"),
    supabase
      .from("bank_account_funds")
      .select("bank_connection_id, plaid_account_id, fund_id"),
    // Connected credit cards, by name, for the card-payment choices.
    supabase
      .from("bank_account_balances")
      .select("name, mask")
      .eq("account_type", "credit")
      .order("name"),
    // Every connected bank account, for the "which account" filter.
    supabase
      .from("bank_account_balances")
      .select("plaid_account_id, name, mask")
      .order("name"),
    supabase
      .from("bank_account_nicknames")
      .select("bank_connection_id, plaid_account_id, nickname"),
  ]);
  const isAdmin = isBoardAdminRes === true;
  // Categorizing and posting are also the Treasurer's duty (0076); connecting and syncing stay with admins.
  const { data: booksDuty } = associationId
    ? await supabase.rpc("has_duty", {
        p_association_id: associationId,
        p_duty: "books",
      })
    : { data: false };
  const canEdit = booksDuty === true || isAdmin;

  // Online dues (DECISIONS #57): Stripe payouts not yet in the books, each matched to its bank deposit.
  const stripePayouts = associationId ? await loadStripePayouts(supabase, associationId) : [];

  if (!connections) return <Restricted what="the bank feed" />;

  const counts: Record<Status, number> = {
    all: 0,
    sort: 0,
    needs: needsCount ?? 0,
    ready: readyCount ?? 0,
    posted: postedCount ?? 0,
    excluded: excludedCount ?? 0,
    retracted: retractedCount ?? 0,
  };
  counts.sort = counts.needs + counts.ready;
  counts.all =
    counts.needs +
    counts.ready +
    counts.posted +
    counts.excluded +
    counts.retracted;
  const retractedPosted = retractedPostedCount ?? 0;

  const status: Status =
    explicitStatus ??
    (account ? "all" : canEdit && counts.sort > 0 ? "sort" : "posted");
  const { data: rows } =
    status === firstStatus ? { data: firstRows } : await rowsFor(status);
  const transactions = (rows ?? []) as TransactionRecord[];
  // How many rows this status holds in total; "All" leaves out retracted rows that were never posted.
  const statusTotal =
    status === "all"
      ? counts.all - (counts.retracted - retractedPosted)
      : counts[status];
  // From the head count, not from an extra row: a request above max_rows comes back silently capped.
  const hasMore = statusTotal > transactions.length;
  const loadMoreHref =
    hasMore && limit < MAX_LIMIT
      ? hrefFor(q, range, status, sort, account, Math.min(limit * 2, MAX_LIMIT))
      : null;

  const active = connections.filter((c) => c.status !== "disconnected");
  // Plaid is an external call; start it now and stream the parts of the
  // page that need it, so a slow bank never holds up the transactions list.
  const balancesPromise: Promise<ConnectionBalance[]> =
    active.length > 0
      ? Promise.all(active.map((c) => getConnectionBalance(supabase, c.id)))
      : Promise.resolve([]);

  // Auto-sync on open: a board admin shouldn't have to remember "Sync now".
  // Runs after the response is sent, with autoPost: false — a page load is
  // not a click, so nothing reaches the ledger from here (DECISIONS #29).
  // Only on the landing render, and not again within the cooldown, so a
  // search or a filter never starts a second sync of the same cursor. Banks
  // marked 'error' are skipped: they want a sign-in, not a retry.
  // Admin only: the claim and the bank token are admin-only in the database, so for a Treasurer it would fail silently.
  const candidates =
    isAdmin && plainOpen
      ? active.filter(
          (c) =>
            c.status === "active" &&
            (!c.last_synced_at ||
              now.getTime() - new Date(c.last_synced_at).getTime() >
                STALE_SYNC_MS) &&
            now.getTime() - (autoSyncStartedAt.get(c.id) ?? 0) >
              AUTO_SYNC_COOLDOWN_MS,
        )
      : [];
  // The in-memory cooldown above is only a cheap first filter; the claim is what stops two instances (REVIEW-2 #28).
  const claimedAtIso = now.toISOString();
  const checking: typeof candidates = [];
  for (const c of candidates) {
    autoSyncStartedAt.set(c.id, now.getTime());
    if (await claimAutoSync(supabase, c, claimedAtIso)) checking.push(c);
  }
  if (checking.length > 0) {
    after(async () => {
      for (const c of checking) {
        try {
          const { token } = await readBankToken(supabase, c.id);
          if (!token) {
            await releaseAutoSync(supabase, c, claimedAtIso);
            continue;
          }
          const result = await syncOneConnection(supabase, c, token, {
            autoPost: false,
          });
          if ("error" in result) {
            await releaseAutoSync(supabase, c, claimedAtIso);
            console.warn(
              `Auto-sync of ${c.institution_name} failed: ${result.error}`,
            );
          }
        } catch (cause) {
          await releaseAutoSync(supabase, c, claimedAtIso);
          console.warn(
            `Auto-sync of ${c.institution_name} failed`,
            plaidErrorLog(cause),
          );
        }
      }
    });
  }

  const accountList = accounts ?? [];
  // Just the name: account codes are bookkeeping plumbing the board never needs to see.
  const label = (a: { name: string }) => a.name;
  const pickers: Pickers = {
    expenseAccounts: accountList
      .filter((a) => a.type === "expense")
      .map((a) => ({ id: a.id, label: label(a) })),
    incomeAccounts: accountList
      .filter((a) => a.type === "income")
      .map((a) => ({ id: a.id, label: label(a) })),
    cashAccounts: accountList
      .filter((a) => a.is_cash_account)
      .map((a) => ({ id: a.id, label: label(a) })),
    units: (units ?? []).map((u) => ({ id: u.id, label: u.label })),
    vendors: (vendors ?? []).map((v) => ({ id: v.id, label: v.name })),
    cardPayableId:
      accountList.find((a) => a.code === "2200" && a.type === "liability")
        ?.id ?? null,
    cardNames: (cardRows ?? []).map((c) =>
      c.mask ? `${c.name} ••${c.mask}` : (c.name as string),
    ),
  };
  const cashAccountByConnection = new Map(
    connections.map((c) => [c.id, c.cash_account_id as string | null]),
  );
  const accountLabelById = new Map(accountList.map((a) => [a.id, label(a)]));
  const accountNameById = new Map(accountList.map((a) => [a.id, a.name]));
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

  const expenseSuggestable = accountList
    .filter((a) => a.type === "expense")
    .map((a) => ({ id: a.id, name: a.name }));
  const incomeSuggestable = accountList
    .filter((a) => a.type === "income")
    .map((a) => ({ id: a.id, name: a.name }));

  const history = buildHistoryIndex((historyRows ?? []) as PayeeHistoryRow[]);
  const manualPayments = (manualPaymentRows ?? []) as ManualPayment[];

  function recommendationLabel(r: Recommendation): string {
    if (r.kind === "dues")
      return r.unitId
        ? `Dues · ${unitLabelById.get(r.unitId) ?? "unit"}`
        : "Dues";
    if (r.kind === "transfer") {
      if (r.accountId && r.accountId === pickers.cardPayableId)
        return "Credit card payment";
      const name = r.accountId ? accountNameById.get(r.accountId) : null;
      return name ? `Moved to ${name}` : "Transfer";
    }
    if (r.kind === "excluded") return KIND_LABEL.excluded;
    return accountNameById.get(r.accountId ?? "") ?? KIND_LABEL[r.kind];
  }

  const nicknameByAccount = new Map(
    (nicknameRows ?? []).map((n) => [
      n.plaid_account_id as string,
      n.nickname as string,
    ]),
  );
  const bankAccountChoices = (bankAccountRows ?? []).map((a) => ({
    id: a.plaid_account_id as string,
    label: `${nicknameByAccount.get(a.plaid_account_id as string) ?? a.name}${a.mask ? ` ••${a.mask}` : ""}`,
  }));
  const filtersActive =
    Boolean(q) || range !== "all" || Boolean(account) || Boolean(bank);
  const rulePatternById = new Map((rules ?? []).map((r) => [r.id, r.pattern]));

  // A deposit matched to a Stripe payout is posted only through "Confirm Stripe payout" above, which records
  // each unit's dues and the fee; categorizing it here as one lump would credit no unit.
  const stripeDepositIds = new Set(stripePayouts.flatMap((p) => (p.deposit ? [p.deposit.id] : [])));
  const transactionsWithSuggestions: SuggestedTransaction[] = transactions.filter((t) => !stripeDepositIds.has(t.id)).map(
    (t) => {
      // A categorized row is already in the payee tally, so its own amount is left out of "typical".
      const typicalCents = typicalAmountCents(t, history, {
        alreadyFiled: !!t.posting_kind,
      });
      const rulePattern = t.rule_id
        ? (rulePatternById.get(t.rule_id) ?? null)
        : null;
      const source_account_id =
        cashAccountByConnection.get(t.bank_connection_id as string) ?? null;
      if (t.posting_kind || t.journal_entry_id || t.removed_at)
        return {
          ...t,
          source_account_id,
          suggestion: null,
          typicalCents,
          rulePattern,
        };
      const r = recommend(
        t,
        history,
        { expense: expenseSuggestable, income: incomeSuggestable },
        { manualPayments, cardPayableId: pickers.cardPayableId },
      );
      return {
        ...t,
        source_account_id,
        typicalCents,
        rulePattern,
        suggestion: r
          ? {
              kind: r.kind,
              accountId: r.accountId,
              unitId: r.unitId,
              label: recommendationLabel(r),
              reason: r.reason,
              needsPick: r.needsPick,
              trusted: r.trusted,
              source: r.source,
              alternatives: r.alternatives?.map((a) => ({
                kind: a.kind,
                accountId: a.accountId,
                unitId: a.unitId,
              })),
            }
          : null,
      };
    },
  );

  // Progress through the queue: everything the bank still stands behind,
  // minus what hasn't been given a category yet.
  const progressTotal = counts.all - counts.retracted;
  const progressDone = Math.max(0, progressTotal - counts.sort);
  const progressPct =
    progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  // The finish line: a board admin opened the tab with nothing left to categorize.
  const caughtUp =
    canEdit && explicitStatus === null && counts.sort === 0 && counts.all > 0;

  const ruleRecords: RuleRecord[] = (rules ?? []).map((r) => ({
    id: r.id,
    pattern: r.pattern,
    kindLabel: KIND_LABEL[r.posting_kind] ?? r.posting_kind,
    target:
      r.posting_kind === "dues"
        ? (unitLabelById.get(r.matched_unit_id ?? "") ?? null)
        : (accountLabelById.get(r.account_id ?? "") ?? null),
    auto_post: r.auto_post,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          Bank feed
        </h1>
        <p className="mt-1 text-mute">
          Your bank activity becomes your books. Sort each transaction once and
          your ledger, budget, dues, and reports update automatically.
        </p>
      </div>

      {active.length === 0 ? (
        <Card
          navy
          title="Connect a bank account"
          hint="Transactions flow in automatically; you categorize them and they post to the books."
        >
          <div className="mb-4 space-y-2 text-[13px] leading-relaxed text-mute">
            <p>
              Walkup uses Plaid to connect to your bank. You sign in at your
              bank, through Plaid. Walkup never sees or stores your bank
              password.
            </p>
            <p>
              Once connected, Walkup reads your account names, the last four
              digits, balances, and up to two years of transactions, only to
              keep the association&rsquo;s books. It cannot move money. A board
              admin can disconnect at any time, which closes the connection at
              Plaid. Transactions already imported stay in the
              association&rsquo;s books.
            </p>
            <p>
              See our{" "}
              <Link
                href="/privacy"
                className="text-ink underline underline-offset-2"
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <a
                href="https://plaid.com/legal/#end-user-privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2"
              >
                Plaid&rsquo;s End User Privacy Policy
              </a>
              .
            </p>
          </div>
          {isAdmin ? (
            <ConnectBankButton />
          ) : (
            <p className="text-[13px] font-medium text-ink">
              A board admin connects the bank account.
            </p>
          )}
        </Card>
      ) : null}

      {active.length > 0 ? (
        <Suspense fallback={<BankAccountsSkeleton />}>
          <BankAccountsSection
            balancesPromise={balancesPromise}
            active={active}
            canEdit={canEdit}
            isAdmin={isAdmin}
            cashAccounts={pickers.cashAccounts}
            checkingIds={checking.map((c) => c.id)}
            fundChoices={(fundRows ?? []).map((f) => ({
              id: f.id as string,
              label:
                f.kind === "reserve"
                  ? "Savings (Reserve Fund)"
                  : f.kind === "operating"
                    ? "Day-to-day (operating)"
                    : (f.name as string),
              kind: f.kind as string,
            }))}
            nicknames={Object.fromEntries(
              (nicknameRows ?? []).map((n) => [
                `${n.bank_connection_id}:${n.plaid_account_id}`,
                n.nickname as string,
              ]),
            )}
            accountFunds={Object.fromEntries(
              (accountFundRows ?? []).map((o) => [
                `${o.bank_connection_id}:${o.plaid_account_id}`,
                o.fund_id as string,
              ]),
            )}
          />
        </Suspense>
      ) : null}

      {counts.all > 0 || active.length > 0 ? (
        <>
          {retractedPosted > 0 ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
              The bank retracted {retractedPosted} transaction
              {retractedPosted === 1 ? "" : "s"} that{" "}
              {retractedPosted === 1 ? "was" : "were"} already posted. Review{" "}
              {retractedPosted === 1 ? "it" : "them"} under the “Retracted”
              filter and undo the posting if the bank was right.
            </p>
          ) : null}

          {stripePayouts.length > 0 ? <StripePayoutsCard payouts={stripePayouts} canPost={canEdit} /> : null}

          <Card
            navy
            title="Transactions"
            action={<TransactionsHelp />}
            hint={
              canEdit && counts.sort > 0
                ? "Pick a category for each transaction and post it to your books. You can undo anything for 10 seconds."
                : "Categorize, then post. Posted rows are in the books."
            }
          >
            {caughtUp ? (
              <div className="mb-4 rounded-lg border border-good-line bg-good-tint px-4 py-3">
                <p className="text-[13px] font-medium text-good-text">
                  Nothing waiting. You&rsquo;re caught up.
                </p>
                <p className="mt-1 text-[12px] text-good-text">
                  <span className="figures">{counts.posted}</span> in the books
                </p>
                <Link
                  href="/financial-statements"
                  className="mt-1 inline-flex min-h-[44px] items-center text-[12px] font-medium text-good-text underline-offset-2 hover:underline"
                >
                  See the financial statements →
                </Link>
              </div>
            ) : null}

            {/* Row 1: the two tabs and how far along (N of M sorted). */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {MAIN_STATUSES.map((s) => (
                  <Link
                    key={s}
                    href={hrefFor(q, range, s, sort, account)}
                    aria-current={status === s ? "page" : undefined}
                    className={status === s ? PILL_ACTIVE : PILL}
                  >
                    {STATUS_LABEL[s]}
                    {counts[s] > 0 ? ` · ${counts[s]}` : ""}
                  </Link>
                ))}
              </div>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-3">
                  {counts.sort > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-[13px] text-ink">
                        <span className="figures font-medium">
                          {progressDone}
                        </span>{" "}
                        <span className="text-[12px] text-mute">of</span>{" "}
                        <span className="figures font-medium">
                          {progressTotal}
                        </span>{" "}
                        <span className="text-[12px] text-mute">sorted</span>
                      </span>
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={progressTotal}
                        aria-valuenow={progressDone}
                        className="h-1.5 w-[120px] overflow-hidden rounded-full bg-fill"
                      >
                        <div
                          className="h-full rounded-full bg-moss transition-[width] duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Row 2: search and range, always showing, with the rules tucked at its right. */}
            <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-2">
              <FiltersBar
                current={{ q, range, status, sort, account, from, to, bank }}
                bankAccounts={bankAccountChoices}
                accountLabel={
                  account ? (accountNameById.get(account) ?? null) : null
                }
              />
              <RulesToggle rules={ruleRecords} canEdit={canEdit} />
            </div>

            {transactions.length === 0 ? (
              <Empty>
                {filtersActive
                  ? "No transactions match this filter."
                  : status === "sort"
                    ? "Nothing to sort."
                    : status === "excluded"
                      ? "Nothing kept out of the books yet."
                      : status !== "all"
                        ? `Nothing ${STATUS_LABEL[status].toLowerCase()} yet.`
                        : checking.length > 0
                          ? "Checking the bank for transactions now. Reload in a minute."
                          : "No transactions synced yet. Click “Sync now” above."}
              </Empty>
            ) : (
              <>
                <TransactionsTable
                  transactions={transactionsWithSuggestions}
                  pickers={pickers}
                  canEdit={canEdit}
                  sort={sort}
                  dateHref={hrefFor(
                    q,
                    range,
                    status,
                    nextSort(sort, "date"),
                    account,
                    limit,
                  )}
                  nameHref={hrefFor(
                    q,
                    range,
                    status,
                    nextSort(sort, "name"),
                    account,
                    limit,
                  )}
                  amountHref={hrefFor(
                    q,
                    range,
                    status,
                    nextSort(sort, "amount"),
                    account,
                    limit,
                  )}
                />
                {hasMore ? (
                  <p className="mt-4 text-center text-[12px] text-mute">
                    Showing {sort === "date_desc" ? "the latest " : ""}
                    <span className="figures text-ink">
                      {transactions.length}
                    </span>{" "}
                    of <span className="figures">{statusTotal}</span>
                    {loadMoreHref ? (
                      <>
                        {" · "}
                        <Link
                          href={loadMoreHref}
                          scroll={false}
                          className="inline-flex min-h-[44px] items-center font-medium text-ink underline-offset-2 hover:underline"
                        >
                          {sort === "date_desc" ? "Load earlier" : "Load more"}
                        </Link>
                      </>
                    ) : (
                      " · narrow the range or search to see the rest"
                    )}
                  </p>
                ) : null}
              </>
            )}

            {/* The two small piles that are neither to sort nor posted, one quiet line instead of a menu. */}
            {counts.excluded > 0 || counts.retracted > 0 ? (
              <p className="mt-4 text-[12px] text-mute">
                Also:{" "}
                {(["excluded", "retracted"] as const)
                  .filter((s) => counts[s] > 0)
                  .map((s, i) => (
                    <span key={s}>
                      {i > 0 ? " · " : ""}
                      <Link
                        href={hrefFor(q, range, s, sort, account)}
                        className="inline-flex min-h-[44px] items-center underline underline-offset-2 hover:text-ink sm:min-h-0"
                      >
                        {STATUS_LABEL[s]} · {counts[s]}
                      </Link>
                    </span>
                  ))}
              </p>
            ) : null}
          </Card>
        </>
      ) : null}
    </div>
  );
}
