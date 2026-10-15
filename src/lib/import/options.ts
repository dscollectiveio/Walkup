/**
 * Import options: what the person tells Walkup about the books (import-spec 6).
 * Pure. The options live in import_batches.options and are validated again in
 * SQL; the zod schemas here keep a forged server-action call from storing
 * anything but the keys the database reads.
 */

import { z } from "zod";
import { normalizeKey } from "./normalize";
import type { ImportKind } from "./kinds";

const guid = z.guid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const mapKey = z.string().min(1).max(200);
const idMap = z.record(mapKey, guid.nullable()).refine((m) => Object.keys(m).length <= 200, "too many entries");

const transactions = z.object({
  cash_account_id: guid.nullable(),
  default_fund_id: guid.nullable(),
  mapping_confirmed: z.boolean(),
  account_map: idMap,
  fund_map: idMap,
  payee_map: idMap,
}).partial().strict();

const opening = z.object({
  as_of: isoDate.nullable(),
  income_account_id: guid.nullable(),
  ar_account_id: guid.nullable(),
  fund_id: guid.nullable(),
}).partial().strict();

const unitsOwners = z.object({
  effective_from: isoDate.nullable(),
  replace_owners: z.boolean(),
  dues_frequency: z.enum(["monthly", "quarterly", "annual"]),
  dues_starts_on: isoDate.nullable(),
  skip_percentages: z.boolean(),
  amendment_reason: z.string().max(200),
}).partial().strict();

const none = z.object({}).strict();

export function optionsPatchSchema(kind: ImportKind) {
  switch (kind) {
    case "transactions": return transactions;
    case "opening_accounts":
    case "opening_units": return opening;
    case "units_owners": return unitsOwners;
    default: return none;
  }
}

export type Options = Record<string, unknown>;

const MAP_KEYS = new Set(["account_map", "fund_map", "payee_map"]);

/** Merge a validated patch into stored options: a null value or empty string removes a key; the three maps merge by entry. */
export function mergeOptions(current: Options, patch: Options): Options {
  const out: Options = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (MAP_KEYS.has(key) && value && typeof value === "object") {
      const merged: Record<string, unknown> = { ...((current[key] as Record<string, unknown> | undefined) ?? {}) };
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null || v === "") delete merged[k];
        else merged[k] = v;
      }
      out[key] = merged;
    } else if (value === null || value === "" || value === undefined) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface AccountLite {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  is_cash_account: boolean;
  is_active: boolean;
}

/** An account a category can be mapped to: never a cash account, never a receivable. */
export function isMappableAccount(a: AccountLite): boolean {
  return a.is_active && !a.is_cash_account && a.code !== "1200" && a.code !== "1250";
}

/**
 * Categories whose text is exactly an account's name or code (ignoring case and
 * spacing). Those are pre-selected with "Matched by name"; nothing else is ever
 * guessed (decision 3).
 */
export function autoMatchAccounts(categoryKeys: string[], accounts: AccountLite[]): Record<string, string> {
  const byKey = new Map<string, AccountLite>();
  for (const a of accounts.filter(isMappableAccount)) {
    byKey.set(normalizeKey(a.code), a);
    if (!byKey.has(normalizeKey(a.name))) byKey.set(normalizeKey(a.name), a);
  }
  const out: Record<string, string> = {};
  for (const raw of categoryKeys) {
    const key = normalizeKey(raw);
    const hit = byKey.get(key);
    if (key && hit) out[key] = hit.id;
  }
  return out;
}

export interface BooksLite {
  accounts: AccountLite[];
  funds: { id: string; name: string; kind: string }[];
}

/**
 * Starting options for a new batch: the things that have one obvious answer
 * (the only cash account, the only fund, a receivable account called 1200) and
 * exact-name category matches. Never the tax answer for a category.
 */
export function initialOptions(
  kind: ImportKind,
  books: BooksLite,
  distinct: { categories?: string[]; funds?: string[] } = {},
): Options {
  const opts: Options = {};
  if (kind === "transactions") {
    const cash = books.accounts.filter((a) => a.is_cash_account && a.is_active);
    if (cash.length === 1) opts.cash_account_id = cash[0].id;
    if (books.funds.length === 1) opts.default_fund_id = books.funds[0].id;
    const accountMap = autoMatchAccounts(distinct.categories ?? [], books.accounts);
    if (Object.keys(accountMap).length) opts.account_map = accountMap;
    const fundMap: Record<string, string> = {};
    for (const raw of distinct.funds ?? []) {
      const hit = books.funds.find((f) => normalizeKey(f.name) === normalizeKey(raw));
      if (hit) fundMap[normalizeKey(raw)] = hit.id;
    }
    if (Object.keys(fundMap).length) opts.fund_map = fundMap;
  } else if (kind === "opening_units") {
    const ar = books.accounts.find((a) => a.code === "1200" && a.is_active);
    if (ar) opts.ar_account_id = ar.id;
    const operating = books.funds.find((f) => f.kind === "operating") ?? (books.funds.length === 1 ? books.funds[0] : undefined);
    if (operating) opts.fund_id = operating.id;
  }
  return opts;
}

/** Distinct normalised values of one staged field, with counts, for the category and fund tables. */
export function distinctValues(rows: { mapped: Record<string, string> }[], field: string): { key: string; sample: string; count: number }[] {
  const seen = new Map<string, { key: string; sample: string; count: number }>();
  for (const r of rows) {
    const v = r.mapped[field];
    if (!v) continue;
    const key = normalizeKey(v);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { key, sample: v, count: 1 });
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
