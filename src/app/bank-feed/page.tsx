import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, Stat, money } from "@/components/ui";
import { plaidClient, describePlaidError } from "@/lib/plaid";
import { ConnectBankButton } from "./connect-bank-button";
import { SyncButton } from "./sync-button";
import { DisconnectButton } from "./disconnect-button";
import { TransactionRow, type Pickers, type TransactionRecord } from "./transaction-row";
import { PostAllButton } from "./post-all-button";
import { LedgerAccountSelect } from "./ledger-account-select";
import { RulesList, type RuleRecord } from "./rules-list";

export const dynamic = "force-dynamic";

type Range = "this_month" | "last_30" | "all";
type Status = "all" | "needs" | "ready" | "posted" | "excluded" | "retracted";

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

interface ConnectionBalance {
  connectionId: string;
  accounts: { name: string; mask: string | null; currentCents: number | null }[];
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

function hrefFor(q: string | undefined, range: Range, status: Status): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (range !== "all") params.set("range", range);
  if (status !== "all") params.set("status", status);
  const qs = params.toString();
  return `/bank-feed${qs ? `?${qs}` : ""}`;
}

export default async function BankFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; range?: string; status?: string }>;
}) {
  const { q, range: rangeParam, status: statusParam } = await searchParams;
  const range: Range =
    rangeParam === "this_month" || rangeParam === "last_30" ? rangeParam : "all";
  const status: Status =
    statusParam && statusParam in STATUS_LABEL ? (statusParam as Status) : "all";

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
  const unitLabelById = new Map((units ?? []).map((u) => [u.id, u.label]));

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
  const allTransactions = (transactionRows ?? []) as TransactionRecord[];

  const counts: Record<Status, number> = { all: 0, needs: 0, ready: 0, posted: 0, excluded: 0, retracted: 0 };
  for (const t of allTransactions) {
    counts.all += 1;
    counts[statusOf(t)] += 1;
  }
  const transactions =
    status === "all"
      ? allTransactions.filter((t) => !t.removed_at || t.journal_entry_id)
      : allTransactions.filter((t) => statusOf(t) === status);

  const settledReady = allTransactions.filter(
    (t) => statusOf(t) === "ready" && !t.pending,
  ).length;
  const retractedPosted = allTransactions.filter((t) => t.removed_at && t.journal_entry_id).length;

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
  const totalBalanceCents = balances.reduce(
    (sum, b) => sum + b.accounts.reduce((s, a) => s + (a.currentCents ?? 0), 0),
    0,
  );
  const anyBalance = balances.some((b) => b.accounts.length > 0);

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
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">Bank feed</h1>
        <p className="mt-1 text-mute">
          What your bank reports is how the books get written. Categorize each transaction once
          and post it — the ledger, budget, dues balances, and financial statements all follow.
        </p>
      </div>

      {active.length === 0 ? (
        <Card
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

      {active.map((c) => {
        const balance = balanceByConnection.get(c.id);
        return (
          <Card
            key={c.id}
            title={c.institution_name}
            hint={
              c.last_synced_at
                ? `Last synced ${new Date(c.last_synced_at).toLocaleString()}`
                : "Not yet synced"
            }
          >
            {canEdit ? (
              <LedgerAccountSelect
                connectionId={c.id}
                cashAccounts={pickers.cashAccounts}
                currentId={c.cash_account_id}
              />
            ) : null}
            {balance?.error ? (
              <p className="mb-3 text-[12px] text-mute-soft">{balance.error}</p>
            ) : balance && balance.accounts.length > 0 ? (
              <ul className="mb-3 space-y-1">
                {balance.accounts.map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="text-ink">
                      {a.name}
                      {a.mask ? <span className="ml-1 text-[11px] text-mute-soft">···{a.mask}</span> : null}
                    </span>
                    <span className="figures text-ink">
                      {a.currentCents !== null ? money(a.currentCents / 100) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <SyncButton connectionId={c.id} />
              <DisconnectButton connectionId={c.id} />
            </div>
          </Card>
        );
      })}

      {allTransactions.length > 0 || active.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {anyBalance ? (
              <Stat label="Bank balance" value={money(totalBalanceCents / 100)} note="Live from Plaid, just now" />
            ) : null}
            <Stat
              label="Needs category"
              value={String(counts.needs)}
              tone={counts.needs > 0 ? "bad" : "good"}
              note="Not in the books yet"
            />
            <Stat label="Money in" value={money(moneyIn)} note="In the filtered range" />
            <Stat label="Money out" value={money(moneyOut)} note="In the filtered range" />
          </div>

          {retractedPosted > 0 ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
              The bank retracted {retractedPosted} transaction{retractedPosted === 1 ? "" : "s"} that{" "}
              {retractedPosted === 1 ? "was" : "were"} already posted. Review{" "}
              {retractedPosted === 1 ? "it" : "them"} under the “Retracted” filter and undo the posting
              if the bank was right.
            </p>
          ) : null}

          <Card title="Transactions" hint="Categorize, then post. Posted rows are in the books.">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                  <Link
                    key={s}
                    href={hrefFor(q, range, s)}
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
              {canEdit ? <PostAllButton readyCount={settledReady} /> : null}
            </div>

            <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
              {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
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

            {transactions.length === 0 ? (
              <Empty>
                {q || range !== "all" || status !== "all"
                  ? "No transactions match this filter."
                  : "No transactions synced yet. Click “Sync now” above."}
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Date</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {transactions.map((t) => (
                      <TransactionRow key={t.id} transaction={t} pickers={pickers} canEdit={canEdit} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {ruleRecords.length > 0 ? (
            <Card
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
