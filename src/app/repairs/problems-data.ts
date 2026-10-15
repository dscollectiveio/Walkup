import "server-only";
import type { ProblemParams } from "@/lib/repairs/problems-params";
import { referenceFromQuery, postgrestIlikeValue } from "@/lib/repairs/search";
import { compareForTriage, ticketStage, type BidCounts, type Stage } from "@/lib/repairs/stage";
import type { TicketPriority, TicketStatus } from "@/lib/repairs/labels";
import type { RepairsViewer } from "@/lib/repairs/page-data";
import type { Supabase } from "@/lib/repairs/server";

/**
 * The problems list and pipeline board's query (repairs-spec §5.7, §15.2).
 * Filters run in the query where they can; the stage (which needs quote
 * counts) and the sort run here. Owners get no board details, no quotes and
 * no contractor embed under RLS; their contractor names come from
 * ticket_contractor_names().
 */

export interface ProblemRow {
  id: string;
  reference: number;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  emergency_kind: string | null;
  trade: string | null;
  unitId: string | null;
  unitLabel: string | null;
  locationDetail: string | null;
  openedOn: string;
  createdAt: string;
  scheduledFor: string | null;
  scheduledWindow: string | null;
  assignedVendorId: string | null;
  reportedBy: string | null;
  resolvedAt: string | null;
  contractorName: string | null;
  dueOn: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  expenseId: string | null;
  bids: BidCounts;
  stage: Stage;
}

const BASE =
  "id, reference, title, status, priority, emergency_kind, trade, unit_id, units(label), location_detail, opened_on, created_at, scheduled_for, scheduled_window, assigned_vendor_id, reported_by, resolved_at";
const BOARD = `${BASE}, vendors(name), ticket_board_details(due_on, assignee_person_id, estimated_cost::text, actual_cost::text, expense_id), ticket_bids(status)`;
const BOARD_MINE = `${BASE}, vendors(name), ticket_board_details!inner(due_on, assignee_person_id, estimated_cost::text, actual_cost::text, expense_id), ticket_bids(status)`;

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export const OPEN_LIMIT = 200;
export const DONE_LIMIT = 50;

export async function loadProblems(
  supabase: Supabase,
  viewer: RepairsViewer,
  p: ProblemParams,
  opts: { mode: "list" | "board"; status?: "open" | "done" | "all"; limit?: number },
): Promise<ProblemRow[]> {
  const fin = viewer.canReadFinancials;
  const select = !fin ? BASE : p.mine && viewer.isBoard ? BOARD_MINE : BOARD;
  let q = supabase.from("tickets").select(select);

  const status = opts.status ?? p.status;
  if (opts.mode === "board") {
    // Closed only with "Show closed", and only the last 30 days of them.
    const closedSince = new Date(Date.now() - 30 * 86_400_000).toISOString();
    q = p.closed ? q.or(`status.neq.closed,resolved_at.gte.${closedSince}`) : q.neq("status", "closed");
  } else if (status === "open") q = q.not("status", "in", '("resolved","closed")');
  else if (status === "done") q = q.in("status", ["resolved", "closed"]);

  if (p.urgentOnly) q = q.eq("priority", "urgent");
  if (p.where === "shared") q = q.is("unit_id", null);
  else if (p.where === "units") q = q.not("unit_id", "is", null);
  if (p.trades.length) q = q.in("trade", p.trades);
  if (p.mine) {
    if (viewer.isBoard && viewer.personId) q = q.eq("ticket_board_details.assignee_person_id", viewer.personId);
    else if (viewer.personId) q = q.eq("reported_by", viewer.personId);
  }
  if (p.q) {
    const ref = referenceFromQuery(p.q);
    if (ref !== null) q = q.eq("reference", ref);
    else {
      const v = postgrestIlikeValue(p.q);
      q = q.or(`title.ilike.${v},description.ilike.${v}`);
    }
  }

  const doneOnly = opts.mode === "list" && status === "done";
  q = doneOnly ? q.order("resolved_at", { ascending: false, nullsFirst: false }) : q.order("created_at", { ascending: false });
  const limit = opts.limit ?? (doneOnly ? (p.older ? 1000 : DONE_LIMIT) : status === "all" ? OPEN_LIMIT + DONE_LIMIT : OPEN_LIMIT);
  const { data, error } = await q.limit(limit);
  if (error) {
    console.error("[repairs] problems", error.code ?? "-", error.message ?? "");
    return [];
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  // Owners: contractor names through the narrow reader.
  let names = new Map<string, string>();
  if (!fin) {
    const ids = rows.filter((r) => r.assigned_vendor_id).map((r) => r.id as string);
    if (ids.length) {
      const { data: n } = await supabase.rpc("ticket_contractor_names", { p_ticket_ids: ids.slice(0, 200) });
      names = new Map(((n ?? []) as { ticket_id: string; contractor_name: string }[]).map((x) => [x.ticket_id, x.contractor_name]));
    }
  }

  const today = viewer.todayIso;
  let out: ProblemRow[] = rows.map((r) => {
    const bd = one(r.ticket_board_details as Record<string, unknown> | Record<string, unknown>[] | null);
    const bidRows = (r.ticket_bids as { status: string }[] | null) ?? [];
    const bids: BidCounts = {
      requested: bidRows.filter((b) => b.status === "requested").length,
      received: bidRows.filter((b) => b.status === "received").length,
      accepted: bidRows.filter((b) => b.status === "accepted").length,
    };
    const row: Omit<ProblemRow, "stage"> = {
      id: r.id as string,
      reference: r.reference as number,
      title: r.title as string,
      status: r.status as TicketStatus,
      priority: r.priority as TicketPriority,
      emergency_kind: (r.emergency_kind as string | null) ?? null,
      trade: (r.trade as string | null) ?? null,
      unitId: (r.unit_id as string | null) ?? null,
      unitLabel: (one(r.units as { label: string } | { label: string }[] | null)?.label as string | undefined) ?? null,
      locationDetail: (r.location_detail as string | null) ?? null,
      openedOn: r.opened_on as string,
      createdAt: r.created_at as string,
      scheduledFor: (r.scheduled_for as string | null) ?? null,
      scheduledWindow: (r.scheduled_window as string | null) ?? null,
      assignedVendorId: (r.assigned_vendor_id as string | null) ?? null,
      reportedBy: (r.reported_by as string | null) ?? null,
      resolvedAt: (r.resolved_at as string | null) ?? null,
      contractorName: fin
        ? ((one(r.vendors as { name: string } | { name: string }[] | null)?.name as string | undefined) ?? null)
        : (names.get(r.id as string) ?? null),
      dueOn: (bd?.due_on as string | null) ?? null,
      estimatedCost: (bd?.estimated_cost as string | null) ?? null,
      actualCost: (bd?.actual_cost as string | null) ?? null,
      expenseId: (bd?.expense_id as string | null) ?? null,
      bids,
    };
    return { ...row, stage: ticketStage({ status: row.status, assigned_vendor_id: row.assignedVendorId, scheduled_for: row.scheduledFor }, bids, today) };
  });

  if (p.stage && viewer.isBoard) out = out.filter((r) => r.stage === p.stage);
  return out;
}

/** The list's sort (§5.7). "updated" reads ticket_last_activity under the caller's RLS. */
export async function sortProblems(supabase: Supabase, rows: ProblemRow[], sort: ProblemParams["sort"], todayIso: string): Promise<ProblemRow[]> {
  const byTriage = (a: ProblemRow, b: ProblemRow) =>
    compareForTriage(
      { emergency_kind: a.emergency_kind, priority: a.priority, due_on: a.dueOn, created_at: a.createdAt, reference: a.reference },
      { emergency_kind: b.emergency_kind, priority: b.priority, due_on: b.dueOn, created_at: b.createdAt, reference: b.reference },
      todayIso,
    );
  const list = [...rows];
  switch (sort) {
    case "newest":
      return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.reference - a.reference));
    case "due":
      return list.sort((a, b) => {
        if (a.dueOn && b.dueOn) return a.dueOn.localeCompare(b.dueOn) || byTriage(a, b);
        if (a.dueOn) return -1;
        if (b.dueOn) return 1;
        return byTriage(a, b);
      });
    case "updated": {
      const ids = list.map((r) => r.id);
      const last = new Map<string, string>();
      if (ids.length) {
        const { data } = await supabase.from("ticket_last_activity").select("ticket_id, last_activity_at").in("ticket_id", ids);
        for (const r of data ?? []) last.set(r.ticket_id as string, r.last_activity_at as string);
      }
      const at = (r: ProblemRow) => last.get(r.id) ?? r.createdAt;
      return list.sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
    }
    default:
      return list.sort(byTriage);
  }
}

/** Trades used on any ticket, for the filter select. */
export async function tradesInUse(supabase: Supabase): Promise<string[]> {
  const { data } = await supabase.from("tickets").select("trade").not("trade", "is", null).limit(1000);
  return [...new Set((data ?? []).map((r) => r.trade as string))].sort();
}
