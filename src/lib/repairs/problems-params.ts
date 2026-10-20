// The /repairs URL: which view, and the problems list's filters
// (repairs-spec §2.2). Pure. Invalid values fall back to the default, never
// an error, so every filtered list is a plain, shareable GET link.

import { isTradeSlug } from "@/lib/contractors/trades";
import { STAGES, type Stage } from "./stage";

export type RepairsView = "problems" | "upkeep" | "contractors" | "bills";
export const REPAIRS_VIEWS: readonly RepairsView[] = ["problems", "upkeep", "contractors", "bills"];

export interface Viewer {
  isBoard: boolean;
  /** Board plus the accountant. */
  canReadFinancials: boolean;
}

export type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

/** The views this viewer may open, in nav order. */
export function viewsFor(viewer: Viewer): RepairsView[] {
  return REPAIRS_VIEWS.filter((v) => {
    if (v === "contractors" || v === "bills") return viewer.canReadFinancials;
    return true;
  });
}

/**
 * The view to render: the URL's when allowed, else Problems. "Today" no longer
 * has a tab of its own (the board's "what needs you this week" sits at the top
 * of Problems), so old ?view=today links land on Problems.
 */
export function resolveView(raw: string | string[] | undefined, viewer: Viewer): RepairsView {
  const allowed = viewsFor(viewer);
  const v = first(raw);
  if (v && (allowed as string[]).includes(v)) return v as RepairsView;
  return "problems";
}

export type ProblemStatusFilter = "open" | "done" | "all";
export type ProblemSort = "priority" | "newest" | "updated" | "due";
export type ProblemLayout = "list" | "board";

export interface ProblemParams {
  layout: ProblemLayout;
  /** True when the URL named the layout (it then wins over the remembered one). */
  layoutFromUrl: boolean;
  q: string;
  status: ProblemStatusFilter;
  stage: Stage | null;
  trades: string[];
  where: "shared" | "units" | null;
  /** Only problems at this urgency (Low, Normal, Urgent); null = any. */
  urgency: "low" | "normal" | "urgent" | null;
  /** Kept for old links: true when urgency is "urgent". */
  urgentOnly: boolean;
  mine: boolean;
  sort: ProblemSort;
  older: boolean;
  /** Pipeline board: show the Closed column (last 30 days). */
  closed: boolean;
}

export function parseProblemParams(sp: SearchParams, viewer: Viewer): ProblemParams {
  const layoutRaw = first(sp.layout);
  const layoutOk = layoutRaw === "list" || (layoutRaw === "board" && viewer.canReadFinancials);
  const status = first(sp.status);
  const stage = first(sp.stage);
  const where = first(sp.where);
  const sort = first(sp.sort);
  const sortOk = sort === "priority" || sort === "newest" || sort === "updated" || (sort === "due" && viewer.isBoard);
  return {
    layout: layoutOk ? (layoutRaw as ProblemLayout) : "list",
    layoutFromUrl: layoutOk,
    q: (first(sp.q) ?? "").trim().slice(0, 100),
    status: status === "open" || status === "done" ? status : "all",
    stage: viewer.isBoard && stage && (STAGES as string[]).includes(stage) ? (stage as Stage) : null,
    trades: [...new Set(all(sp.trade).filter(isTradeSlug))].slice(0, 10),
    where: where === "shared" || where === "units" ? where : null,
    urgency: first(sp.priority) === "low" || first(sp.priority) === "normal" || first(sp.priority) === "urgent" ? (first(sp.priority) as "low" | "normal" | "urgent") : null,
    urgentOnly: first(sp.priority) === "urgent",
    mine: first(sp.mine) === "1",
    sort: sortOk ? (sort as ProblemSort) : "priority",
    older: first(sp.older) === "1",
    closed: first(sp.closed) === "1",
  };
}

/** True when any filter (not the layout) differs from the default. */
export function hasFilters(p: ProblemParams): boolean {
  return Boolean(p.q || p.status !== "all" || p.stage || p.trades.length || p.where || p.urgency || p.urgentOnly || p.mine || p.sort !== "priority");
}

/** The problems URL for these params with some changed; defaults are left out so links stay short. */
export function problemsHref(p: ProblemParams, change: Partial<ProblemParams> = {}): string {
  const n = { ...p, ...change };
  const qs = new URLSearchParams({ view: "problems" });
  if (n.layout === "board") qs.set("layout", "board");
  else if (n.layoutFromUrl) qs.set("layout", "list");
  if (n.q) qs.set("q", n.q);
  if (n.status !== "all") qs.set("status", n.status);
  if (n.stage) qs.set("stage", n.stage);
  for (const t of n.trades) qs.append("trade", t);
  if (n.where) qs.set("where", n.where);
  if (n.urgency) qs.set("priority", n.urgency);
  else if (n.urgentOnly) qs.set("priority", "urgent");
  if (n.mine) qs.set("mine", "1");
  if (n.sort !== "priority") qs.set("sort", n.sort);
  if (n.older) qs.set("older", "1");
  if (n.closed) qs.set("closed", "1");
  return `/repairs?${qs.toString()}`;
}

/** The same params with every filter cleared (layout kept). */
export function clearedParams(p: ProblemParams): ProblemParams {
  return {
    ...p,
    q: "",
    status: "all",
    stage: null,
    trades: [],
    where: null,
    urgency: null,
    urgentOnly: false,
    mine: false,
    sort: "priority",
    older: false,
  };
}
