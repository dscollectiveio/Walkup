import { toCents } from "@/lib/tax/form1120h";

/** One row of monthly_expense_actuals (0028). Money arrives as text. */
export interface ExpenseActualRow {
  month: string;
  account_id: string;
  account_name: string;
  fund_id: string;
  total: string;
}

export interface AccountSpend {
  accountId: string;
  name: string;
  cents: number;
}

/**
 * Spending per expense account between two month keys (inclusive). Reserve
 * transfers never appear here — a transfer writes no expense row — so this is
 * spending in the plain sense: money paid to someone else. Optionally limited
 * to one fund (the budget compares against the operating fund only).
 */
export function spendByAccount(
  rows: ExpenseActualRow[],
  startKey: string,
  endKey: string,
  fundId?: string,
): AccountSpend[] {
  const byAccount = new Map<string, AccountSpend>();
  for (const r of rows) {
    if (r.month < startKey || r.month > endKey) continue;
    if (fundId && r.fund_id !== fundId) continue;
    const cur = byAccount.get(r.account_id) ?? { accountId: r.account_id, name: r.account_name, cents: 0 };
    cur.cents += toCents(r.total);
    byAccount.set(r.account_id, cur);
  }
  return [...byAccount.values()].filter((a) => a.cents !== 0).sort((a, b) => b.cents - a.cents);
}

/** Total spending per month key, optionally for one fund. */
export function spendByMonth(rows: ExpenseActualRow[], fundId?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (fundId && r.fund_id !== fundId) continue;
    out.set(r.month, (out.get(r.month) ?? 0) + toCents(r.total));
  }
  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
