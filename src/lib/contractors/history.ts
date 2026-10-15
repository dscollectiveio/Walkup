import "server-only";

// A contractor's full history with the association: jobs, quotes, upkeep,
// payments and messages, newest first (repairs-spec §4.12). The loader runs
// under the caller's RLS; mergeHistory and historyTotals are pure.

import type { createClient } from "@/lib/supabase/server";
import { fromCents, toCents } from "@/lib/tax/form1120h";
import { buildingTodayIso } from "@/lib/dates";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type HistoryItem =
  | { kind: "ticket"; date: string; ticketId: string; reference: number; title: string; status: string; cost: string | null }
  | { kind: "bid"; date: string; ticketId: string; reference: number; title: string; status: string; amount: string | null }
  /** ticketId is set when a problem's close-out logged this (the ticket already counts as the job). */
  | { kind: "upkeep"; date: string; taskId: string; taskName: string; cost: string | null; note: string | null; ticketId?: string | null }
  | { kind: "payment"; date: string; expenseId: string; amount: string; account: string | null; memo: string | null }
  | { kind: "message"; date: string; messageId: string; subject: string; status: string; messageKind: string };

export interface HistoryTotals {
  paidThisYear: string;
  paidAllTime: string;
  jobs: number;
  firstUsed: string | null;
  lastUsed: string | null;
}

const KIND_ORDER: Record<HistoryItem["kind"], number> = { payment: 0, ticket: 1, upkeep: 2, bid: 3, message: 4 };

const itemKey = (i: HistoryItem): string => {
  switch (i.kind) {
    case "ticket": return i.ticketId;
    case "bid": return i.ticketId;
    case "upkeep": return i.taskId;
    case "payment": return i.expenseId;
    case "message": return i.messageId;
  }
};

/** All parts as one list, newest first; same day: payments, jobs, upkeep, quotes, then messages. Stable otherwise. */
export function mergeHistory(parts: HistoryItem[][]): HistoryItem[] {
  return parts
    .flat()
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const da = a.item.date.slice(0, 10);
      const db = b.item.date.slice(0, 10);
      if (da !== db) return da < db ? 1 : -1;
      return KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || itemKey(a.item).localeCompare(itemKey(b.item)) || a.i - b.i;
    })
    .map((x) => x.item);
}

/**
 * Money paid (in cents, returned as numeric text), jobs done (problems they
 * were given, plus upkeep they did that no problem already counts) and the
 * first and last dates they worked or were paid.
 */
export function historyTotals(items: HistoryItem[], todayIso: string): HistoryTotals {
  const year = todayIso.slice(0, 4);
  let thisYear = 0;
  let allTime = 0;
  let jobs = 0;
  const used: string[] = [];
  for (const i of items) {
    if (i.kind === "payment") {
      const cents = toCents(i.amount);
      allTime += cents;
      if (i.date.slice(0, 4) === year) thisYear += cents;
      used.push(i.date.slice(0, 10));
    } else if (i.kind === "ticket") {
      jobs++;
      used.push(i.date.slice(0, 10));
    } else if (i.kind === "upkeep") {
      if (!i.ticketId) jobs++;
      used.push(i.date.slice(0, 10));
    }
  }
  used.sort();
  return {
    paidThisYear: fromCents(thisYear),
    paidAllTime: fromCents(allTime),
    jobs,
    firstUsed: used[0] ?? null,
    lastUsed: used[used.length - 1] ?? null,
  };
}

/** An embedded to-one row arrives as an object, or as an array from some relationships. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function rowsOf<T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] {
  if (res.error) throw new Error(`Couldn't load the contractor's ${what}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

export async function loadContractorHistory(supabase: Supabase, vendorId: string): Promise<{
  /** Newest first. */
  items: HistoryItem[];
  totals: HistoryTotals;
  recurringBills: { id: string; name: string; frequency: string; next_due_on: string | null }[];
  /** Tasks where they are the usual contractor. */
  upkeepTasks: { id: string; name: string; next_due_on: string }[];
}> {
  const [tickets, bids, upkeep, payments, messages, bills, tasks] = await Promise.all([
    supabase
      .from("tickets")
      .select("id, reference, title, status, opened_on, ticket_board_details(actual_cost::text, estimated_cost::text)")
      .eq("assigned_vendor_id", vendorId),
    supabase
      .from("ticket_bids")
      .select("id, ticket_id, status, amount::text, requested_on, received_on, created_at, tickets(reference, title)")
      .eq("vendor_id", vendorId),
    supabase
      .from("upkeep_log")
      .select("id, task_id, ticket_id, done_on, cost::text, note, upkeep_tasks(name)")
      .eq("vendor_id", vendorId),
    supabase
      .from("expenses")
      .select("id, paid_on, amount::text, memo, accounts(name)")
      .eq("vendor_id", vendorId),
    supabase
      .from("contractor_messages")
      .select("id, subject, status, kind, created_at, sent_at")
      .eq("vendor_id", vendorId)
      .in("status", ["draft", "sent"]),
    supabase
      .from("recurring_bills")
      .select("id, name, frequency, next_due_on")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .order("next_due_on", { ascending: true, nullsFirst: false }),
    supabase
      .from("upkeep_tasks")
      .select("id, name, next_due_on")
      .eq("vendor_id", vendorId)
      .eq("is_active", true)
      .order("next_due_on", { ascending: true }),
  ]);

  type Cost = { actual_cost: string | null; estimated_cost: string | null };
  const ticketItems: HistoryItem[] = rowsOf<{
    id: string; reference: number; title: string; status: string; opened_on: string;
    ticket_board_details: Cost | Cost[] | null;
  }>(tickets, "problems").map((t) => {
    const cost = one(t.ticket_board_details);
    return {
      kind: "ticket", date: t.opened_on, ticketId: t.id, reference: t.reference, title: t.title, status: t.status,
      cost: cost?.actual_cost ?? cost?.estimated_cost ?? null,
    };
  });

  type Ref = { reference: number; title: string };
  const bidItems: HistoryItem[] = rowsOf<{
    id: string; ticket_id: string; status: string; amount: string | null;
    requested_on: string | null; received_on: string | null; created_at: string; tickets: Ref | Ref[] | null;
  }>(bids, "quotes").map((b) => {
    const t = one(b.tickets);
    return {
      kind: "bid", date: (b.received_on ?? b.requested_on ?? b.created_at).slice(0, 10), ticketId: b.ticket_id,
      reference: t?.reference ?? 0, title: t?.title ?? "A problem", status: b.status, amount: b.amount,
    };
  });

  type TaskName = { name: string };
  const upkeepItems: HistoryItem[] = rowsOf<{
    id: string; task_id: string; ticket_id: string | null; done_on: string; cost: string | null; note: string | null;
    upkeep_tasks: TaskName | TaskName[] | null;
  }>(upkeep, "upkeep").map((u) => ({
    kind: "upkeep", date: u.done_on, taskId: u.task_id, taskName: one(u.upkeep_tasks)?.name ?? "Upkeep",
    cost: u.cost, note: u.note, ticketId: u.ticket_id,
  }));

  type AccountName = { name: string };
  const paymentItems: HistoryItem[] = rowsOf<{
    id: string; paid_on: string; amount: string; memo: string | null; accounts: AccountName | AccountName[] | null;
  }>(payments, "payments").map((p) => ({
    kind: "payment", date: p.paid_on, expenseId: p.id, amount: p.amount, account: one(p.accounts)?.name ?? null, memo: p.memo,
  }));

  const messageItems: HistoryItem[] = rowsOf<{
    id: string; subject: string; status: string; kind: string; created_at: string; sent_at: string | null;
  }>(messages, "messages").map((m) => ({
    kind: "message", date: (m.sent_at ?? m.created_at).slice(0, 10), messageId: m.id, subject: m.subject,
    status: m.status, messageKind: m.kind,
  }));

  const items = mergeHistory([ticketItems, bidItems, upkeepItems, paymentItems, messageItems]);
  return {
    items,
    totals: historyTotals(items, buildingTodayIso()),
    recurringBills: rowsOf<{ id: string; name: string; frequency: string; next_due_on: string | null }>(bills, "bills"),
    upkeepTasks: rowsOf<{ id: string; name: string; next_due_on: string }>(tasks, "upkeep tasks"),
  };
}
