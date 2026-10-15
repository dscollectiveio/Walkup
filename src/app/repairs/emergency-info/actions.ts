"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import {
  currentAssociationId,
  dbError,
  isBoard,
  isUuid,
  NO_ASSOCIATION,
  textOrNull,
  type Err,
  type Ok,
} from "@/lib/repairs/server";

/**
 * The building's emergency facts and the board contacts owners are shown
 * (repairs-spec §14.3). The board types every value; Walkup never fills a
 * gap with a number it found somewhere.
 */

const BOARD_ONLY = "Only a board member can change the emergency information.";

export interface EmergencyInfoInput {
  water_shutoff_location: string | null;
  gas_utility_name: string | null;
  gas_emergency_phone: string | null;
  electric_panel_location: string | null;
  electric_utility_name: string | null;
  electric_emergency_phone: string | null;
  elevator_company_name: string | null;
  elevator_company_phone: string | null;
  other_notes: string | null;
}

const LIMITS: Record<keyof EmergencyInfoInput, [number, string]> = {
  water_shutoff_location: [200, "Keep the water shut-off under 200 characters."],
  gas_utility_name: [80, "Keep the gas company's name under 80 characters."],
  gas_emergency_phone: [40, "Keep the gas emergency number under 40 characters."],
  electric_panel_location: [200, "Keep the electric panel under 200 characters."],
  electric_utility_name: [80, "Keep the power company's name under 80 characters."],
  electric_emergency_phone: [40, "Keep the power emergency number under 40 characters."],
  elevator_company_name: [120, "Keep the elevator company's name under 120 characters."],
  elevator_company_phone: [40, "Keep the elevator company's number under 40 characters."],
  other_notes: [600, "Keep the other notes under 600 characters."],
};

export async function saveEmergencyInfo(input: EmergencyInfoInput): Promise<Ok | Err> {
  const row: Record<string, string | null> = {};
  for (const key of Object.keys(LIMITS) as (keyof EmergencyInfoInput)[]) {
    const v = textOrNull(input?.[key] ?? null);
    if (v && v.length > LIMITS[key][0]) return { error: LIMITS[key][1] };
    row[key] = v;
  }
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  if (!(await isBoard(supabase, associationId))) return { error: BOARD_ONLY };

  const { error } = await supabase
    .from("building_emergency_info")
    .upsert({ association_id: associationId, ...row }, { onConflict: "association_id" });
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "saveEmergencyInfo" }) };

  revalidatePath("/repairs/emergency-info");
  revalidateRepairs();
  return { ok: true };
}

export interface EmergencyContactInput {
  id: string | null;
  name: string;
  label: string | null;
  phone: string;
  show_to_owners: boolean;
}

export async function saveEmergencyContact(input: EmergencyContactInput): Promise<Ok<{ id: string }> | Err> {
  const name = String(input?.name ?? "").trim();
  const phone = String(input?.phone ?? "").trim();
  const label = textOrNull(input?.label ?? null);
  if (!name) return { error: "Add a name." };
  if (name.length > 120) return { error: "Keep the name under 120 characters." };
  if (phone.replace(/\D/g, "").length < 7 || phone.length > 40) return { error: "Add a phone number with the area code." };
  if (label && label.length > 60) return { error: "Keep the label under 60 characters." };
  if (input.id !== null && !isUuid(input.id)) return { error: "That contact isn't visible to you." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  if (!(await isBoard(supabase, associationId))) return { error: BOARD_ONLY };

  const fields = { name, label, phone, show_to_owners: input.show_to_owners !== false };
  if (input.id) {
    const { data, error } = await supabase.from("building_emergency_contacts").update(fields).eq("id", input.id).select("id");
    if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "saveEmergencyContact update" }) };
    if (!data || data.length === 0) return { error: BOARD_ONLY };
    revalidatePath("/repairs/emergency-info");
    return { ok: true, id: input.id };
  }

  const { data: last } = await supabase
    .from("building_emergency_contacts")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const sortOrder = Math.min(32000, ((last?.[0]?.sort_order as number | undefined) ?? -1) + 1);
  const { data, error } = await supabase
    .from("building_emergency_contacts")
    .insert({ association_id: associationId, ...fields, sort_order: sortOrder })
    .select("id");
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "saveEmergencyContact insert" }) };
  const id = data?.[0]?.id as string | undefined;
  if (!id) return { error: BOARD_ONLY };
  revalidatePath("/repairs/emergency-info");
  return { ok: true, id };
}

/** The new order, as the full list of ids; written in one statement. */
export async function reorderEmergencyContacts(ids: string[]): Promise<Ok | Err> {
  const list = [...new Set((ids ?? []).filter(isUuid))];
  if (list.length === 0 || list.length > 50) return { error: "Nothing to reorder." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: NO_ASSOCIATION };
  if (!(await isBoard(supabase, associationId))) return { error: BOARD_ONLY };

  const { data: rows } = await supabase.from("building_emergency_contacts").select("id, name, label, phone, show_to_owners, person_id").in("id", list);
  const byId = new Map((rows ?? []).map((r) => [r.id as string, r]));
  if (byId.size !== list.length) return { error: "That contact isn't visible to you." };
  const { error } = await supabase.from("building_emergency_contacts").upsert(
    list.map((id, i) => ({ ...byId.get(id), id, association_id: associationId, sort_order: i })),
    { onConflict: "id" },
  );
  if (error) return { error: dbError(error, { denied: BOARD_ONLY, context: "reorderEmergencyContacts" }) };
  revalidatePath("/repairs/emergency-info");
  return { ok: true };
}

export async function deleteEmergencyContact(id: string): Promise<Ok | Err> {
  if (!isUuid(id)) return { error: "That contact isn't visible to you." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("building_emergency_contacts").delete().eq("id", id).select("id");
  if (error) return { error: dbError(error, { denied: "Only a board admin can delete a contact.", context: "deleteEmergencyContact" }) };
  if (!data || data.length === 0) return { error: "Only a board admin can delete a contact." };
  revalidatePath("/repairs/emergency-info");
  return { ok: true };
}
