"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { freshSignInError } from "@/lib/security/fresh-signin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITIONS = ["president", "vice_president", "secretary", "treasurer", "director"];

function refresh() {
  revalidatePath("/access");
  revalidatePath("/building");
  revalidatePath("/");
}

/** Change of board: gives a position to a person, ending the previous holder's hold on it. Board admin only. */
export async function changeBoardPosition(_prev: unknown, formData: FormData): Promise<{ ok: true } | { error: string }> {
  const position = String(formData.get("position") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  const termEnd = String(formData.get("term_end") ?? "").trim();
  const endOldAccess = formData.get("end_old_access") === "on";
  if (!POSITIONS.includes(position)) return { error: "Choose a position." };
  if (!UUID.test(personId)) return { error: "Choose a person." };
  if (termEnd && !/^\d{4}-\d{2}-\d{2}$/.test(termEnd)) return { error: "Enter the term end as a date." };

  const supabase = await createClient();
  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };
  const { data: assoc } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  const associationId = assoc?.[0]?.id as string | undefined;
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.rpc("change_board_position", {
    p_association_id: associationId,
    p_position: position,
    p_person_id: personId,
    p_term_end: termEnd || null,
    p_end_old_access: endOldAccess,
  });
  if (error) {
    if (error.code === "42501") return { error: "Only a board admin can change the board." };
    if (error.code === "22023") return { error: error.message.includes("future") ? "The term has to end in the future." : "That change isn't allowed." };
    return { error: "Couldn't save that. Try again." };
  }
  refresh();
  return { ok: true };
}

/** A holder steps down without a successor. Board admin only. */
export async function endBoardPosition(positionId: string): Promise<{ ok?: true; error?: string }> {
  if (!UUID.test(positionId)) return { error: "Missing position." };
  const supabase = await createClient();
  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };
  const { error } = await supabase.rpc("end_board_position", { p_position_id: positionId });
  if (error) return { error: error.code === "42501" ? "Only a board admin can change the board." : "Couldn't save that. Try again." };
  refresh();
  return { ok: true };
}
