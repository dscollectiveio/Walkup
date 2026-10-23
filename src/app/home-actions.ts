"use server";

import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";

/**
 * Sets (or clears) the association's reserve savings goal. An ordinary
 * RLS-gated update: associations_update permits board_admin only, so a
 * non-admin's update simply matches zero rows — the policy is the
 * authorization, not this function.
 */
export async function setReserveTarget(_prev: unknown, formData: FormData) {
  const raw = String(formData.get("target") ?? "").trim();
  const target = raw === "" ? null : Number(raw);
  if (target !== null && (!Number.isFinite(target) || target < 0)) {
    return { error: "Enter a dollar amount of zero or more." };
  }

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update({ reserve_target: target })
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can set the reserve target." };
  }

  revalidatePath("/");
  revalidatePath("/building");
  return { ok: true };
}

/**
 * Hides the setup guide for everyone on this association. The guide is
 * otherwise derived entirely from real rows, so this is the one bit of
 * preference it keeps. associations_update is board_admin-only, same as
 * setReserveTarget above.
 */
export async function dismissSetupGuide() {
  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update({ setup_dismissed_at: new Date().toISOString() })
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board admin can hide the setup guide." };

  revalidatePath("/");
  return { ok: true };
}

/** Brings the setup guide back after "Skip for now". Board admin only, like hiding it. */
export async function restoreSetupGuide() {
  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update({ setup_dismissed_at: null })
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board admin can bring the setup guide back." };

  revalidatePath("/");
  return { ok: true };
}

/**
 * Ticks a setup step by hand ("done"), unticks one that ticked itself
 * ("not_done"), or returns it to following the data ("auto"). Stored on the
 * association; associations_update is board_admin-only, so the policy is the
 * authorization.
 */
export async function setSetupStepOverride(stepKey: string, mode: "done" | "not_done" | "auto") {
  if (!/^[a-z0-9_]{1,60}$/.test(stepKey)) return { error: "Couldn't change that step." };
  if (mode !== "done" && mode !== "not_done" && mode !== "auto") return { error: "Couldn't change that step." };

  const supabase = await createClient();
  const { data: rows } = await supabase.from("associations").select("id, setup_overrides").limit(1);
  const association = rows?.[0];
  if (!association) return { error: "No association is visible to you." };

  const current =
    association.setup_overrides && typeof association.setup_overrides === "object" && !Array.isArray(association.setup_overrides)
      ? { ...(association.setup_overrides as Record<string, string>) }
      : {};
  if (mode === "auto") delete current[stepKey];
  else current[stepKey] = mode;

  const { data, error } = await supabase
    .from("associations")
    .update({ setup_overrides: current })
    .eq("id", association.id)
    .select("id");
  if (error) return { error: "Couldn't save that. Try again." };
  if (!data || data.length === 0) return { error: "Only a board admin can change setup steps." };

  revalidatePath("/");
  return { ok: true };
}

export async function addBoardTask(_prev: unknown, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const ownerPersonId = String(formData.get("owner_person_id") ?? "").trim() || null;
  if (!title) return { error: "Give the task a name." };

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.from("board_tasks").insert({
    association_id: associationId,
    title,
    owner_person_id: ownerPersonId,
  });
  if (error) return { error: error.message };

  revalidatePath("/");
  return { ok: true };
}

export async function toggleBoardTask(taskId: string, completed: boolean) {
  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("board_tasks")
    .update(
      completed
        ? { completed_at: new Date().toISOString(), completed_by: user.id }
        : { completed_at: null, completed_by: null },
    )
    .eq("id", taskId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "This task isn't yours to change." };

  revalidatePath("/");
  return { ok: true };
}
