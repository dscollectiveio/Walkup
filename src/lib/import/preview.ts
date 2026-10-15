/**
 * What the preview shows: the journal entry a transaction row will become,
 * and the small tallies beside it (import-spec 7.3). Pure. Built from the same
 * rule the commit uses (money in debits cash, money out credits cash), so the
 * preview cannot say one thing and the commit do another.
 */

import { fromCents, toCents } from "@/lib/tax/form1120h";
import { normalizeKey } from "./normalize";
import type { AccountLite, Options } from "./options";

export interface EntryPreview {
  date: string;
  description: string;
  debit: { label: string; amount: string };
  credit: { label: string; amount: string };
}

const label = (a: Pick<AccountLite, "code" | "name"> | undefined) => (a ? `${a.code} ${a.name}` : "Unmatched account");

export function entryPreview(
  mapped: Record<string, string>,
  options: Options,
  accounts: Map<string, Pick<AccountLite, "id" | "code" | "name">>,
): EntryPreview | null {
  const amount = mapped.amount;
  if (!amount || !/^-?\d+\.\d{2}$/.test(amount)) return null;
  const cents = toCents(amount);
  if (cents === 0) return null;
  const cash = accounts.get(String(options.cash_account_id ?? ""));
  const map = (options.account_map ?? {}) as Record<string, string>;
  const other = accounts.get(map[normalizeKey(mapped.category_key ?? "")] ?? "");
  if (!cash || !other) return null;
  const abs = fromCents(Math.abs(cents));
  const cashSide = { label: label(cash), amount: abs };
  const otherSide = { label: label(other), amount: abs };
  return {
    date: mapped.date ?? "",
    description: mapped.description ?? "",
    debit: cents > 0 ? cashSide : otherSide,
    credit: cents > 0 ? otherSide : cashSide,
  };
}

/** Payments (money out) that name a payee linked to a contractor, counted per contractor. */
export function payeeLinkCounts(
  rows: { mapped: Record<string, string> }[],
  options: Options,
  vendorNames: Map<string, string>,
): { name: string; count: number }[] {
  const links = (options.payee_map ?? {}) as Record<string, string>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const payee = r.mapped.payee;
    const amount = r.mapped.amount;
    if (!payee || !amount || !/^-/.test(amount)) continue;
    const vendor = links[normalizeKey(payee)];
    const name = vendor ? vendorNames.get(vendor) : undefined;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Money in and out per distinct category value, in cents-safe strings. */
export function categoryTotals(rows: { mapped: Record<string, string> }[], field: string) {
  const out = new Map<string, { key: string; sample: string; count: number; inCents: number; outCents: number }>();
  for (const r of rows) {
    const v = r.mapped[field];
    if (!v) continue;
    const key = normalizeKey(v);
    const hit = out.get(key) ?? { key, sample: v, count: 0, inCents: 0, outCents: 0 };
    hit.count += 1;
    const a = r.mapped.amount;
    if (a && /^-?\d+\.\d{2}$/.test(a)) {
      const c = toCents(a);
      if (c > 0) hit.inCents += c;
      else hit.outCents += -c;
    }
    out.set(key, hit);
  }
  return [...out.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .map((c) => ({ key: c.key, sample: c.sample, count: c.count, totalIn: fromCents(c.inCents), totalOut: fromCents(c.outCents) }));
}

/** The calendar year a date falls in, for "Add 2025". */
export function yearOf(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(iso ?? "");
  return m ? Number(m[1]) : null;
}
