import { readBankToken } from "@/lib/plaid/token";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/components/ui";
import { syncedAgo } from "@/lib/dates";
import {
  plaidClient,
  plaidErrorLog,
  describePlaidError,
  isLoginRequired,
  isProductNotEnabled,
} from "@/lib/plaid";
import { rememberBalance } from "@/lib/plaid/balance-cache";
import { institutionLogo } from "@/lib/plaid/institution-logo";
import { BankLogo } from "./bank-logo";
import { ConnectionStatus, type ConnectionHealth } from "./connection-status";
import { storeBankBalances } from "@/lib/bank/balances-store";
import { ConnectBankButton } from "./connect-bank-button";
import { ReconnectButton } from "./reconnect-button";
import { SyncButton } from "./sync-button";
import { BankCardActions, ManageLink } from "./bank-card-actions";
import { DisconnectButton } from "./disconnect-button";
import { BankAlertsButton } from "./bank-alerts-button";
import { LedgerAccountSelect } from "./ledger-account-select";
import { AccountFundSelect, type FundChoice } from "./account-fund-select";
import { AccountNickname } from "./account-nickname";

const ACCOUNT_TYPE_ORDER = [
  "depository",
  "credit",
  "loan",
  "investment",
  "other",
];
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
    /** Plaid's account_id, the same id bank_transactions.plaid_account_id carries. */
    accountId: string;
    name: string;
    mask: string | null;
    currentCents: number | null;
    /** Plaid's account type: depository (checking/savings/CD/money market), credit, loan, investment. */
    type: string;
    /** Plaid's subtype ("checking", "savings", "cd"…). Only known on a live answer from the bank. */
    subtype?: string | null;
  }[];
  error?: string;
  /** The bank wants the person to sign in again — show Reconnect, not an error. */
  needsReconnect?: boolean;
  /**
   * "live" = real-time Balance product; "last_sync" = Plaid's cached balance as
   * of its last update; "stored" = the last balance Walkup heard (0063), for
   * readers of the books who can't ask the bank themselves.
   */
  source?: "live" | "last_sync" | "stored";
  /** When a stored balance was true. */
  asOf?: string;
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
  const { token: accessToken, error: tokenError } = await readBankToken(
    supabase,
    connectionId,
  );
  if (tokenError || !accessToken) {
    // Only a board admin can ask the bank directly. Everyone else who can read
    // the books sees the last balance Walkup heard, the same one Home shows.
    const { data: stored } = await supabase
      .from("bank_account_balances")
      .select(
        "plaid_account_id, name, mask, account_type, current_balance, as_of",
      )
      .eq("bank_connection_id", connectionId);
    if (stored && stored.length > 0) {
      return {
        connectionId,
        source: "stored",
        asOf: stored.map((r) => r.as_of as string).sort()[0],
        accounts: stored.map((r) => ({
          accountId: r.plaid_account_id as string,
          name: r.name as string,
          mask: (r.mask as string | null) ?? null,
          type: r.account_type as string,
          currentCents:
            r.current_balance === null
              ? null
              : Math.round(Number(r.current_balance) * 100),
        })),
      };
    }
    return {
      connectionId,
      accounts: [],
      error: tokenError?.message ?? "No access token on file.",
    };
  }

  const toAccounts = (
    accounts: {
      account_id: string;
      name: string;
      mask?: string | null;
      type: unknown;
      subtype?: unknown;
      balances: { current?: number | null };
    }[],
  ) =>
    accounts.map((a) => ({
      accountId: a.account_id,
      name: a.name,
      mask: a.mask ?? null,
      type: String(a.type),
      subtype: a.subtype ? String(a.subtype) : null,
      currentCents:
        a.balances.current !== null && a.balances.current !== undefined
          ? Math.round(a.balances.current * 100)
          : null,
    }));

  // The Plaid half is remembered for a few minutes per connection: this page
  // re-renders on every click, and the balance does not change between them.
  // A fresh answer is also stored (0063) so Home, the statements and every
  // reader of the books show the very same figure.
  const result = await rememberBalance<ConnectionBalance>(
    connectionId,
    async () => {
      try {
        const response = await plaidClient().accountsBalanceGet({
          access_token: accessToken,
        });
        return {
          connectionId,
          accounts: toAccounts(response.data.accounts),
          source: "live",
        };
      } catch (cause) {
        if (isLoginRequired(cause))
          return { connectionId, accounts: [], needsReconnect: true };
        if (!isProductNotEnabled(cause)) {
          console.error(
            "Plaid accountsBalanceGet failed",
            plaidErrorLog(cause),
          );
          return {
            connectionId,
            accounts: [],
            error: describePlaidError(cause),
          };
        }
        console.warn(
          "Plaid Balance isn't enabled for this client; using cached balances from accountsGet.",
        );
        try {
          const response = await plaidClient().accountsGet({
            access_token: accessToken,
          });
          return {
            connectionId,
            accounts: toAccounts(response.data.accounts),
            source: "last_sync",
          };
        } catch (fallback) {
          if (isLoginRequired(fallback))
            return { connectionId, accounts: [], needsReconnect: true };
          console.error("Plaid accountsGet failed", plaidErrorLog(fallback));
          return {
            connectionId,
            accounts: [],
            error: describePlaidError(fallback),
          };
        }
      }
    },
  );
  if (
    !result.error &&
    !result.needsReconnect &&
    result.accounts.length > 0 &&
    result.source !== "stored"
  ) {
    await storeBankBalances(
      supabase,
      connectionId,
      result.accounts,
      result.source ?? "live",
    );
  }
  return result;
}

interface ActiveConnection {
  id: string;
  institution_name: string;
  /** 'active', or 'error' when the last sync found the bank wanting a fresh sign-in. */
  status: string;
  last_synced_at: string | null;
  cash_account_id: string | null;
  /** The fund this bank's money counts in unless an account says otherwise. */
  fund_id?: string | null;
}

/** A bank needs a fresh sign-in when the sync said so (status 'error') or Plaid just did. */
function needsReconnect(
  c: ActiveConnection,
  balance: ConnectionBalance | undefined,
): boolean {
  return c.status === "error" || balance?.needsReconnect === true;
}

/** Savings-like accounts are usually the reserve. Plaid's subtype when we have it, the name when we don't. */
function looksLikeSavings(a: {
  name: string;
  subtype?: string | null;
}): boolean {
  if (a.subtype)
    return ["savings", "cd", "money market"].includes(a.subtype.toLowerCase());
  return /saving|reserve/i.test(a.name);
}

/** Addressed to whoever can act: a board admin signs in again; anyone else is told who can. */
function reconnectSentence(institution: string, canEdit: boolean): string {
  return `${institution} needs ${canEdit ? "you" : "a board admin"} to sign in again before new transactions can come in.`;
}

/** Placeholder while Plaid answers, so the rest of the page isn't held up by it. */
export function BankAccountsSkeleton() {
  return (
    <section
      className="rounded-xl border border-line bg-paper"
      aria-hidden="true"
    >
      <header className="rounded-t-[7px] band bg-ink px-5 py-3">
        <h2 className="eyebrow text-paper">Bank accounts</h2>
        <p className="mt-1 text-[13px] text-ondark-mute">
          Checking balances with your bank…
        </p>
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
  isAdmin = canEdit,
  cashAccounts,
  checkingIds = [],
  fundChoices = [],
  accountFunds = {},
  nicknames = {},
}: {
  balancesPromise: Promise<ConnectionBalance[]>;
  active: ActiveConnection[];
  /** Categorizing and fund mapping: the Treasurer's duty as well as an admin's. */
  canEdit: boolean;
  /** Connecting, reconnecting, syncing and disconnecting banks: board admin only. */
  isAdmin?: boolean;
  cashAccounts: { id: string; label: string }[];
  /** Connections the page kicked off a sync for after responding (stale by 12+ hours). */
  checkingIds?: string[];
  /** For "Counts as" on each cash account (board admins): the funds to choose from. */
  fundChoices?: FundChoice[];
  /** Choices already made, keyed "connectionId:plaidAccountId" (0063 bank_account_funds). */
  accountFunds?: Record<string, string>;
  /** Nicknames the board gave accounts, keyed "connectionId:plaidAccountId" (0094). */
  nicknames?: Record<string, string>;
}) {
  const [balances, logoList] = await Promise.all([
    balancesPromise,
    Promise.all(active.map((c) => institutionLogo(c.institution_name))),
  ]);
  const logoByConnection = new Map(active.map((c, i) => [c.id, logoList[i]]));
  const accountFund = new Map(Object.entries(accountFunds));
  const balanceByConnection = new Map(balances.map((b) => [b.connectionId, b]));
  // Cash the association can spend: depository accounts only. A credit card is
  // money owed and a retirement/brokerage account isn't operating cash.
  const totalCashCents = balances.reduce(
    (sum, b) =>
      sum +
      b.accounts
        .filter((a) => a.type === "depository")
        .reduce((s, a) => s + (a.currentCents ?? 0), 0),
    0,
  );
  // Which fund each cash account counts in: its own choice, else its bank's, else day-to-day.
  const kindOfFund = new Map(fundChoices.map((f) => [f.id, f.kind]));
  const operatingFundId =
    fundChoices.find((f) => f.kind === "operating")?.id ?? null;
  const reserveFundId =
    fundChoices.find((f) => f.kind === "reserve")?.id ?? null;
  const effectiveFund = (connection: ActiveConnection, accountId: string) =>
    accountFund.get(`${connection.id}:${accountId}`) ??
    connection.fund_id ??
    operatingFundId;
  let operatingCents = 0;
  let reserveCents = 0;
  let otherCents = 0;
  for (const c of active) {
    for (const a of balanceByConnection.get(c.id)?.accounts ?? []) {
      if (a.type !== "depository") continue;
      const kind =
        kindOfFund.get(effectiveFund(c, a.accountId) ?? "") ?? "operating";
      if (kind === "reserve") reserveCents += a.currentCents ?? 0;
      else if (kind === "operating") operatingCents += a.currentCents ?? 0;
      else otherCents += a.currentCents ?? 0;
    }
  }
  const hasCash = balances.some((b) =>
    b.accounts.some((a) => a.type === "depository"),
  );
  const anyCached = balances.some(
    (b) => b.source === "last_sync" || b.source === "stored",
  );
  return (
    <section className="divide-y divide-line rounded-xl border border-line bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-t-[7px] band bg-ink px-5 py-3">
        <div>
          <h2 className="eyebrow text-paper">Total bank balance</h2>
          <p className="mt-1.5 text-[13px] text-ondark-mute">
            {hasCash
              ? `Cash across ${active.length} connected bank${active.length === 1 ? "" : "s"}${anyCached ? " · as of each bank's last update" : ""}`
              : "Checking, savings, CD and money market accounts, added together."}
          </p>
        </div>
        <div className="text-right">
          <div className="figures whitespace-nowrap text-[22px] leading-none text-paper">
            {hasCash ? money(totalCashCents / 100) : "—"}
          </div>
          {hasCash && reserveFundId ? (
            <p className="mt-1.5 text-[12px] text-ondark-mute">
              Day-to-day{" "}
              <span className="figures whitespace-nowrap text-paper">
                {money(operatingCents / 100)}
              </span>{" "}
              · Reserve{" "}
              <span className="figures whitespace-nowrap text-paper">
                {money(reserveCents / 100)}
              </span>
              {otherCents !== 0 ? (
                <>
                  {" "}
                  · Other{" "}
                  <span className="figures whitespace-nowrap text-paper">
                    {money(otherCents / 100)}
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>
      {active.map((c) => {
        const balance = balanceByConnection.get(c.id);
        const accts = [...(balance?.accounts ?? [])].sort(
          (x, y) =>
            ACCOUNT_TYPE_ORDER.indexOf(x.type) -
            ACCOUNT_TYPE_ORDER.indexOf(y.type),
        );
        const accountsPanel =
          accts.length > 0 ? (
            <div>
              {balance?.source === "last_sync" ? (
                <p className="mb-2 text-[12px] text-mute-soft">
                  Balances are as of the bank&rsquo;s last update, not
                  real-time.
                </p>
              ) : balance?.source === "stored" && balance.asOf ? (
                <p className="mb-2 text-[12px] text-mute-soft">
                  Balances from the last time Walkup checked with the bank (
                  {syncedAgo(balance.asOf)}).
                </p>
              ) : null}
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {accts.map((a, i) => (
                  <li
                    key={`${a.mask ?? ""}-${i}`}
                    className="group/acct flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 basis-48 items-baseline gap-2">
                      <AccountNickname
                        connectionId={c.id}
                        plaidAccountId={a.accountId}
                        bankName={a.name}
                        nickname={nicknames[`${c.id}:${a.accountId}`] ?? null}
                        canRename={isAdmin}
                      />
                      {a.mask ? (
                        <span className="figures shrink-0 text-[11px] text-mute-soft">
                          ···{a.mask}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-[10px] uppercase tracking-[0.07em] text-mute-soft">
                        {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}
                      </span>
                    </div>
                    <span className="figures w-28 shrink-0 whitespace-nowrap text-right text-[14px] text-ink">
                      {a.currentCents !== null
                        ? money(a.currentCents / 100)
                        : "—"}
                    </span>
                    {canEdit &&
                    a.type === "depository" &&
                    fundChoices.length > 1 ? (
                      <AccountFundSelect
                        connectionId={c.id}
                        plaidAccountId={a.accountId}
                        accountName={a.name}
                        funds={fundChoices}
                        current={effectiveFund(c, a.accountId) ?? ""}
                        suggestReserve={
                          reserveFundId !== null &&
                          !accountFund.has(`${c.id}:${a.accountId}`) &&
                          effectiveFund(c, a.accountId) !== reserveFundId &&
                          looksLikeSavings(a)
                        }
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null;

        const managePanel =
          isAdmin && c.cash_account_id ? (
            <div className="flex flex-wrap items-center gap-3">
              <LedgerAccountSelect
                connectionId={c.id}
                cashAccounts={cashAccounts}
                currentId={c.cash_account_id}
              />
              {process.env.PLAID_WEBHOOK_URL ? (
                <BankAlertsButton connectionId={c.id} />
              ) : null}
              <DisconnectButton connectionId={c.id} />
            </div>
          ) : null;

        const health: ConnectionHealth = needsReconnect(c, balance)
          ? "needs_signin"
          : balance?.error
            ? "problem"
            : checkingIds.includes(c.id)
              ? "checking"
              : "connected";

        const header = (
          <div className="flex min-w-0 items-start gap-3">
            <BankLogo
              name={c.institution_name}
              logo={logoByConnection.get(c.id) ?? null}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold tracking-tight text-ink">
                  {c.institution_name}
                </span>
                {accts.length > 0 ? (
                  <span className="text-[12px] text-mute">
                    {accts.length} account{accts.length === 1 ? "" : "s"}
                  </span>
                ) : null}
                {/* The "⋯" sits with the name so it never wraps away from the status line on a phone. */}
                <ManageLink />
              </div>
              <ConnectionStatus
                actions={
                  isAdmin && !needsReconnect(c, balance) ? (
                    <SyncButton connectionId={c.id} />
                  ) : null
                }
                health={health}
                syncedText={`${syncedAgo(c.last_synced_at)}${
                  checkingIds.includes(c.id)
                    ? " · checking for new transactions, reload in a minute"
                    : ""
                }`}
                detail={balance?.error}
              />
            </div>
          </div>
        );

        return (
          <div key={c.id} className="px-5 py-4">
            {needsReconnect(c, balance) ? header : null}

            {balance?.error && !needsReconnect(c, balance) ? (
              <p className="mt-3 text-[12px] text-mute-soft">{balance.error}</p>
            ) : null}

            {isAdmin && !c.cash_account_id ? (
              <div className="mt-3">
                <LedgerAccountSelect
                  connectionId={c.id}
                  cashAccounts={cashAccounts}
                  currentId={c.cash_account_id}
                />
              </div>
            ) : null}

            {/* A bank that wants a sign-in has one thing to do, so that one thing replaces the button row. */}
            {needsReconnect(c, balance) ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning-line bg-warning-tint px-3 py-2">
                <p className="text-[13px] text-warning-text">
                  {reconnectSentence(c.institution_name, isAdmin)}
                </p>
                {isAdmin ? (
                  <ReconnectButton
                    connectionId={c.id}
                    institutionName={c.institution_name}
                  />
                ) : null}
              </div>
            ) : (
              <BankCardActions
                header={header}
                accountsPanel={accountsPanel}
                managePanel={managePanel}
                accountCount={accts.length}
              />
            )}
          </div>
        );
      })}
      {isAdmin ? (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-fill/40 px-5 py-2">
          <p className="text-[12px] text-mute">
            Reserve at a different bank? Add it here.
          </p>
          <ConnectBankButton label="+ Add another bank" variant="outline" />
        </div>
      ) : null}
    </section>
  );
}
