// The contractor directory's URL, search and sort (repairs-spec §2.2,
// §10.1). Every filter is a GET parameter so a filtered list is linkable;
// invalid values fall back to the default. Pure.

import { BOARD_PRIOR, GOOGLE_PRIOR, bayesianRating } from "./ranking";
import { isTradeSlug, tradeLabel } from "./trades";

export const CONTRACTOR_SORTS = ["status", "name", "last_used", "your_rating", "google_rating"] as const;
export type ContractorSort = (typeof CONTRACTOR_SORTS)[number];
export const SORT_LABEL: Record<ContractorSort, string> = {
  status: "Preferred first",
  name: "Name",
  last_used: "Last used",
  your_rating: "Your rating",
  google_rating: "Google rating",
};

export type ContractorStatus = "preferred" | "okay" | "do_not_use";
const STATUSES: readonly ContractorStatus[] = ["preferred", "okay", "do_not_use"];

export interface DirectoryParams {
  q: string;
  trades: string[];
  status: ContractorStatus | null;
  sort: ContractorSort;
  archived: boolean;
}

type Raw = string | string[] | undefined;
const first = (v: Raw): string | undefined => (Array.isArray(v) ? v[0] : v);
const all = (v: Raw): string[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

export function parseDirectoryParams(sp: { q?: Raw; trade?: Raw; status?: Raw; sort?: Raw; archived?: Raw }): DirectoryParams {
  const q = (first(sp.q) ?? "").trim().slice(0, 100);
  const trades = [...new Set(all(sp.trade).filter((t) => isTradeSlug(t)))];
  const status = STATUSES.find((s) => s === first(sp.status)) ?? null;
  const sort = CONTRACTOR_SORTS.find((s) => s === first(sp.sort)) ?? "status";
  return { q, trades, status, sort, archived: first(sp.archived) === "1" };
}

export function hasDirectoryFilters(p: DirectoryParams): boolean {
  return p.q !== "" || p.trades.length > 0 || p.status !== null || p.archived;
}

export function directoryHref(p: DirectoryParams): string {
  const q = new URLSearchParams({ view: "contractors" });
  if (p.q) q.set("q", p.q);
  for (const t of p.trades) q.append("trade", t);
  if (p.status) q.set("status", p.status);
  if (p.sort !== "status") q.set("sort", p.sort);
  if (p.archived) q.set("archived", "1");
  return `/repairs?${q.toString()}`;
}

export interface DirectoryRow {
  id: string;
  name: string;
  status: ContractorStatus;
  contactName: string | null;
  trades: string[];
  lastUsed: string | null;
  boardAverage: number | null;
  boardCount: number;
  googleRating: number | null;
  googleCount: number | null;
}

/** Name, contact person or a trade label contains the words (case-insensitive). */
export function matchesQuery(row: Pick<DirectoryRow, "name" | "contactName" | "trades">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = [row.name, row.contactName ?? "", ...row.trades.map(tradeLabel)].join(" ").toLowerCase();
  return needle.split(/\s+/).every((w) => hay.includes(w));
}

const STATUS_RANK: Record<ContractorStatus, number> = { preferred: 0, okay: 1, do_not_use: 2 };

/** Highest first, nulls last; ties by name. */
function byNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

export function sortDirectory<T extends DirectoryRow>(rows: T[], sort: ContractorSort): T[] {
  const name = (a: T, b: T) => a.name.localeCompare(b.name);
  const lastUsed = (a: T, b: T) => {
    if (a.lastUsed === b.lastUsed) return 0;
    if (!a.lastUsed) return 1;
    if (!b.lastUsed) return -1;
    return a.lastUsed < b.lastUsed ? 1 : -1;
  };
  const cmp: Record<ContractorSort, (a: T, b: T) => number> = {
    status: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || lastUsed(a, b) || name(a, b),
    name,
    last_used: (a, b) => lastUsed(a, b) || name(a, b),
    your_rating: (a, b) =>
      byNumber(
        a.boardCount > 0 ? bayesianRating(a.boardAverage, a.boardCount, BOARD_PRIOR) : null,
        b.boardCount > 0 ? bayesianRating(b.boardAverage, b.boardCount, BOARD_PRIOR) : null,
      ) || name(a, b),
    google_rating: (a, b) =>
      byNumber(bayesianRating(a.googleRating, a.googleCount, GOOGLE_PRIOR), bayesianRating(b.googleRating, b.googleCount, GOOGLE_PRIOR)) || name(a, b),
  };
  return [...rows].sort(cmp[sort]);
}

/** The compliance Answer's lines: "{name}: {first item}" for up to four, then "and {k} more". */
export function paperworkSummary(items: { id: string; name: string; text: string; tone: "warning" | "bad" }[]): {
  status: "bad" | "attention";
  headline: string;
  shown: { id: string; name: string; text: string }[];
  more: number;
} | null {
  if (items.length === 0) return null;
  const n = items.length;
  return {
    status: items.some((i) => i.tone === "bad") ? "bad" : "attention",
    headline: `${n} ${n === 1 ? "contractor needs" : "contractors need"} paperwork`,
    shown: items.slice(0, 4).map(({ id, name, text }) => ({ id, name, text })),
    more: Math.max(0, n - 4),
  };
}

export const DRAFT_KIND_LABEL: Record<string, string> = {
  general: "Email",
  job: "Go-ahead",
  quote_request: "Quote request",
  w9_request: "W-9 request",
  coi_request: "Certificate request",
  paperwork_request: "Paperwork request",
};

/** Emails waiting: quote requests first, then newest first. */
export function orderDrafts<T extends { kind: string; createdAt: string }>(drafts: T[]): T[] {
  return [...drafts].sort(
    (a, b) => Number(b.kind === "quote_request") - Number(a.kind === "quote_request") || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
  );
}
