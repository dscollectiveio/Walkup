import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthKeyOf, monthsBetween } from "@/lib/money/months";

/**
 * How much money the association has, as its bank reports it. The bank is
 * the source of truth for cash (Doug, 2026-10-16): Home, the Bank Feed, the
 * financial statements and the insurance check all read it from here, so
 * they can never disagree. The books (the ledger) still drive income,
 * spending, budgets and taxes; when they differ from the bank, that gap is
 * shown as work to do in the Bank Feed, never papered over.
 *
 * Today's figure is the latest stored balance per account (0063). A balance
 * on an earlier day is today's balance less every bank transaction since,
 * which is exact for any day the synced history covers.
 */

/** Cash the association can spend: checking, savings, CDs, money market. Never a card, loan or investment. */
export const CASH_ACCOUNT_TYPE = "depository";

export interface BankCash {
  totalCents: number;
  operatingCents: number;
  reserveCents: number;
  /** Funds that are neither operating nor reserve, in the total only. */
  otherCents: number;
  /** When the oldest of these balances was reported by the bank. */
  asOf: string;
  /** Plaid account ids counted as cash, with the fund kind each belongs to. */
  kindByAccount: Map<string, "operating" | "reserve" | "other">;
  /** The first day of synced history; earlier balances can't be worked out. */
  historyStart: string | null;
}

type BalanceRow = {
  bank_connection_id: string;
  plaid_account_id: string;
  account_type: string;
  current_balance: string | number | null;
  as_of: string;
};

const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Null when no bank is connected or none has reported a balance yet. */
export async function loadBankCash(supabase: SupabaseClient): Promise<BankCash | null> {
  const [balancesRes, connectionsRes, fundsRes, firstRes, overridesRes] = await Promise.all([
    supabase.from("bank_account_balances").select("bank_connection_id, plaid_account_id, account_type, current_balance, as_of"),
    supabase.from("bank_connections").select("id, fund_id, status").neq("status", "disconnected"),
    supabase.from("funds").select("id, kind"),
    supabase
      .from("bank_transactions")
      .select("posted_on")
      .is("removed_at", null)
      .eq("pending", false)
      .order("posted_on")
      .limit(1),
    supabase.from("bank_account_funds").select("bank_connection_id, plaid_account_id, fund_id"),
  ]);
  if (balancesRes.error || connectionsRes.error) return null;
  const fundKind = new Map((fundsRes.data ?? []).map((f) => [f.id as string, f.kind as string]));
  const connectionKind = new Map(
    (connectionsRes.data ?? []).map((c) => {
      const kind = c.fund_id ? fundKind.get(c.fund_id as string) : "operating";
      return [c.id as string, kind === "reserve" ? "reserve" : kind === "operating" || !kind ? "operating" : "other"] as const;
    }),
  );

  const kindOf = (fundId: string | null | undefined): "operating" | "reserve" | "other" => {
    const kind = fundId ? fundKind.get(fundId) : "operating";
    return kind === "reserve" ? "reserve" : kind === "operating" || !kind ? "operating" : "other";
  };
  // A board admin can say which fund one account belongs to (0063); otherwise its connection's.
  const accountFund = new Map(
    (overridesRes.data ?? []).map((o) => [`${o.bank_connection_id}:${o.plaid_account_id}`, o.fund_id as string]),
  );

  const rows = ((balancesRes.data ?? []) as BalanceRow[]).filter(
    (r) => r.account_type === CASH_ACCOUNT_TYPE && connectionKind.has(r.bank_connection_id),
  );
  if (rows.length === 0) return null;

  const kindByAccount = new Map<string, "operating" | "reserve" | "other">();
  let operatingCents = 0;
  let reserveCents = 0;
  let otherCents = 0;
  for (const r of rows) {
    const override = accountFund.get(`${r.bank_connection_id}:${r.plaid_account_id}`);
    const kind = override ? kindOf(override) : connectionKind.get(r.bank_connection_id)!;
    kindByAccount.set(r.plaid_account_id, kind);
    const c = cents(r.current_balance);
    if (kind === "reserve") reserveCents += c;
    else if (kind === "operating") operatingCents += c;
    else otherCents += c;
  }
  return {
    totalCents: operatingCents + reserveCents + otherCents,
    operatingCents,
    reserveCents,
    otherCents,
    asOf: rows.map((r) => r.as_of).sort()[0],
    kindByAccount,
    historyStart: (firstRes.data?.[0]?.posted_on as string | undefined) ?? null,
  };
}

type TxRow = { posted_on: string; amount: string | number; plaid_account_id: string | null };

/** Every settled, not-retracted bank transaction on a cash account after `afterIso`. Walkup sign: + is money in. */
async function cashTransactionsAfter(supabase: SupabaseClient, cash: BankCash, afterIso: string): Promise<TxRow[]> {
  const { data } = await supabase
    .from("bank_transactions")
    .select("posted_on, amount, plaid_account_id")
    .is("removed_at", null)
    .eq("pending", false)
    .gt("posted_on", afterIso)
    .limit(50000);
  return ((data ?? []) as TxRow[]).filter((t) => t.plaid_account_id !== null && cash.kindByAccount.has(t.plaid_account_id));
}

/**
 * Cash at the end of `dateIso` by fund kind, worked back from today's bank
 * balances. Null when the date is before the synced history begins, where the
 * bank's record can't answer.
 */
export async function bankCashAt(
  supabase: SupabaseClient,
  cash: BankCash,
  dateIso: string,
  todayIso: string,
): Promise<{ totalCents: number; operatingCents: number; reserveCents: number } | null> {
  if (dateIso >= todayIso) {
    return { totalCents: cash.totalCents, operatingCents: cash.operatingCents, reserveCents: cash.reserveCents };
  }
  if (!cash.historyStart || dateIso < cash.historyStart) return null;
  let operatingCents = cash.operatingCents;
  let reserveCents = cash.reserveCents;
  let otherCents = cash.otherCents;
  for (const t of await cashTransactionsAfter(supabase, cash, dateIso)) {
    const kind = cash.kindByAccount.get(t.plaid_account_id!);
    const c = cents(t.amount);
    if (kind === "reserve") reserveCents -= c;
    else if (kind === "operating") operatingCents -= c;
    else otherCents -= c;
  }
  return { totalCents: operatingCents + reserveCents + otherCents, operatingCents, reserveCents };
}

export interface BankMonth {
  key: string;
  inCents: number;
  outCents: number;
  /** Cash across every account at the end of the month (today, for the current one). */
  balanceCents: number;
}

/**
 * Month by month (keys are "YYYY-MM-01") from `fromKey` through the current month: money in and out
 * of the cash accounts as the bank recorded it, and the balance at each
 * month's end. Months before the synced history are left out.
 */
export async function bankMonths(
  supabase: SupabaseClient,
  cash: BankCash,
  fromKey: string,
  currentKey: string,
): Promise<BankMonth[]> {
  if (!cash.historyStart) return [];
  const historyKey = monthKeyOf(cash.historyStart);
  const startKey = historyKey > fromKey ? historyKey : fromKey;
  const keys = monthsBetween(startKey, currentKey);
  if (keys.length === 0) return [];
  const [y, m] = keys[0].split("-").map(Number);
  const dayBeforeFirst = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  const txs = await cashTransactionsAfter(supabase, cash, dayBeforeFirst);
  return walkBackMonths(cash.totalCents, keys, txs, cash.kindByAccount);
}

/**
 * The pure half of bankMonths: in and out per month on cash accounts, and each
 * month's closing balance worked back from today's total. Exported for tests.
 */
export function walkBackMonths(
  todayTotalCents: number,
  keys: string[],
  txs: { posted_on: string; amount: string | number; plaid_account_id: string | null }[],
  cashAccounts: Map<string, unknown>,
): BankMonth[] {
  const byMonth = new Map<string, { in: number; out: number; net: number }>();
  for (const t of txs) {
    if (!t.plaid_account_id || !cashAccounts.has(t.plaid_account_id)) continue;
    const key = monthKeyOf(t.posted_on);
    const e = byMonth.get(key) ?? { in: 0, out: 0, net: 0 };
    const c = cents(t.amount);
    if (c >= 0) e.in += c;
    else e.out += -c;
    e.net += c;
    byMonth.set(key, e);
  }
  // Walk back from today's balance: a month's closing balance is the next
  // month's closing balance less that next month's net movement.
  const out: BankMonth[] = [];
  let closing = todayTotalCents;
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = byMonth.get(keys[i]);
    out.unshift({ key: keys[i], inCents: e?.in ?? 0, outCents: e?.out ?? 0, balanceCents: closing });
    closing -= e?.net ?? 0;
  }
  return out;
}
