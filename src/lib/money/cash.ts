import { toCents } from "@/lib/tax/form1120h";
import { monthsBetween } from "./months";

/** One row of monthly_cash_activity (0017, transfer columns from 0039). Money arrives as text. */
export interface CashActivityRow {
  month: string;
  fund_kind: string;
  inflow: string;
  outflow: string;
  transfer_inflow: string;
  transfer_outflow: string;
}

export interface CashMonth {
  key: string;
  /** Money that came in from outside — transfers between the association's own accounts excluded. */
  inCents: number;
  /** Money that went out to someone else — transfers excluded. */
  outCents: number;
  /** Every cash movement, transfers included (they net to zero across funds). */
  netCents: number;
  /** Balance at the end of the month, carried from the first month with activity. */
  balanceCents: number;
}

/**
 * Month-by-month cash, gaps filled by carrying the balance forward — a quiet
 * month still has a balance, which is the balance persisting, not invented
 * data. Pass `fundKind` to look at one fund; omit it for every fund together.
 */
export function cashByMonth(rows: CashActivityRow[], fundKind?: string): CashMonth[] {
  const byKey = new Map<string, { in: number; out: number; net: number }>();
  for (const r of rows) {
    if (fundKind && r.fund_kind !== fundKind) continue;
    const entry = byKey.get(r.month) ?? { in: 0, out: 0, net: 0 };
    const inflow = toCents(r.inflow);
    const outflow = toCents(r.outflow);
    entry.in += inflow - toCents(r.transfer_inflow);
    entry.out += outflow - toCents(r.transfer_outflow);
    entry.net += inflow - outflow;
    byKey.set(r.month, entry);
  }
  const keys = [...byKey.keys()].sort();
  if (keys.length === 0) return [];

  let running = 0;
  return monthsBetween(keys[0], keys[keys.length - 1]).map((key) => {
    const e = byKey.get(key);
    running += e?.net ?? 0;
    return { key, inCents: e?.in ?? 0, outCents: e?.out ?? 0, netCents: e?.net ?? 0, balanceCents: running };
  });
}

/** Money moved into a fund from the association's other accounts, per month. */
export function transfersInByMonth(rows: CashActivityRow[], fundKind: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.fund_kind !== fundKind) continue;
    out.set(r.month, (out.get(r.month) ?? 0) + toCents(r.transfer_inflow) - toCents(r.transfer_outflow));
  }
  return out;
}
