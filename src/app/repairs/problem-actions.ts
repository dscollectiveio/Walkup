"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { isUuid } from "@/lib/repairs/server";
import { isWorkStatus } from "@/lib/repairs/work-status";
import { buildingTodayIso } from "@/lib/dates";
import { setTicketPlan } from "@/app/maintenance/actions";

type Result = { ok: true } | { error: string };

/**
 * Sets the board's own tracker on a problem (Not Started ... Completed - Paid).
 * It does not change the problem's lifecycle status. ticket_board_details
 * writes are board-only through RLS, so the policy is the authorization.
 */
export async function setProblemWorkStatus(ticketId: string, workStatus: string): Promise<Result> {
  if (!isUuid(ticketId) || !isWorkStatus(workStatus)) return { error: "Couldn't change that. Try again." };
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!viewer.isBoard) return { error: "Only a board member can change the status." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ticket_board_details")
    .upsert({ ticket_id: ticketId, association_id: viewer.associationId, work_status: workStatus }, { onConflict: "ticket_id" })
    .select("ticket_id");
  if (error) return { error: "Couldn't save that. Try again." };
  if (!data || data.length === 0) return { error: "Only a board member can change the status." };

  revalidatePath("/repairs");
  revalidatePath(`/maintenance/${ticketId}`);
  return { ok: true };
}

/**
 * Ticks or unticks "W-9 collected" for a contractor: whether their W-9 is on
 * file, which is what the 1099-NEC needs. The same flag the Contractors page
 * and the tax reminders read, so the three always agree.
 */
export async function setContractorW9(vendorId: string, collected: boolean): Promise<Result> {
  if (!isUuid(vendorId)) return { error: "Couldn't change that. Try again." };
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!viewer.isBoard) return { error: "Only a board member can change contractor paperwork." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update({ w9_on_file: collected, w9_received_on: collected ? buildingTodayIso() : null })
    .eq("id", vendorId)
    .select("id");
  if (error) return { error: "Couldn't save that. Try again." };
  if (!data || data.length === 0) return { error: "Only a board member can change contractor paperwork." };

  revalidatePath("/repairs");
  revalidatePath("/");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The expanded panel on a line of the Problems list (board only)
// ---------------------------------------------------------------------------

export interface ProblemPanelData {
  vendors: { id: string; name: string; trades: string[] }[];
  assignedVendorId: string | null;
  scheduledFor: string | null;
  dueOn: string | null;
  estimatedCost: string | null;
  actualCost: string | null;
  /** The payments already tied to this problem (any number: a deposit and a balance). */
  linkedIds: string[];
  /** Payments to choose from: the ones already linked, then the contractor's recent ones (else the newest). */
  expenses: { id: string; paid_on: string; amount: string; memo: string | null; vendor_name: string | null }[];
}

type One<T> = T | T[] | null | undefined;
const first = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Everything the expanded panel shows, read under the board member's own RLS. */
export async function loadProblemPanel(ticketId: string): Promise<({ ok: true } & ProblemPanelData) | { error: string }> {
  if (!isUuid(ticketId)) return { error: "That problem isn't visible to you." };
  const viewer = await getViewer();
  if (!viewer?.isBoard) return { error: "Only a board member can do this." };
  const supabase = await createClient();

  const [ticketRes, vendorsRes] = await Promise.all([
    supabase
      .from("tickets")
      .select("assigned_vendor_id, scheduled_for, ticket_board_details(due_on, estimated_cost::text, actual_cost::text), ticket_expenses(expense_id)")
      .eq("id", ticketId)
      .limit(1),
    supabase
      .from("vendors")
      .select("id, name, trades")
      .is("archived_at", null)
      .neq("status", "do_not_use")
      .order("name")
      .limit(300),
  ]);
  const t = ticketRes.data?.[0];
  if (!t) return { error: "That problem isn't visible to you." };
  const bd = first(t.ticket_board_details as One<Record<string, unknown>>);
  const assignedVendorId = (t.assigned_vendor_id as string | null) ?? null;
  const linkedIds = ((t.ticket_expenses as { expense_id: string }[] | null) ?? []).map((x) => x.expense_id);

  type ExpenseRow = { id: string; paid_on: string; amount: string; memo: string | null; vendors: One<{ name: string }> };
  const toOption = (e: ExpenseRow) => ({
    id: e.id,
    paid_on: e.paid_on,
    amount: e.amount,
    memo: (e.memo as string | null) ?? null,
    vendor_name: (first(e.vendors)?.name as string | undefined) ?? null,
  });
  const cols = "id, paid_on, amount::text, memo, vendors(name)";

  let linked: ReturnType<typeof toOption>[] = [];
  if (linkedIds.length) {
    const { data } = await supabase.from("expenses").select(cols).in("id", linkedIds).order("paid_on", { ascending: false });
    linked = ((data ?? []) as unknown as ExpenseRow[]).map(toOption);
  }

  let q = supabase.from("expenses").select(cols).eq("association_id", viewer.associationId);
  if (assignedVendorId) {
    const [y, m, d] = buildingTodayIso().split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, d - 120)).toISOString().slice(0, 10);
    q = q.eq("vendor_id", assignedVendorId).gte("paid_on", from);
  }
  const { data: ex } = await q.order("paid_on", { ascending: false }).limit(20);
  const seen = new Set(linked.map((e) => e.id));
  const expenses = [...linked, ...((ex ?? []) as unknown as ExpenseRow[]).map(toOption).filter((e) => !seen.has(e.id))];

  return {
    ok: true,
    vendors: (vendorsRes.data ?? []).map((v) => ({ id: v.id as string, name: v.name as string, trades: (v.trades as string[] | null) ?? [] })),
    assignedVendorId,
    scheduledFor: ((t.scheduled_for as string | null) ?? null)?.slice(0, 10) ?? null,
    dueOn: (bd?.due_on as string | null) ?? null,
    estimatedCost: (bd?.estimated_cost as string | null) ?? null,
    actualCost: (bd?.actual_cost as string | null) ?? null,
    linkedIds,
    expenses,
  };
}

/**
 * Chooses (or clears) the contractor. Picking one while the line is still at
 * Not Started or Quotes Sent moves it on to Contractor Selected.
 */
export async function assignProblemContractor(ticketId: string, vendorId: string | null, moveStatus: boolean): Promise<Result> {
  const r = await setTicketPlan(ticketId, { assigned_vendor_id: vendorId });
  if ("error" in r) return r;
  if (vendorId && moveStatus) {
    const moved = await setProblemWorkStatus(ticketId, "contractor_selected");
    if ("error" in moved) return moved;
  }
  revalidatePath("/repairs");
  return { ok: true };
}

/** Visit date, target date and estimate, saved together. Empty clears. */
export async function saveProblemPlan(
  ticketId: string,
  input: { scheduled_for: string; due_on: string; estimated_cost: string },
): Promise<Result> {
  // A blank date means "clear it": send null, which the plan schema accepts ("" would fail its date check).
  const r = await setTicketPlan(ticketId, {
    scheduled_for: input.scheduled_for || null,
    due_on: input.due_on || null,
    estimated_cost: input.estimated_cost,
  });
  if ("error" in r) return r;
  revalidatePath("/repairs");
  return { ok: true };
}

/**
 * Ties payments in the books to the problem, any number of them (a deposit and
 * a balance), and records the final cost. One RPC, so the list and the cost are
 * saved together; it runs as the board member, so their RLS and the guard that
 * checks every payment belongs to this association apply. Does not close the problem.
 */
export async function linkProblemPayments(ticketId: string, expenseIds: string[], actualCost: string): Promise<Result> {
  if (!isUuid(ticketId) || expenseIds.some((id) => !isUuid(id))) return { error: "Couldn't change that. Try again." };
  const cost = actualCost.trim().replace(/[$,\s]/g, "");
  if (cost !== "" && !/^\d+(\.\d{1,2})?$/.test(cost)) return { error: "Enter the final cost as a dollar amount, like 450 or 450.50." };
  const viewer = await getViewer();
  if (!viewer?.isBoard) return { error: "Only a board member can link a payment." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_ticket_payments", {
    p_ticket_id: ticketId,
    p_expense_ids: [...new Set(expenseIds)],
    p_actual_cost: cost === "" ? null : Number(cost),
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can link a payment." : "Couldn't save that. Try again." };

  revalidatePath("/repairs");
  revalidatePath(`/maintenance/${ticketId}`);
  return { ok: true };
}
