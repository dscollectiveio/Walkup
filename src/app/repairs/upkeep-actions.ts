"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { initialNextDue, nextDueAfter, UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

const todayIso = () => new Date().toISOString().slice(0, 10);

async function context() {
  const supabase = await createClient();
  const [{ data: associations }, { data: auth }] = await Promise.all([
    supabase.from("associations").select("id").limit(1),
    supabase.auth.getUser(),
  ]);
  return { supabase, associationId: associations?.[0]?.id ?? null, userId: auth.user?.id ?? null };
}

function parseTask(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const interval = Number(formData.get("interval_months"));
  const rawMonth = String(formData.get("due_month") ?? "");
  const dueMonth = rawMonth ? Number(rawMonth) : null;
  const vendorId = String(formData.get("vendor_id") ?? "") || null;
  const rawCost = String(formData.get("estimated_cost") ?? "").trim();
  const cost = rawCost === "" ? null : Number(rawCost);
  if (!name) return { error: "Give the task a name." as const };
  if (!Number.isInteger(interval) || interval < 1 || interval > 120) return { error: "Choose how often it's done." as const };
  if (dueMonth !== null && (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12)) return { error: "Choose a month." as const };
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { error: "The cost can't be negative." as const };
  return { name, description, interval, dueMonth, vendorId, cost };
}

export async function addUpkeepTask(_prev: unknown, formData: FormData) {
  const parsed = parseTask(formData);
  if ("error" in parsed) return { error: parsed.error };
  const { supabase, associationId, userId } = await context();
  if (!associationId) return { error: "No association is visible to you." };
  const nextDue = String(formData.get("next_due_on") ?? "") || initialNextDue(todayIso(), parsed.dueMonth);
  const { error } = await supabase.from("upkeep_tasks").insert({
    association_id: associationId,
    name: parsed.name,
    description: parsed.description,
    interval_months: parsed.interval,
    due_month: parsed.dueMonth,
    next_due_on: nextDue,
    vendor_id: parsed.vendorId,
    estimated_cost: parsed.cost,
    created_by: userId,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can add upkeep." : error.message };
  revalidatePath("/repairs");
  return { ok: true };
}

export async function updateUpkeepTask(_prev: unknown, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const parsed = parseTask(formData);
  if ("error" in parsed) return { error: parsed.error };
  const { supabase } = await context();
  const nextDue = String(formData.get("next_due_on") ?? "");
  const { data, error } = await supabase
    .from("upkeep_tasks")
    .update({
      name: parsed.name,
      description: parsed.description,
      interval_months: parsed.interval,
      due_month: parsed.dueMonth,
      vendor_id: parsed.vendorId,
      estimated_cost: parsed.cost,
      ...(nextDue ? { next_due_on: nextDue } : {}),
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can change upkeep." };
  revalidatePath("/repairs");
  return { ok: true };
}

/** Logs a completion and rolls the task's next due date forward. */
export async function markUpkeepDone(_prev: unknown, formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const doneOn = String(formData.get("done_on") ?? "") || todayIso();
  const rawCost = String(formData.get("cost") ?? "").trim();
  const cost = rawCost === "" ? null : Number(rawCost);
  const note = String(formData.get("note") ?? "").trim() || null;
  const vendorId = String(formData.get("vendor_id") ?? "") || null;
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { error: "The cost can't be negative." };

  const { supabase, associationId, userId } = await context();
  if (!associationId) return { error: "No association is visible to you." };
  const { data: tasks } = await supabase.from("upkeep_tasks").select("id, interval_months, due_month").eq("id", id).limit(1);
  const task = tasks?.[0];
  if (!task) return { error: "That task isn't visible to you." };

  const { error: logError } = await supabase.from("upkeep_log").insert({
    association_id: associationId,
    task_id: id,
    done_on: doneOn,
    cost,
    note,
    vendor_id: vendorId,
    created_by: userId,
  });
  if (logError) return { error: logError.code === "42501" ? "Only a board member can mark upkeep done." : logError.message };

  const { error } = await supabase
    .from("upkeep_tasks")
    .update({
      last_done_on: doneOn,
      next_due_on: nextDueAfter(doneOn, task.interval_months, task.due_month),
      ...(vendorId ? { vendor_id: vendorId } : {}),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/repairs");
  revalidatePath("/");
  return { ok: true };
}

export async function archiveUpkeepTask(id: string) {
  const { supabase } = await context();
  const { data, error } = await supabase.from("upkeep_tasks").update({ is_active: false }).eq("id", id).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can remove upkeep." };
  revalidatePath("/repairs");
  return { ok: true };
}

/** Adds the ticked starter tasks, skipping any the building already has by name. */
export async function addUpkeepTemplates(names: string[]) {
  const { supabase, associationId, userId } = await context();
  if (!associationId) return { error: "No association is visible to you." };
  const chosen = UPKEEP_TEMPLATES.filter((t) => names.includes(t.name));
  if (chosen.length === 0) return { error: "Tick at least one." };
  const { data: existing } = await supabase.from("upkeep_tasks").select("name").eq("is_active", true);
  const have = new Set((existing ?? []).map((e) => e.name.toLowerCase()));
  const today = todayIso();
  const rows = chosen
    .filter((t) => !have.has(t.name.toLowerCase()))
    .map((t) => ({
      association_id: associationId,
      name: t.name,
      description: t.description,
      interval_months: t.interval_months,
      due_month: t.due_month,
      next_due_on: initialNextDue(today, t.due_month),
      created_by: userId,
    }));
  if (rows.length === 0) return { ok: true, added: 0 };
  const { error } = await supabase.from("upkeep_tasks").insert(rows);
  if (error) return { error: error.code === "42501" ? "Only a board member can add upkeep." : error.message };
  revalidatePath("/repairs");
  return { ok: true, added: rows.length };
}
