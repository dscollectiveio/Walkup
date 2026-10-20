"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { freshSignInError } from "@/lib/security/fresh-signin";

/**
 * What the board shares with an attorney (0080): one unit, or the whole building (documents that belong to
 * no unit). Board admins only; attorney_shares has no other write path, so row level security is the real
 * check and these actions only turn its answer into a sentence.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = { ok: true } | { error: string };

function revalidate() {
  revalidatePath("/building");
  revalidatePath("/documents");
  revalidatePath("/collections");
}

export async function shareWithAttorney(personId: string, unitId: string | null): Promise<Result> {
  if (!UUID.test(personId) || (unitId !== null && !UUID.test(unitId))) return { error: "Choose an attorney and what to share." };
  const supabase = await createClient();
  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };
  const { data: assoc } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  const associationId = assoc?.[0]?.id as string | undefined;
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase
    .from("attorney_shares")
    .insert({ association_id: associationId, person_id: personId, unit_id: unitId });
  if (error) {
    if (error.code === "23505") return { error: "That is already shared with this attorney." };
    if (error.code === "42501") return { error: "Only a board admin can share with an attorney." };
    if (error.code === "23514") return { error: "Only someone who holds the attorney role can be given a share." };
    console.error("[building] attorney share", error.code ?? "-");
    return { error: "Couldn't share that. Try again." };
  }
  revalidate();
  return { ok: true };
}

export async function removeAttorneyShare(shareId: string): Promise<Result> {
  if (!UUID.test(shareId)) return { error: "Choose a share to remove." };
  const supabase = await createClient();
  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };
  const { data, error } = await supabase.from("attorney_shares").delete().eq("id", shareId).select("id");
  if (error) return { error: "Couldn't remove that. Try again." };
  if (!data || data.length === 0) return { error: "That share is already gone, or only a board admin can remove it." };
  revalidate();
  return { ok: true };
}
