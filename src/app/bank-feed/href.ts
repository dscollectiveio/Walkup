/**
 * The bank feed's URL state, in one place: the server page reads these query
 * params and the client filters bar writes them, so they must agree on names
 * and defaults. A default value is left out of the URL.
 */

export type Range = "this_month" | "last_30" | "all";
export type Status = "all" | "needs" | "ready" | "posted" | "excluded" | "retracted";
export type Sort = "date_desc" | "date_asc" | "name_asc" | "name_desc" | "amount_desc" | "amount_asc";

export const RANGE_LABEL: Record<Range, string> = {
  all: "All synced",
  this_month: "This month",
  last_30: "Last 30 days",
};

/** Rows per page load. "Load earlier" doubles it, up to the cap. */
export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 2000;

export interface FeedParams {
  q?: string;
  range: Range;
  status: Status;
  sort: Sort;
  account?: string;
  limit?: number;
}

export function bankFeedHref(p: FeedParams): string {
  const params = new URLSearchParams();
  if (p.q) params.set("q", p.q);
  if (p.account) params.set("account", p.account);
  if (p.range !== "all") params.set("range", p.range);
  if (p.status !== "all") params.set("status", p.status);
  if (p.sort !== "date_desc") params.set("sort", p.sort);
  if (p.limit && p.limit !== DEFAULT_LIMIT) params.set("limit", String(p.limit));
  const qs = params.toString();
  return `/bank-feed${qs ? `?${qs}` : ""}`;
}
