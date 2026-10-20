"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OWNER_FINANCES_COPY } from "@/lib/owner/finances";

/** A board admin switches the owner Finances page on or off (0079 set_owner_finances_enabled). */
export async function setOwnerFinancesEnabled(enabled: boolean): Promise<{ ok: true } | { error: string }> {
  if (typeof enabled !== "boolean") return { error: OWNER_FINANCES_COPY.toggleFailed };
  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  const associationId = associations?.[0]?.id as string | undefined;
  if (!associationId) return { error: OWNER_FINANCES_COPY.toggleFailed };

  const { error } = await supabase.rpc("set_owner_finances_enabled", { p_association_id: associationId, p_enabled: enabled });
  if (error) {
    if (error.code === "42501") return { error: "Only a board admin can change this." };
    console.error("setOwnerFinancesEnabled", error.code);
    return { error: OWNER_FINANCES_COPY.toggleFailed };
  }
  revalidatePath("/building");
  // The sidebar item for owners comes from the layout.
  revalidatePath("/", "layout");
  return { ok: true };
}
