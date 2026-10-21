"use server";

import { VENDOR_MANAGER_VIEW } from "@/lib/contractors/vendor-source";
import { createClient } from "@/lib/supabase/server";
import { guessTradeFromText, isTradeSlug } from "@/lib/contractors/trades";
import { buildingTodayIso } from "@/lib/dates";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import {
  currentAssociationId,
  dbError,
  isUuid,
  NO_ASSOCIATION,
  SOMETHING_WRONG,
  type Err,
  type Ok,
  type Supabase,
} from "@/lib/repairs/server";
import { isoDate, moneyText } from "@/lib/repairs/validate";
import { allowsDueMonth, initialNextDue, nextDueAfter, UPKEEP_INTERVALS, UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

/**
 * Upkeep actions (repairs-spec §12.1). Adding a task (with its first history
 * entry) and marking one done are single RPCs; a trigger keeps the task's
 * last-done and next-due dates in step with its log, so editing or deleting
 * a log row moves the schedule too. "Today" is the building's (Chicago), not
 * the server's UTC date (map bug 20).
 */

const BOARD_ONLY = "Only a board member can change upkeep.";
const NOT_VISIBLE = "That upkeep job isn't visible to you.";

export interface UpkeepTaskInput {
  name: string;
  description: string | null;
  interval_months: number;
  due_month: number | null;
  /** Omitted: guessed from the name on add, left as it is on edit. */
  trade?: string | null;
  vendor_id: string | null;
  estimated_cost: string | null;   // money text
  last_done_on?: string | null;   // add only: becomes the first history entry
  next_due_on?: string | null;    // explicit override (add and edit)
}

type CleanTask = {
  name: string; description: string | null; interval: number; dueMonth: number | null;
  trade: string | null; vendorId: string | null; cost: string | null; lastDoneOn: string | null; nextDueOn: string | null;
};

function parseTask(input: UpkeepTaskInput, today: string): CleanTask | Err {
  const name = String(input?.name ?? "").trim();
  if (!name) return { error: "Give the job a name." };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };
  const interval = Number(input?.interval_months);
  if (!(UPKEEP_INTERVALS as readonly number[]).includes(interval)) return { error: "Choose how often it's done." };
  const dueMonth = input?.due_month === null || input?.due_month === undefined ? null : Number(input.due_month);
  if (dueMonth !== null) {
    if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12) return { error: "Choose a month." };
    if (!allowsDueMonth(interval)) return { error: 'Pick "Any time" for monthly jobs, or choose a different interval.' };
  }
  const trade = input?.trade ? String(input.trade) : null;
  if (trade !== null && !isTradeSlug(trade)) return { error: "Choose a kind of work." };
  const vendorId = input?.vendor_id || null;
  if (vendorId !== null && !isUuid(vendorId)) return { error: "Choose who usually does it." };
  const cost = moneyText.safeParse(input?.estimated_cost ?? "");
  if (!cost.success) return { error: cost.error.issues[0]?.message ?? "Enter an amount in dollars." };
  const description = String(input?.description ?? "").trim() || null;
  if (description && description.length > 2000) return { error: "Keep the details under 2,000 characters." };

  let lastDoneOn: string | null = null;
  if (input?.last_done_on) {
    const d = isoDate.safeParse(input.last_done_on);
    if (!d.success) return { error: "Enter when it was last done as a date." };
    if (d.data > today) return { error: "The last-done date can't be in the future." };
    lastDoneOn = d.data;
  }
  let nextDueOn: string | null = null;
  if (input?.next_due_on) {
    const d = isoDate.safeParse(input.next_due_on);
    if (!d.success) return { error: "Enter the next due date as a date." };
    nextDueOn = d.data;
  }
  return { name, description, interval, dueMonth, trade, vendorId, cost: cost.data, lastDoneOn, nextDueOn };
}

async function taskRow(supabase: Supabase, taskId: string) {
  if (!isUuid(taskId)) return null;
  const { data } = await supabase
    .from("upkeep_tasks")
    .select("id, association_id, interval_months, due_month, last_done_on, next_due_on, vendor_id")
    .eq("id", taskId)
    .limit(1);
  return data?.[0] ?? null;
}

export async function addUpkeepTask(input: UpkeepTaskInput): Promise<Ok<{ taskId: string; nextDueOn: string }> | Err> {
  const today = buildingTodayIso();
  const t = parseTask(input, today);
  if ("error" in t) return t;
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };

  // The next-due date the board typed wins; else one worked out from the last-done date
  // (the log trigger does that); else initialNextDue.
  const { data, error } = await supabase.rpc("add_upkeep_task", {
    p_association_id: associationId,
    p_name: t.name,
    p_description: t.description,
    p_interval_months: t.interval,
    p_due_month: t.dueMonth,
    p_trade: t.trade ?? guessTradeFromText(t.name),
    p_vendor_id: t.vendorId,
    p_estimated_cost: t.cost,
    p_initial_next_due: initialNextDue(today, t.interval, t.dueMonth),
    p_last_done_on: t.lastDoneOn,
    p_next_due_on: t.nextDueOn,
  });
  if (error) return { error: dbError(error, { denied: "Only a board member can add upkeep.", context: "add_upkeep_task" }) };
  const row = (Array.isArray(data) ? data[0] : data) as { task_id?: string; task_next_due_on?: string } | null;
  if (!row?.task_id || !row.task_next_due_on) return { error: SOMETHING_WRONG };
  revalidateRepairs({ taskId: row.task_id });
  return { ok: true, taskId: row.task_id, nextDueOn: row.task_next_due_on };
}

export async function updateUpkeepTask(taskId: string, input: UpkeepTaskInput): Promise<Ok | Err> {
  const t = parseTask({ ...input, last_done_on: null }, buildingTodayIso());
  if ("error" in t) return t;
  const supabase = await createClient();
  const current = await taskRow(supabase, taskId);
  if (!current) return { error: NOT_VISIBLE };

  // A changed cadence moves the next date from the last time it was done,
  // unless the board typed one; with no history the date stays.
  let nextDue: string | undefined = t.nextDueOn ?? undefined;
  const cadenceChanged = t.interval !== current.interval_months || t.dueMonth !== current.due_month;
  if (!nextDue && cadenceChanged && current.last_done_on) {
    nextDue = nextDueAfter(current.last_done_on, t.interval, t.dueMonth);
  }

  const { data, error } = await supabase
    .from("upkeep_tasks")
    .update({
      name: t.name,
      description: t.description,
      interval_months: t.interval,
      due_month: t.dueMonth,
      ...(input?.trade !== undefined ? { trade: t.trade } : {}),
      vendor_id: t.vendorId,
      estimated_cost: t.cost,
      ...(nextDue ? { next_due_on: nextDue } : {}),
    })
    .eq("id", taskId)
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "updateUpkeepTask" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs({ taskId });
  return { ok: true };
}

function logInput(
  input: { done_on: string; cost: string | null; vendor_id: string | null; note: string | null },
  today: string,
): { doneOn: string; cost: string | null; vendorId: string | null; note: string | null } | Err {
  const d = isoDate.safeParse(input?.done_on ?? "");
  if (!d.success) return { error: "Pick the date it was done." };
  if (d.data > today) return { error: "The date it was done can't be in the future." };
  const cost = moneyText.safeParse(input?.cost ?? "");
  if (!cost.success) return { error: cost.error.issues[0]?.message ?? "Enter an amount in dollars." };
  const vendorId = input?.vendor_id || null;
  if (vendorId !== null && !isUuid(vendorId)) return { error: "Choose who did it." };
  const note = String(input?.note ?? "").trim() || null;
  if (note && note.length > 1000) return { error: "Keep the note under 1,000 characters." };
  return { doneOn: d.data, cost: cost.data, vendorId, note };
}

export async function markUpkeepDone(
  taskId: string,
  input: { done_on: string; cost: string | null; vendor_id: string | null; note: string | null; ticket_id?: string | null },
): Promise<Ok<{ nextDueOn: string; logId: string; reviewPrompt: { vendorId: string; vendorName: string } | null }> | Err> {
  if (!isUuid(taskId)) return { error: NOT_VISIBLE };
  const v = logInput(input, buildingTodayIso());
  if ("error" in v) return v;
  const ticketId = input?.ticket_id || null;
  if (ticketId !== null && !isUuid(ticketId)) return { error: "That problem isn't visible to you." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_upkeep_done", {
    p_task_id: taskId,
    p_done_on: v.doneOn,
    p_cost: v.cost,
    p_vendor_id: v.vendorId,
    p_note: v.note,
    p_ticket_id: ticketId,
  });
  if (error) {
    return { error: dbError(error, { denied: "Only a board member can mark upkeep done.", duplicate: "That problem already logged this job.", context: "mark_upkeep_done" }) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { log_id?: string; task_next_due_on?: string } | null;
  if (!row?.log_id || !row.task_next_due_on) return { error: SOMETHING_WRONG };

  let reviewPrompt: { vendorId: string; vendorName: string } | null = null;
  if (v.vendorId) {
    const { data: vendors } = await supabase.from(VENDOR_MANAGER_VIEW).select("id, name").eq("id", v.vendorId).limit(1);
    if (vendors?.[0]) reviewPrompt = { vendorId: vendors[0].id, vendorName: vendors[0].name };
  }

  revalidateRepairs({ taskId, vendorId: v.vendorId ?? undefined });
  return { ok: true, nextDueOn: row.task_next_due_on, logId: row.log_id, reviewPrompt };
}

/** Correct a history row; the trigger works the schedule out again. */
export async function updateUpkeepLog(
  logId: string,
  input: { done_on: string; cost: string | null; vendor_id: string | null; note: string | null },
): Promise<Ok | Err> {
  if (!isUuid(logId)) return { error: "That entry isn't visible to you." };
  const v = logInput(input, buildingTodayIso());
  if ("error" in v) return v;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("upkeep_log")
    .update({ done_on: v.doneOn, cost: v.cost, vendor_id: v.vendorId, note: v.note })
    .eq("id", logId)
    .select("id, task_id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "updateUpkeepLog" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs({ taskId: data[0].task_id });
  return { ok: true };
}

export async function deleteUpkeepLog(logId: string): Promise<Ok | Err> {
  if (!isUuid(logId)) return { error: "That entry isn't visible to you." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("upkeep_log").delete().eq("id", logId).select("id, task_id");
  if (error) return { error: dbError(error, { denied: "Only a board admin can delete history.", context: "deleteUpkeepLog" }) };
  if (!data || data.length === 0) return { error: "Only a board admin can delete history." };
  revalidateRepairs({ taskId: data[0].task_id });
  return { ok: true };
}

async function setActive(taskId: string, active: boolean): Promise<Ok | Err> {
  if (!isUuid(taskId)) return { error: NOT_VISIBLE };
  const supabase = await createClient();
  const { data, error } = await supabase.from("upkeep_tasks").update({ is_active: active }).eq("id", taskId).select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: active ? "restoreUpkeepTask" : "archiveUpkeepTask" }) };
  if (!data || data.length === 0) return { error: BOARD_ONLY };
  revalidateRepairs({ taskId });
  return { ok: true };
}

export async function archiveUpkeepTask(taskId: string): Promise<Ok | Err> {
  return setActive(taskId, false);
}

export async function restoreUpkeepTask(taskId: string): Promise<Ok | Err> {
  return setActive(taskId, true);
}

/** Board admins, and only a job with no history (archive keeps the history). */
export async function deleteUpkeepTask(taskId: string): Promise<Ok | Err> {
  if (!isUuid(taskId)) return { error: NOT_VISIBLE };
  const supabase = await createClient();
  const { count } = await supabase.from("upkeep_log").select("id", { count: "exact", head: true }).eq("task_id", taskId);
  if ((count ?? 0) > 0) return { error: "It has history, so archive it instead." };
  const { data, error } = await supabase.from("upkeep_tasks").delete().eq("id", taskId).select("id");
  if (error) {
    if (error.code === "23503") return { error: "It has history, so archive it instead." };
    return { error: dbError(error, { denied: "Only a board admin can delete an upkeep job.", context: "deleteUpkeepTask" }) };
  }
  if (!data || data.length === 0) return { error: "Only a board admin can delete an upkeep job." };
  revalidateRepairs();
  return { ok: true };
}

/** Adds the ticked starter tasks, skipping any the building already has by name, in one insert (all or none). */
export async function addUpkeepTemplates(names: string[]): Promise<Ok<{ added: number }> | Err> {
  const chosen = UPKEEP_TEMPLATES.filter((t) => (names ?? []).includes(t.name));
  if (chosen.length === 0) return { error: "Tick at least one." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  const [{ data: existing }, { data: auth }] = await Promise.all([
    supabase.from("upkeep_tasks").select("name").eq("association_id", associationId).eq("is_active", true),
    supabase.auth.getUser(),
  ]);
  const have = new Set((existing ?? []).map((e) => String(e.name).toLowerCase()));
  const today = buildingTodayIso();
  const rows = chosen
    .filter((t) => !have.has(t.name.toLowerCase()))
    .map((t) => ({
      association_id: associationId,
      name: t.name,
      description: t.description,
      interval_months: t.interval_months,
      due_month: t.due_month,
      trade: t.trade,
      next_due_on: initialNextDue(today, t.interval_months, t.due_month),
      created_by: auth?.user?.id ?? null,
    }));
  if (rows.length === 0) return { ok: true, added: 0 };
  const { error } = await supabase.from("upkeep_tasks").insert(rows);
  if (error) return { error: dbError(error, { denied: "Only a board member can add upkeep.", context: "addUpkeepTemplates" }) };
  revalidateRepairs();
  return { ok: true, added: rows.length };
}
