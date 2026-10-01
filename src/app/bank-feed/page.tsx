import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { syncedAgo } from "@/lib/dates";
import { plaidClient, describePlaidError } from "@/lib/plaid";
import { ConnectBankButton } from "./connect-bank-button";
import { TransactionsHelp } from "./transactions-help";
import { SyncButton } from "./sync-button";
import { DisconnectButton } from "./disconnect-button";
import { type Pickers, type TransactionRecord } from "./transaction-row";
import { TransactionsTable, type SuggestedTransaction } from "./transactions-table";
import { PostAllButton } from "./post-all-button";
import { LedgerAccountSelect } from "./ledger-account-select";
import { RulesList, type RuleRecord } from "./rules-list";
import { buildHistoryIndex, recommend, type HistoryRow, type Recommendation } from "@/lib/plaid/recommend";

export const dynamic = "force-dynamic";

type Range = "this_month" | "last_30" | "all";
type Status = "all" | "needs" | "ready" | "posted" | "excluded" | "retracted";
type Sort = "date_desc" | "date_asc" | "name_asc" | "name_desc" | "amount_desc" | "amount_asc";

const STATUS_LABEL: Record<Status, string> = {
  all: "All",
  needs: "Needs category",
  ready: "Ready to post",
  posted: "Posted",
  excluded: "Excluded",
  retracted: "Retracted",
};

const KIND_LABEL: Record<string, string> = {
  expense: "Expense",
  income: "Other income",
  dues: "Dues",
  transfer: "Transfer",
  excluded: "Not for the books",
};

const ACCOUNT_TYPE_ORDER = ["depository", "credit", "loan", "investment", "other"];
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  credit: "Owed",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};

interface ConnectionBalance {
  connectionId: string;
  accounts: {
    name: string;
    mask: string | null;
    currentCents: number | null;
    /** Plaid's account type: depository (checking/savings/CD/money market), credit, loan, investment. */
    type: string;
  }[];
  error?: string;
}

/**
 * Live balance, straight from Plaid — not derived from bank_transactions and
 * never written anywhere. Purely a display fetch.
 */
async function getConnectionBalance(
  supabase: Awaited<ReturnType<typeof createClient>>,
  connectionId: string,
): Promise<ConnectionBalance> {
  const { data: accessToken, error: tokenError } = await supabase.rpc(
    "get_bank_access_token",
    { p_connection_id: connectionId },
  );
  if (tokenError || !accessToken) {
    return { connectionId, accounts: [], error: tokenError?.message ?? "No access token on file." };
  }

  try {
    const response = await plaidClient().accountsBalanceGet({ access_token: accessToken });
    return {
      connectionId,
      accounts: response.data.accounts.map((a) => ({
        name: a.name,
        mask: a.mask,
        type: String(a.type),
        currentCents:
          a.balances.current !== null && a.balances.current !== undefined
            ? Math.round(a.balances.current * 100)
            : null,
      })),
    };
  } catch (cause) {
    console.error("Plaid accountsBalanceGet failed", cause);
    return { connectionId, accounts: [], error: describePlaidError(cause) };
  }
}

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

function statusOf(t: TransactionRecord): Status {
  if (t.removed_at) return "retracted";
  if (t.journal_entry_id) return "posted";
  if (t.excluded_at) return "excluded";
  if (t.posting_kind) return "ready";
  return "needs";
}

function hrefFor(q: string | undefined, range: Range, status: Status, sort: Sort, account?: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (account) params.set("account", account);
  if (range !== "all") params.set("range", range);
  if (status !== "all") params.set("status", status);
  if (sort !== "date_desc") params.set("sort", sort);
  const qs = params.toString();
  return `/bank-feed${qs ? `?${qs}` : ""}`;
}

function nextSort(current: Sort, column: "date" | "name" | "amount"): Sort {
  if (column === "date") return current === "date_desc" ? "date_asc" : "date_desc";
  if (column === "name") return current === "name_asc" ? "name_desc" : "name_asc";
  return current === "amount_desc" ? "amount_asc" : "amount_desc";
}

function compareBySort(a: TransactionRecord, b: TransactionRecord, sort: Sort): number {
  switch (sort) {
    case "name_asc":
      return a.description.localeCompare(b.description);
    case "name_desc":
      return b.description.localeCompare(a.description);
    case "amount_asc":
      return Number(a.amount) - Number(b.amount);
    case "amount_desc":
      return Number(b.amount) - Number(a.amount);
    case "date_asc":
      return a.posted_on.localeCompare(b.posted_on);
    case "date_desc":
    default:
      return b.posted_on.localeCompare(a.posted_on);
  }
}

export default async function BankFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string; status?: string; sort?: string; account?: string }>;
}) {
  const { q, range: rangeParam, status: statusParam, sort: sortParam, account: accountParam } = await searchParams;
  // From the Budget page: "see the transactions behind this category".
  const account = accountParam?.trim() || undefined;
  const range: Range =
    rangeParam === "this_month" || rangeParam === "last_30" ? rangeParam : "all";
  // No status in the URL means "show me what needs doing" when there is any.
  const explicitStatus: Status | null =
    statusParam && statusParam in STATUS_LABEL ? (statusParam as Status) : null;
  const SORTS: Sort[] = ["date_desc", "date_asc", "name_asc", "name_desc", "amount_desc", "amount_asc"];
  const sort: Sort = sortParam && SORTS.includes(sortParam as Sort) ? (sortParam as Sort) : "date_desc";

  const supabase = await createClient();

  const { data: connections } = await supabase
    .from("bank_connections")
    .select("id, institution_name, status, last_synced_at, cash_account_id")
    .order("created_at", { ascending: false });

  if (!connections) return <Restricted what="the bank feed" />;

  const active = connections.filter((c) => c.status !== "disconnected");

  const [
    { data: associations },
    { data: units },
    { data: accounts },
    { data: vendors },
    { data: rules },
    { data: historyRows },
  ] = await Promise.all([
    supabase.from("associations").select("id").limit(1),
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
    // the "Recommended" chip. Read-only; recommendations are never saved.
    supabase
      .from("bank_transactions")
      .select("description, amount, posting_kind, account_id, matched_unit_id")
      .not("posting_kind", "is", null)
      .is("removed_at", null)
      .order("posted_on", { ascending: false })
      .limit(2000),
  ]);
  const associationId = associations?.[0]?.id ?? null;
  const { data: isBoardAdminRes } = associationId
    ? await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] })
    : { data: false };
  const canEdit = isBoardAdminRes === true;

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

  const history = buildHistoryIndex((historyRows ?? []) as HistoryRow[]);

  function recommendationLabel(r: Recommendation): string {
    if (r.kind === "dues") return r.unitId ? `Dues · ${unitLabelById.get(r.unitId) ?? "unit"}` : "Dues";
    if (r.kind === "transfer") {
      const name = r.accountId ? accountNameById.get(r.accountId) : null;
      return name ? `Transfer · ${name}` : "Transfer";
    }
    if (r.kind === "excluded") return KIND_LABEL.excluded;
    return accountNameById.get(r.accountId ?? "") ?? KIND_LABEL[r.kind];
  }

  let transactionsQuery = supabase
    .from("bank_transactions")
    .select(
      "id, posted_on, description, amount, pending, raw_category, posting_kind, account_id, matched_unit_id, vendor_id, journal_entry_id, excluded_at, removed_at",
    )
    .order("posted_on", { ascending: false })
    .limit(500);
  if (q) transactionsQuery = transactionsQuery.ilike("description", `%${q}%`);
  const start = rangeStart(range);
  if (start) transactionsQuery = transactionsQuery.gte("posted_on", start);

  // History persists across disconnects — a disconnected bank's transactions
  // are still in the books, so they still show here.
  const { data: transactionRows } = await transactionsQuery;
  const allTransactions = ((transactionRows ?? []) as TransactionRecord[]).filter(
    (t) => !account || t.account_id === account,
  );

  const counts: Record<Status, number> = { all: 0, needs: 0, ready: 0, posted: 0, excluded: 0, retracted: 0 };
  for (const t of allTransactions) {
    counts.all += 1;
    counts[statusOf(t)] += 1;
  }
  const status: Status = explicitStatus ?? (canEdit && counts.needs > 0 && !account ? "needs" : "all");
  const filtersActive = Boolean(q) || range !== "all" || Boolean(account);
  const transactions = (
    status === "all"
      ? allTransactions.filter((t) => !t.removed_at || t.journal_entry_id)
      : allTransactions.filter((t) => statusOf(t) === status)
  ).sort((a, b) => compareBySort(a, b, sort));

  const transactionsWithSuggestions: SuggestedTransaction[] = transactions.map((t) => {
    if (t.posting_kind || t.journal_entry_id || t.removed_at) return { ...t, suggestion: null };
    const r = recommend(t, history, { expense: expenseSuggestable, income: incomeSuggestable });
    return {
      ...t,
      suggestion: r
        ? {
            kind: r.kind,
            accountId: r.accountId,
            unitId: r.unitId,
            label: recommendationLabel(r),
            reason: r.reason,
            needsPick: r.needsPick,
          }
        : null,
    };
  });

  const settledReady = allTransactions.filter(
    (t) => statusOf(t) === "ready" && !t.pending,
  ).length;
  const retractedPosted = allTransactions.filter((t) => t.removed_at && t.journal_entry_id).length;
  const duesUnits = new Set(
    allTransactions
      .filter((t) => t.posting_kind === "dues" && t.journal_entry_id && t.matched_unit_id)
      .map((t) => t.matched_unit_id),
  ).size;
  // Progress through the queue: everything the bank still stands behind,
  // minus what hasn't been given a category yet.
  const progressTotal = counts.all - counts.retracted;
  const progressDone = Math.max(0, progressTotal - counts.needs);
  const progressPct = progressTotal > 0 ? Math.round((progressDone / progressTotal) * 100) : 0;
  // The finish line: a board admin opened the tab with nothing left to categorize.
  const caughtUp = canEdit && explicitStatus === null && counts.needs === 0 && counts.all > 0;

  const moneyIn = allTransactions
    .filter((t) => !t.removed_at && Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0);
  const moneyOut = allTransactions
    .filter((t) => !t.removed_at && Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  const balances =
    active.length > 0
      ? await Promise.all(active.map((c) => getConnectionBalance(supabase, c.id)))
      : [];
  const balanceByConnection = new Map(balances.map((b) => [b.connectionId, b]));
  // "Bank balance" means cash the association can spend: depository accounts
  // only. A credit card balance is money owed and a retirement/brokerage
  // account isn't operating cash, so neither belongs in this total.
  const totalBalanceCents = balances.reduce(
    (sum, b) =>
      sum + b.accounts.filter((a) => a.type === "depository").reduce((s, a) => s + (a.currentCents ?? 0), 0),
    0,
  );
  const anyBalance = balances.some((b) => b.accounts.some((a) => a.type === "depository"));

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
        <section className="divide-y divide-line rounded-xl border border-line bg-paper">
          <header className="rounded-t-[11px] bg-ink px-5 py-4">
            <h2 className="font-bold tracking-tight text-paper">Bank accounts</h2>
            <p className="mt-1 text-[13px] text-ondark-mute">
              Live balances from your connected banks. Transactions flow in from here.
            </p>
          </header>
          {active.map((c) => {
            const balance = balanceByConnection.get(c.id);
            const accts = [...(balance?.accounts ?? [])].sort(
              (x, y) => ACCOUNT_TYPE_ORDER.indexOf(x.type) - ACCOUNT_TYPE_ORDER.indexOf(y.type),
            );
            const cashCents = accts
              .filter((a) => a.type === "depository")
              .reduce((sum, a) => sum + (a.currentCents ?? 0), 0);
            return (
              <div key={c.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-bold tracking-tight text-ink">{c.institution_name}</span>
                      {accts.length > 0 ? (
                        <span className="text-[12px] text-mute">
                          {accts.length} account{accts.length === 1 ? "" : "s"}
                          {cashCents > 0 ? (
                            <>
                              {" · "}
                              <span className="figures text-ink">{money(cashCents / 100)}</span> in cash
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[11px] text-mute-soft">{syncedAgo(c.last_synced_at)}</div>
                  </div>
                  <SyncButton connectionId={c.id} />
                </div>

                {balance?.error ? <p className="mt-3 text-[12px] text-mute-soft">{balance.error}</p> : null}

                {accts.length > 0 ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {accts.map((a, i) => (
                      <li key={`${a.mask ?? ""}-${i}`} className="rounded-lg border border-line bg-fill/40 px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] text-ink" title={a.name}>
                            {a.name}
                          </span>
                          {a.mask ? (
                            <span className="figures shrink-0 text-[11px] text-mute-soft">···{a.mask}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 flex items-baseline justify-between gap-2">
                          <span className="figures text-[15px] text-ink">
                            {a.currentCents !== null ? money(a.currentCents / 100) : "—"}
                          </span>
                          <span className="text-[10px] uppercase tracking-[0.07em] text-mute-soft">
                            {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {canEdit && !c.cash_account_id ? (
                  <div className="mt-3">
                    <LedgerAccountSelect
                      connectionId={c.id}
                      cashAccounts={pickers.cashAccounts}
                      currentId={c.cash_account_id}
                    />
                  </div>
                ) : null}
                {canEdit && c.cash_account_id ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer select-none text-[11px] text-mute-soft hover:text-ink">
                      Manage connection
                    </summary>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <LedgerAccountSelect
                        connectionId={c.id}
                        cashAccounts={pickers.cashAccounts}
                        currentId={c.cash_account_id}
                      />
                      <DisconnectButton connectionId={c.id} />
                    </div>
                  </details>
                ) : null}
              </div>
            );
          })}
          {canEdit ? (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-fill/40 px-5 py-3">
              <p className="text-[12px] text-mute">
                Have money at another bank too — say, the reserve? Add it here. For new transactions at a bank
                that&rsquo;s already listed, use Sync now instead.
              </p>
              <ConnectBankButton label="+ Add another bank" variant="outline" />
            </div>
          ) : null}
        </section>
      ) : null}

      {allTransactions.length > 0 || active.length > 0 ? (
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
                ? "Pick a category for each one — suggestions are one click. Post when you're done."
                : "Categorize, then post. Posted rows are in the books."
            }
          >
            {caughtUp ? (
              <div className="mb-4 rounded-lg border border-good-line bg-good-tint px-4 py-3">
                <p className="text-[13px] font-medium text-good-text">Nothing waiting — you&rsquo;re caught up.</p>
                <p className="mt-1 text-[12px] text-good-text">
                  {counts.posted} in the books · {money(moneyIn)} in · {money(moneyOut)} out
                  {duesUnits > 0 ? ` · dues from ${duesUnits} unit${duesUnits === 1 ? "" : "s"}` : ""}
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

            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <Link
                    key={s}
                    href={hrefFor(q, range, s, sort, account)}
                    className={
                      status === s
                        ? "rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-paper"
                        : "rounded-full border border-line-strong px-3 py-1 text-[12px] text-ink hover:bg-fill"
                    }
                  >
                    {STATUS_LABEL[s]}
                    {s !== "all" && counts[s] > 0 ? ` · ${counts[s]}` : ""}
                  </Link>
                ))}
              </div>
              <div className="flex items-center gap-4">
                {canEdit && counts.needs > 0 ? (
                  <div className="figures text-[22px] leading-none text-ink">
                    {counts.needs} <span className="text-[12px] font-normal text-mute">to go</span>
                  </div>
                ) : null}
                {canEdit ? <PostAllButton readyCount={settledReady} /> : null}
              </div>
            </div>

            {canEdit && progressTotal > 0 ? (
              <div className="mb-3" aria-label={`${progressDone} of ${progressTotal} categorized`}>
                <div className="flex items-baseline justify-between text-[11px] text-mute">
                  <span>
                    <span className="figures text-ink">{progressDone}</span> of{" "}
                    <span className="figures">{progressTotal}</span> categorized
                  </span>
                  <span className="figures">{progressPct}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progressTotal}
                  aria-valuenow={progressDone}
                  className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill"
                >
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${progressPct === 100 ? "bg-moss" : "bg-brass"}`}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-mute">
              <span>
                {anyBalance ? (
                  <>
                    Bank balance <span className="figures text-ink">{money(totalBalanceCents / 100)}</span> ·{" "}
                  </>
                ) : null}
                In <span className="figures text-good-text">{money(moneyIn)}</span> · Out{" "}
                <span className="figures text-ink">{money(moneyOut)}</span>
                {range === "all" ? "" : " in this range"}
              </span>
            </div>

            {account ? (
              <p className="mb-3 text-[12px] text-ink">
                Showing only <span className="font-medium">{accountNameById.get(account) ?? "one category"}</span>.{" "}
                <Link href={hrefFor(q, range, status, sort)} className="text-mute underline-offset-2 hover:underline">
                  Show all
                </Link>
              </p>
            ) : null}

            <details className="mb-4" open={filtersActive}>
              <summary className="cursor-pointer select-none text-[12px] text-mute hover:text-ink">
                Filter &amp; search{filtersActive ? " · on" : ""}
              </summary>
              <form className="mt-3 flex flex-wrap items-end gap-2" method="get">
                {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
                {sort !== "date_desc" ? <input type="hidden" name="sort" value={sort} /> : null}
                <div className="min-w-[10rem] flex-1">
                  <label htmlFor="q" className="block text-[12px] font-medium text-ink">
                    Search
                  </label>
                  <input
                    id="q"
                    name="q"
                    type="text"
                    defaultValue={q ?? ""}
                    placeholder="Description contains…"
                    className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
                  />
                </div>
                <div>
                  <label htmlFor="range" className="block text-[12px] font-medium text-ink">
                    Range
                  </label>
                  <select
                    id="range"
                    name="range"
                    defaultValue={range}
                    className="mt-1 rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
                  >
                    <option value="all">All synced</option>
                    <option value="this_month">This month</option>
                    <option value="last_30">Last 30 days</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
                >
                  Filter
                </button>
              </form>
            </details>

            {transactions.length === 0 ? (
              <Empty>
                {filtersActive
                  ? "No transactions match this filter."
                  : status === "needs"
                    ? "Nothing needs a category."
                    : status !== "all"
                      ? `Nothing ${STATUS_LABEL[status].toLowerCase()} yet.`
                      : "No transactions synced yet. Click “Sync now” above."}
              </Empty>
            ) : (
              <TransactionsTable
                transactions={transactionsWithSuggestions}
                pickers={pickers}
                canEdit={canEdit}
                sort={sort}
                dateHref={hrefFor(q, range, status, nextSort(sort, "date"), account)}
                nameHref={hrefFor(q, range, status, nextSort(sort, "name"), account)}
                amountHref={hrefFor(q, range, status, nextSort(sort, "amount"), account)}
              />
            )}
          </Card>

          {ruleRecords.length > 0 ? (
            <Card
              navy
              title="Rules"
              hint="Saved from “Remember this”. Applied to new transactions as they sync."
            >
              <RulesList rules={ruleRecords} canEdit={canEdit} />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
