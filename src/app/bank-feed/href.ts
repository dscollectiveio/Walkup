/**
 * The bank feed's URL state, in one place: the server page reads these query
 * params and the client filters bar writes them, so they must agree on names
 * and defaults. A default value is left out of the URL.
 */

export type Range =
  | "all"
  | "this_month"
  | "last_month"
  | "last_30"
  | "last_90"
  | "this_year"
  | "custom";
export const RANGES: Range[] = [
  "all",
  "this_month",
  "last_month",
  "last_30",
  "last_90",
  "this_year",
  "custom",
];
/**
 * "sort" is everything not yet posted (what needs a category and what has one but is
 * not posted), so the list has two tabs: To sort and Posted. "all" has no tab: it is
 * what a link from the Budget page ("the transactions behind this category") shows.
 * "needs" and "ready" are older links; the page reads them as "sort".
 */
export type Status =
  "all" | "sort" | "needs" | "ready" | "posted" | "excluded" | "retracted";
export type Sort =
  | "date_desc"
  | "date_asc"
  | "name_asc"
  | "name_desc"
  | "amount_desc"
  | "amount_asc";

export const RANGE_LABEL: Record<Range, string> = {
  all: "All dates",
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  this_year: "This year",
  custom: "Custom range…",
};

/**
 * Rows per page load. "Load earlier" doubles it, up to the cap — which stays
 * at hosted Supabase's default max_rows (1,000): PostgREST silently truncates
 * anything above it, and a page that asked for more would never know.
 */
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

export interface FeedParams {
  q?: string;
  range: Range;
  status: Status;
  sort: Sort;
  account?: string;
  /** Custom range ends, YYYY-MM-DD; read only when range is "custom". */
  from?: string;
  to?: string;
  /** One connected bank account (Plaid's account id): checking, savings, and so on. */
  bank?: string;
  limit?: number;
}

export function bankFeedHref(p: FeedParams): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.account) params.set("account", p.account);
  if (p.bank) params.set("bank", p.bank);
  if (p.range !== "all") params.set("range", p.range);
  if (p.range === "custom") {
    if (p.from) params.set("from", p.from);
    if (p.to) params.set("to", p.to);
  }
  // The default is left out: To sort normally, everything when looking at one category.
  if (p.status !== (p.account ? "all" : "sort")) params.set("status", p.status);
  if (p.sort !== "date_desc") params.set("sort", p.sort);
  if (p.limit && p.limit !== DEFAULT_LIMIT)
    params.set("limit", String(p.limit));
  const qs = params.toString();
  return `/bank-feed${qs ? `?${qs}` : ""}`;
}
