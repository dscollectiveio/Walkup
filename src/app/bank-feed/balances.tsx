import { createClient } from "@/lib/supabase/server";
import { Answer, money } from "@/components/ui";
import { syncedAgo } from "@/lib/dates";
import { plaidClient, describePlaidError, isLoginRequired, isProductNotEnabled } from "@/lib/plaid";
import { ConnectBankButton } from "./connect-bank-button";
import { ReconnectButton } from "./reconnect-button";
import { SyncButton } from "./sync-button";
import { BankCardActions } from "./bank-card-actions";
import { DisconnectButton } from "./disconnect-button";
import { LedgerAccountSelect } from "./ledger-account-select";

const ACCOUNT_TYPE_ORDER = ["depository", "credit", "loan", "investment", "other"];
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  depository: "Cash",
  credit: "Owed",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};

export interface ConnectionBalance {
  connectionId: string;
  accounts: {
    name: string;
    mask: string | null;
    currentCents: number | null;
    /** Plaid's account type: depository (checking/savings/CD/money market), credit, loan, investment. */
    type: string;
  }[];
  error?: string;
  /** The bank wants the person to sign in again — show Reconnect, not an error. */
  needsReconnect?: boolean;
  /** "live" = real-time Balance product; "last_sync" = Plaid's cached balance as of its last update. */
  source?: "live" | "last_sync";
}

/**
 * Balances straight from Plaid — not derived from bank_transactions and
 * never written anywhere. Purely a display fetch.
 *
 * Real-time Balance is its own Plaid product and production access is
 * granted per account. When Plaid says this client isn't approved for it,
 * fall back to accountsGet, which needs only the Transactions access we
 * already have and returns the balance as of the bank's last update.
 */
export async function getConnectionBalance(
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

  const toAccounts = (
    accounts: { name: string; mask?: string | null; type: unknown; balances: { current?: number | null } }[],
  ) =>
    accounts.map((a) => ({
      name: a.name,
      mask: a.mask ?? null,
      type: String(a.type),
      currentCents:
        a.balances.current !== null && a.balances.current !== undefined ? Math.round(a.balances.current * 100) : null,
    }));

  try {
    const response = await plaidClient().accountsBalanceGet({ access_token: accessToken });
    return { connectionId, accounts: toAccounts(response.data.accounts), source: "live" };
  } catch (cause) {
    if (isLoginRequired(cause)) return { connectionId, accounts: [], needsReconnect: true };
    if (!isProductNotEnabled(cause)) {
      console.error("Plaid accountsBalanceGet failed", cause);
      return { connectionId, accounts: [], error: describePlaidError(cause) };
    }
    console.warn("Plaid Balance isn't enabled for this client; using cached balances from accountsGet.");
    try {
      const response = await plaidClient().accountsGet({ access_token: accessToken });
      return { connectionId, accounts: toAccounts(response.data.accounts), source: "last_sync" };
    } catch (fallback) {
      if (isLoginRequired(fallback)) return { connectionId, accounts: [], needsReconnect: true };
      console.error("Plaid accountsGet failed", fallback);
      return { connectionId, accounts: [], error: describePlaidError(fallback) };
    }
  }
}


interface ActiveConnection {
  id: string;
  institution_name: string;
  /** 'active', or 'error' when the last sync found the bank wanting a fresh sign-in. */
  status: string;
  last_synced_at: string | null;
  cash_account_id: string | null;
}

/** Money that came in and went out across every connected bank, over a stated period. */
export interface MoneyFlow {
  in: number;
  out: number;
  /** "this month" or "in the last 30 days". */
  period: string;
}

/** A bank needs a fresh sign-in when the sync said so (status 'error') or Plaid just did. */
function needsReconnect(c: ActiveConnection, balance: ConnectionBalance | undefined): boolean {
  return c.status === "error" || balance?.needsReconnect === true;
}

function reconnectSentence(institution: string): string {
  return `${institution} needs you to sign in again before new transactions can come in.`;
}

/** Placeholder while Plaid answers, so the rest of the page isn't held up by it. */
export function BankAccountsSkeleton() {
  return (
    <section className="rounded-xl border border-line bg-paper" aria-hidden="true">
      <header className="rounded-t-[7px] bg-ink px-5 py-4">
        <h2 className="eyebrow text-paper">Bank accounts</h2>
        <p className="mt-1 text-[13px] text-ondark-mute">Checking balances with your bank…</p>
      </header>
      <div className="animate-pulse space-y-3 px-5 py-4">
        <div className="h-4 w-48 rounded bg-fill" />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-fill" />
          ))}
        </div>
      </div>
    </section>
  );
}

/** The connected banks and their accounts. Awaits the early-started Plaid call. */
export async function BankAccountsSection({
  balancesPromise,
  active,
  canEdit,
  cashAccounts,
  checkingIds = [],
  flow,
}: {
  balancesPromise: Promise<ConnectionBalance[]>;
  active: ActiveConnection[];
  canEdit: boolean;
  cashAccounts: { id: string; label: string }[];
  /** Connections the page kicked off a sync for after responding (stale by 12+ hours). */
  checkingIds?: string[];
  /** In and out for the period, shown under the total; left out when nothing has synced for it. */
  flow?: MoneyFlow;
}) {
  const balances = await balancesPromise;
  const balanceByConnection = new Map(balances.map((b) => [b.connectionId, b]));
  // Cash the association can spend: depository accounts only. A credit card is
  // money owed and a retirement/brokerage account isn't operating cash.
  const totalCashCents = balances.reduce(
    (sum, b) => sum + b.accounts.filter((a) => a.type === "depository").reduce((s, a) => s + (a.currentCents ?? 0), 0),
    0,
  );
  const hasCash = balances.some((b) => b.accounts.some((a) => a.type === "depository"));
  const anyCached = balances.some((b) => b.source === "last_sync");
  return (
    <section className="divide-y divide-line rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 rounded-t-[7px] bg-ink px-5 py-5">
        <div>
          <h2 className="eyebrow text-paper">Total bank balance</h2>
          <p className="mt-1.5 text-[13px] text-ondark-mute">
            {hasCash
              ? `Cash across ${active.length} connected bank${active.length === 1 ? "" : "s"}${anyCached ? " · as of each bank's last update" : ""}`
              : "Checking, savings, CD and money market accounts, added together."}
          </p>
        </div>
        <div className="text-right">
          <div className="figures text-[40px] leading-none text-paper sm:text-[48px]">
            {hasCash ? money(totalCashCents / 100) : "—"}
          </div>
          {flow ? (
            <p className="mt-2 text-[12px] text-ondark-mute">
              In <span className="figures text-paper">{money(flow.in)}</span> · Out{" "}
              <span className="figures text-paper">{money(flow.out)}</span> {flow.period}
            </p>
          ) : null}
        </div>
      </header>
      {active.map((c) => {
        const balance = balanceByConnection.get(c.id);
        const accts = [...(balance?.accounts ?? [])].sort(
          (x, y) => ACCOUNT_TYPE_ORDER.indexOf(x.type) - ACCOUNT_TYPE_ORDER.indexOf(y.type),
        );
        const accountsPanel =
          accts.length > 0 ? (
            <div>
              {balance?.source === "last_sync" ? (
                <p className="mb-2 text-[11px] text-mute-soft">
                  Balances are as of the bank&rsquo;s last update, not real-time.
                </p>
              ) : null}
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {accts.map((a, i) => (
                  <li key={`${a.mask ?? ""}-${i}`} className="rounded-lg border border-line bg-fill/40 px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12px] text-ink" title={a.name}>
                        {a.name}
                      </span>
                      {a.mask ? <span className="figures shrink-0 text-[11px] text-mute-soft">···{a.mask}</span> : null}
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
            </div>
          ) : null;

        const managePanel =
          canEdit && c.cash_account_id ? (
            <div className="flex flex-wrap items-center gap-3">
              <LedgerAccountSelect connectionId={c.id} cashAccounts={cashAccounts} currentId={c.cash_account_id} />
              <DisconnectButton connectionId={c.id} />
            </div>
          ) : null;

        return (
          <div key={c.id} className="px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold tracking-tight text-ink">{c.institution_name}</span>
                {accts.length > 0 ? (
                  <span className="text-[12px] text-mute">
                    {accts.length} account{accts.length === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 text-[11px] text-mute-soft">
                {syncedAgo(c.last_synced_at)}
                {checkingIds.includes(c.id) ? " · Checking the bank for new transactions…" : ""}
              </div>
            </div>

            {balance?.error && !needsReconnect(c, balance) ? (
              <p className="mt-3 text-[12px] text-mute-soft">{balance.error}</p>
            ) : null}

            {canEdit && !c.cash_account_id ? (
              <div className="mt-3">
                <LedgerAccountSelect connectionId={c.id} cashAccounts={cashAccounts} currentId={c.cash_account_id} />
              </div>
            ) : null}

            {/* A bank that wants a sign-in has one thing to do, so that one thing replaces the button row. */}
            {needsReconnect(c, balance) ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-line bg-warning-tint px-3 py-2">
                <p className="text-[13px] text-warning-text">{reconnectSentence(c.institution_name)}</p>
                {canEdit ? <ReconnectButton connectionId={c.id} institutionName={c.institution_name} /> : null}
              </div>
            ) : (
              <div className="mt-3">
                <BankCardActions
                  sync={<SyncButton connectionId={c.id} />}
                  accountsPanel={accountsPanel}
                  managePanel={managePanel}
                  accountCount={accts.length}
                />
              </div>
            )}
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
  );
}

/**
 * The same sign-in-again message at the top of the Transactions card, so it
 * is seen where the person came to work, not only in the bank card above.
 * Nothing until Plaid has answered; nothing when every bank is fine.
 */
export async function ReconnectNotice({
  balancesPromise,
  active,
  canEdit,
}: {
  balancesPromise: Promise<ConnectionBalance[]>;
  active: ActiveConnection[];
  canEdit: boolean;
}) {
  const balances = await balancesPromise;
  const byConnection = new Map(balances.map((b) => [b.connectionId, b]));
  const stale = active.filter((c) => needsReconnect(c, byConnection.get(c.id)));
  if (stale.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {stale.map((c) => (
        <Answer
          key={c.id}
          status="bad"
          headline={reconnectSentence(c.institution_name)}
          detail="Nothing already in the books changes."
        >
          {canEdit ? <ReconnectButton connectionId={c.id} institutionName={c.institution_name} /> : null}
        </Answer>
      ))}
    </div>
  );
}
