import Link from "next/link";
import { Suspense } from "react";
import { after } from "next/server";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { ConnectBankButton } from "./connect-bank-button";
import { TransactionsHelp } from "./transactions-help";
import { type Pickers, type TransactionRecord } from "./transaction-row";
import { TransactionsTable, type SuggestedTransaction } from "./transactions-table";
import { PostAllButton } from "./post-all-button";
import { FiltersBar } from "./filters-bar";
import type { PreviewRow } from "./post-preview";
import { DEFAULT_LIMIT, MAX_LIMIT, bankFeedHref, type Range, type Sort, type Status } from "./href";
import {
  BankAccountsSection,
  BankAccountsSkeleton,
  ReconnectNotice,
  getConnectionBalance,
  type ConnectionBalance,
  type MoneyFlow,
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
import { syncOneConnection } from "@/lib/plaid/sync";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  needs: "Needs category",
  ready: "Ready to post",
  posted: "Posted",
  excluded: "Excluded",
  retracted: "Retracted",
};

/** The pills a treasurer works from; Excluded and Retracted sit behind "More". */
const MAIN_STATUSES: Status[] = ["all", "needs", "ready", "posted"];

const PILL_ACTIVE = "rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-paper";
const PILL = "rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink hover:bg-fill";
/** "Ready to post" with rows saved for later: the next thing to do, so it is brass-tinted. */
const PILL_WAITING =
  "rounded-full border border-warning-line bg-warning-tint px-3 py-1 text-[12px] font-medium text-warning-text hover:brightness-95";

const KIND_LABEL: Record<string, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

/** A bank last synced longer ago than this gets a sync kicked off when a board admin opens the page. */
const STALE_SYNC_MS = 12 * 60 * 60 * 1000;

const TRANSACTION_COLUMNS =
  "id, posted_on, description, amount, pending, raw_category, posting_kind, account_id, matched_unit_id, vendor_id, journal_entry_id, excluded_at, removed_at, rule_id";

const ORDER: Record<Sort, { column: string; ascending: boolean }> = {
  date_desc: { column: "posted_on", ascending: false },
  date_asc: { column: "posted_on", ascending: true },
  name_asc: { column: "description", ascending: true },
  name_desc: { column: "description", ascending: false },
  amount_desc: { column: "amount", ascending: false },
  amount_asc: { column: "amount", ascending: true },
};

function rangeStart(range: Range): string | null {
  const now = new Date();
  if (range === "this_month") {
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (range === "last_30") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
  return null;
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
  eq(column: string, value: string): Chain;
  is(column: string, value: null | boolean): Chain;
  not(column: string, operator: string, value: unknown): Chain;
  or(filters: string): Chain;
}

interface Filters {
  q?: string;
  start: string | null;
  account?: string;
}

/** Search, range and category filters — the same ones on every query so the counts and the rows agree. */
function scoped<T>(query: T, f: Filters): T {
  let q = query as unknown as Chain;
  if (f.q) q = q.ilike("description", `%${f.q}%`);
  if (f.start) q = q.gte("posted_on", f.start);
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
        return q.not("excluded_at", "is", null).is("journal_entry_id", null).is("removed_at", null);
      case "ready":
        return q
          .not("posting_kind", "is", null)
          .is("excluded_at", null)
          .is("journal_entry_id", null)
          .is("removed_at", null);
      case "needs":
        return q.is("posting_kind", null).is("excluded_at", null).is("journal_entry_id", null).is("removed_at", null);
      case "all":
        return q.or("removed_at.is.null,journal_entry_id.not.is.null");
    }
  })();
  return filtered as unknown as T;
}

function hrefFor(
  q: string | undefined,
  range: Range,
  status: Status,
  sort: Sort,
  account?: string,
  limit: number = DEFAULT_LIMIT,
): string {
  return bankFeedHref({ q, range, status, sort, account, limit });
}

function nextSort(current: Sort, column: "date" | "name" | "amount"): Sort {
  if (column === "date") return current === "date_desc" ? "date_asc" : "date_desc";
  if (column === "name") return current === "name_asc" ? "name_desc" : "name_asc";
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
    limit?: string;
  }>;
}) {
  const {
    q,
    range: rangeParam,
    status: statusParam,
    sort: sortParam,
    account: accountParam,
    limit: limitParam,
  } = await searchParams;
  // From the Budget page: "see the transactions behind this category".
  const account = accountParam?.trim() || undefined;
  const range: Range =
    rangeParam === "this_month" || rangeParam === "last_30" ? rangeParam : "all";
  // No status in the URL means "show me what needs doing" when there is any.
  const explicitStatus: Status | null =
    statusParam && statusParam in STATUS_LABEL ? (statusParam as Status) : null;
  const SORTS: Sort[] = ["date_desc", "date_asc", "name_asc", "name_desc", "amount_desc", "amount_asc"];
  const sort: Sort = sortParam && SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : "date_desc";
  const parsedLimit = Number.parseInt(limitParam ?? "", 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;

  const supabase = await createClient();

  // Two round trips to the database, no more, in the common case: the
  // association row first (the role check needs its id), then everything
  // else at once. A third happens only when the default status turns out
  // to be "all" rather than "needs category".
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id ?? null;

  const filters: Filters = { q, start: rangeStart(range), account };
  const countFor = (status: Status) =>
    withStatus(scoped(supabase.from("bank_transactions").select("id", { count: "exact", head: true }), filters), status);
  // One more than the page shows, so the page knows whether there is more.
  const rowsFor = (status: Status) =>
    withStatus(scoped(supabase.from("bank_transactions").select(TRANSACTION_COLUMNS), filters), status)
      .order(ORDER[sort].column, { ascending: ORDER[sort].ascending })
      .order("id")
      .limit(limit + 1);
  // The best first guess at the status to show; corrected below if needed.
  const firstStatus: Status = explicitStatus ?? (account ? "all" : "needs");
  const now = new Date();
  const since45Days = new Date(now.getTime() - 45 * 86_400_000).toISOString().slice(0, 10);
  // In and out for the bank card: this month unless a range is chosen. Always
  // a bounded period, so it is a few hundred rows at most, never the whole history.
  const flowRange: Range = range === "last_30" ? "last_30" : "this_month";
  const flowPeriod = flowRange === "last_30" ? "in the last 30 days" : "this month";

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
    { count: settledReadyCount },
    { count: retractedPostedCount },
    // History persists across disconnects — a disconnected bank's
    // transactions are still in the books, so they still show here.
    { data: firstRows },
    { data: readyRows },
    { data: flowRows },
  ] = await Promise.all([
    associationId
      ? supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] })
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
      .select("id, pattern, posting_kind, account_id, matched_unit_id, auto_post")
      .order("created_at"),
    // What this board filed each payee as before — the strongest source for
    // the "Recommended" chip. A trigger-maintained tally (0046), one row per
    // payee and choice, instead of re-reading every categorized transaction.
    supabase
      .from("bank_payee_history")
      .select("payee_key, direction, posting_kind, account_id, matched_unit_id, count, amount_cents_total"),
    supabase
      .from("bank_connections")
      .select("id, association_id, institution_name, status, last_synced_at, sync_cursor, cash_account_id")
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
    countFor("ready").eq("pending", false),
    countFor("retracted").not("journal_entry_id", "is", null),
    rowsFor(firstStatus),
    // What "Post all ready" would post, so the button can say how much and
    // flag anything unusual before it does. Ignores the filters on purpose:
    // the action posts everything ready, not just what is on screen.
    withStatus(supabase.from("bank_transactions").select("id, description, amount"), "ready")
      .eq("pending", false)
      .order("posted_on")
      .limit(MAX_LIMIT),
    supabase
      .from("bank_transactions")
      .select("amount")
      .is("removed_at", null)
      .gte("posted_on", rangeStart(flowRange) ?? "")
      .limit(MAX_LIMIT),
  ]);
  const canEdit = isBoardAdminRes === true;

  if (!connections) return <Restricted what="the bank feed" />;

  const counts: Record<Status, number> = {
    all: 0,
    needs: needsCount ?? 0,
    ready: readyCount ?? 0,
    posted: postedCount ?? 0,
    excluded: excludedCount ?? 0,
    retracted: retractedCount ?? 0,
  };
  counts.all = counts.needs + counts.ready + counts.posted + counts.excluded + counts.retracted;
  const settledReady = settledReadyCount ?? 0;
  const retractedPosted = retractedPostedCount ?? 0;

  const status: Status = explicitStatus ?? (canEdit && counts.needs > 0 && !account ? "needs" : "all");
  const { data: rows } = status === firstStatus ? { data: firstRows } : await rowsFor(status);
  const loaded = (rows ?? []) as TransactionRecord[];
  const hasMore = loaded.length > limit;
  const transactions = hasMore ? loaded.slice(0, limit) : loaded;
  // How many rows this status holds in total; "All" leaves out retracted rows that were never posted.
  const statusTotal = status === "all" ? counts.all - (counts.retracted - retractedPosted) : counts[status];
  const loadMoreHref =
    hasMore && limit < MAX_LIMIT ? hrefFor(q, range, status, sort, account, Math.min(limit * 2, MAX_LIMIT)) : null;

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
  // Banks marked 'error' are skipped: they want a sign-in, not a retry.
  const checking = canEdit
    ? active.filter(
        (c) =>
          c.status === "active" &&
          (!c.last_synced_at || now.getTime() - new Date(c.last_synced_at).getTime() > STALE_SYNC_MS),
      )
    : [];
  if (checking.length > 0) {
    after(async () => {
      for (const c of checking) {
        try {
          const { data: token } = await supabase.rpc("get_bank_access_token", { p_connection_id: c.id });
          if (!token) continue;
          const result = await syncOneConnection(supabase, c, token, { autoPost: false });
          if ("error" in result) console.warn(`Auto-sync of ${c.institution_name} failed: ${result.error}`);
        } catch (cause) {
          console.warn(`Auto-sync of ${c.institution_name} failed`, cause);
        }
      }
    });
  }

  const accountList = accounts ?? [];
  const label = (a: { code: string; name: string }) => `${a.code} ${a.name}`;
  const pickers: Pickers = {
    expenseAccounts: accountList.filter((a) => a.type === "expense").map((a) => ({ id: a.id, label: label(a) })),
    incomeAccounts: accountList.filter((a) => a.type === "income").map((a) => ({ id: a.id, label: label(a) })),
    cashAccounts: accountList.filter((a) => a.is_cash_account).map((a) => ({ id: a.id, label: label(a) })),
    units: (units ?? []).map((u) => ({ id: u.id, label: u.label })),
    vendors: (vendors ?? []).map((v) => ({ id: v.id, label: v.name })),
  };
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
    if (r.kind === "dues") return r.unitId ? `Dues · ${unitLabelById.get(r.unitId) ?? "unit"}` : "Dues";
    if (r.kind === "transfer") {
      const name = r.accountId ? accountNameById.get(r.accountId) : null;
      return name ? `Transfer · ${name}` : "Transfer";
    }
    if (r.kind === "excluded") return KIND_LABEL.excluded;
    return accountNameById.get(r.accountId ?? "") ?? KIND_LABEL[r.kind];
  }

  const filtersActive = Boolean(q) || range !== "all" || Boolean(account);
  // The "More ▾" pill names the status when one of the two behind it is showing.
  const moreOpen = status === "excluded" || status === "retracted";
  const rulePatternById = new Map((rules ?? []).map((r) => [r.id, r.pattern]));

  const transactionsWithSuggestions: SuggestedTransaction[] = transactions.map((t) => {
    // A categorized row is already in the payee tally, so its own amount is left out of "typical".
    const typicalCents = typicalAmountCents(t, history, { alreadyFiled: !!t.posting_kind });
    const rulePattern = t.rule_id ? (rulePatternById.get(t.rule_id) ?? null) : null;
    if (t.posting_kind || t.journal_entry_id || t.removed_at) return { ...t, suggestion: null, typicalCents, rulePattern };
    const r = recommend(t, history, { expense: expenseSuggestable, income: incomeSuggestable }, { manualPayments });
    return {
      ...t,
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
            source: r.source,
          }
        : null,
    };
  });

  const readyPreview: PreviewRow[] = (readyRows ?? []).map((r) => ({
    id: r.id,
    description: r.description,
    amount: r.amount,
    typicalCents: typicalAmountCents(r, history, { alreadyFiled: true }),
  }));

  // Progress through the queue: everything the bank still stands behind,
  // minus what hasn't been given a category yet.
  const progressTotal = counts.all - counts.retracted;
  const progressDone = Math.max(0, progressTotal - counts.needs);
  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  // The finish line: a board admin opened the tab with nothing left to categorize.
  const caughtUp = canEdit && explicitStatus === null && counts.needs === 0 && counts.all > 0;

  // What moved through the bank over the period, for the line under the total.
  const flow: MoneyFlow | undefined =
    flowRows && flowRows.length > 0
      ? {
          in: flowRows.reduce((s, r) => s + Math.max(0, Number(r.amount)), 0),
          out: flowRows.reduce((s, r) => s + Math.max(0, -Number(r.amount)), 0),
          period: flowPeriod,
        }
      : undefined;

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
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Bank feed</h1>
        <p className="mt-1 text-mute">
          What your bank reports is how the books get written. Categorize each transaction once
          and post it — the ledger, budget, dues balances, and financial statements all follow.
        </p>
      </div>

      {active.length === 0 ? (
        <Card
          navy
          title="Connect a bank account"
          hint="Transactions flow in automatically; you categorize them and they post to the books."
        >
          <p className="mb-4 text-[13px] leading-relaxed text-mute">
            Walkup uses Plaid to connect securely. Your bank password is never seen or stored by
            Walkup — only a read-only token that can show transactions. Nothing here can move
            money.
          </p>
          <ConnectBankButton />
        </Card>
      ) : null}

      {active.length > 0 ? (
        <Suspense fallback={<BankAccountsSkeleton />}>
          <BankAccountsSection
            balancesPromise={balancesPromise}
            active={active}
            canEdit={canEdit}
            cashAccounts={pickers.cashAccounts}
            checkingIds={checking.map((c) => c.id)}
            flow={flow}
          />
        </Suspense>
      ) : null}

      {counts.all > 0 || active.length > 0 ? (
        <>
          {retractedPosted > 0 ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
              The bank retracted {retractedPosted} transaction{retractedPosted === 1 ? "" : "s"} that{" "}
              {retractedPosted === 1 ? "was" : "were"} already posted. Review{" "}
              {retractedPosted === 1 ? "it" : "them"} under the “Retracted” filter and undo the posting
              if the bank was right.
            </p>
          ) : null}

          <Card
            navy
            title="Transactions"
            action={<TransactionsHelp />}
            hint={
              canEdit && counts.needs > 0
                ? "Click a recommendation to post it, or Categorize and start typing. Undo for 10 seconds after each."
                : "Categorize, then post. Posted rows are in the books."
            }
          >
            <Suspense fallback={null}>
              <ReconnectNotice balancesPromise={balancesPromise} active={active} canEdit={canEdit} />
            </Suspense>

            {caughtUp ? (
              <div className="mb-4 rounded-lg border border-good-line bg-good-tint px-4 py-3">
                <p className="text-[13px] font-medium text-good-text">Nothing waiting — you&rsquo;re caught up.</p>
                <p className="mt-1 text-[12px] text-good-text">
                  <span className="figures">{counts.posted}</span> in the books
                </p>
                {settledReady > 0 ? (
                  <p className="mt-1 text-[12px] text-good-text">
                    {settledReady} categorized and ready — post {settledReady === 1 ? "it" : "them"} to finish.
                  </p>
                ) : (
                  <Link
                    href="/financial-statements"
                    className="mt-1 inline-block text-[12px] font-medium text-good-text underline-offset-2 hover:underline"
                  >
                    See the financial statements →
                  </Link>
                )}
              </div>
            ) : null}

            {/* Row 1: where you are (status pills) and how far along (N to go, Post what's saved). */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {MAIN_STATUSES.map((s) => (
                  <Link
                    key={s}
                    href={hrefFor(q, range, s, sort, account)}
                    className={status === s ? PILL_ACTIVE : s === "ready" && counts.ready > 0 ? PILL_WAITING : PILL}
                  >
                    {STATUS_LABEL[s]}
                    {s !== "all" && counts[s] > 0 ? ` · ${counts[s]}` : ""}
                  </Link>
                ))}
                <details className="relative">
                  <summary
                    className={`${moreOpen ? PILL_ACTIVE : PILL} inline-flex cursor-pointer select-none list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}
                  >
                    {moreOpen ? STATUS_LABEL[status] : "More"}
                    <ChevronDown size={12} strokeWidth={1.6} aria-hidden="true" />
                  </summary>
                  <div className="absolute left-0 top-full z-20 mt-1 flex min-w-[11rem] flex-col rounded-lg border border-line bg-paper p-1 shadow-lg">
                    {(["excluded", "retracted"] as const)
                      .filter((s) => s === "excluded" || counts.retracted > 0)
                      .map((s) => (
                        <Link
                          key={s}
                          href={hrefFor(q, range, s, sort, account)}
                          className={`rounded-md px-2.5 py-1.5 text-[12px] hover:bg-fill ${status === s ? "font-medium text-ink" : "text-ink"}`}
                        >
                          {STATUS_LABEL[s]}
                          {counts[s] > 0 ? ` · ${counts[s]}` : ""}
                        </Link>
                      ))}
                  </div>
                </details>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-3">
                  {counts.needs > 0 ? (
                    <div className="flex items-center gap-2" aria-label={`${progressDone} of ${progressTotal} categorized`}>
                      <span className="whitespace-nowrap text-[13px] text-ink">
                        <span className="figures font-medium">{counts.needs}</span>{" "}
                        <span className="text-[12px] text-mute">to go</span>
                      </span>
                      <div
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={progressTotal}
                        aria-valuenow={progressDone}
                        className="h-1.5 w-[120px] overflow-hidden rounded-full bg-fill"
                      >
                        <div
                          className="h-full rounded-full bg-brass transition-[width] duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <PostAllButton readyCount={settledReady} preview={readyPreview} />
                </div>
              ) : null}
            </div>

            {/* Row 2: filter & search, with the rules tucked at its right. */}
            <div className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-2">
              <FiltersBar
                current={{ q, range, status, sort, account }}
                accountLabel={account ? (accountNameById.get(account) ?? null) : null}
              />
              <RulesToggle rules={ruleRecords} canEdit={canEdit} />
            </div>

            {transactions.length === 0 ? (
              <Empty>
                {filtersActive
                  ? "No transactions match this filter."
                  : status === "needs"
                    ? "Nothing needs a category."
                    : status !== "all"
                      ? `Nothing ${STATUS_LABEL[status].toLowerCase()} yet.`
                      : checking.length > 0
                        ? "Checking the bank for transactions now — refresh in a moment."
                        : "No transactions synced yet. Click “Sync now” above."}
              </Empty>
            ) : (
              <>
                <TransactionsTable
                  transactions={transactionsWithSuggestions}
                  pickers={pickers}
                  canEdit={canEdit}
                  sort={sort}
                  dateHref={hrefFor(q, range, status, nextSort(sort, "date"), account, limit)}
                  nameHref={hrefFor(q, range, status, nextSort(sort, "name"), account, limit)}
                  amountHref={hrefFor(q, range, status, nextSort(sort, "amount"), account, limit)}
                />
                {hasMore ? (
                  <p className="mt-4 text-center text-[12px] text-mute">
                    Showing {sort === "date_desc" ? "the latest " : ""}
                    <span className="figures text-ink">{transactions.length}</span> of{" "}
                    <span className="figures">{statusTotal}</span>
                    {loadMoreHref ? (
                      <>
                        {" · "}
                        <Link href={loadMoreHref} className="font-medium text-ink underline-offset-2 hover:underline">
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
          </Card>
        </>
      ) : null}
    </div>
  );
}
