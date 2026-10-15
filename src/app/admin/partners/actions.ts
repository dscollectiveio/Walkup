"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Platform admin: broker partners (global). Moved unchanged from
// src/app/insurance/actions.ts (insurance-spec §8.12).

function optionalText(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

export async function savePartner(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return { error: "Only a platform admin can manage broker partners." };

  const id = optionalText(formData, "id");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("contact_email") ?? "").trim();
  const states = String(formData.get("states_served") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (!name || !email) return { error: "A name and contact email are required." };
  if (states.length === 0) return { error: "List at least one state, like IL." };

  const row = {
    name,
    contact_email: email,
    phone: optionalText(formData, "phone"),
    states_served: states,
    active: formData.get("active") === "on",
    notes: optionalText(formData, "notes"),
  };
  const { error } = id
    ? await supabase.from("insurance_partners").update(row).eq("id", id)
    : await supabase.from("insurance_partners").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin/partners");
  revalidatePath("/insurance", "layout");
  revalidatePath("/");
  return { ok: true };
}
