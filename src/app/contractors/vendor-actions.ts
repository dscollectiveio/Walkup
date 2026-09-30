"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const ENTITY_TYPES = ["individual", "sole_prop", "partnership", "c_corp", "s_corp", "llc", "other"] as const;

function optionalText(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

/** Everything a contractor row carries, validated. Shared by add and edit. */
function vendorFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter the contractor's name." };

  const entityType = optionalText(formData, "entity_type");
  if (entityType && !(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return { error: "Choose a valid business type." };
  }

  // Last four only, on purpose — DECISIONS #4. A full TIN never enters this app.
  const tinLast4 = optionalText(formData, "tin_last4");
  if (tinLast4 && !/^[0-9]{4}$/.test(tinLast4)) {
    return { error: "Enter only the last four digits of their tax ID." };
  }

  const w9OnFile = formData.get("w9_on_file") === "on";
  const w9ReceivedOn = optionalText(formData, "w9_received_on");

  return {
    fields: {
      name,
      trade: optionalText(formData, "trade"),
      contact_name: optionalText(formData, "contact_name"),
      phone: optionalText(formData, "phone"),
      email: optionalText(formData, "email"),
      entity_type: entityType,
      is_preferred: formData.get("is_preferred") === "on",
      license_number: optionalText(formData, "license_number"),
      insured_until: optionalText(formData, "insured_until"),
      w9_on_file: w9OnFile,
      w9_received_on: w9OnFile ? w9ReceivedOn : null,
      tin_last4: tinLast4,
      is_1099_exempt: formData.get("is_1099_exempt") === "on",
    },
  };
}

export async function addVendor(_prev: unknown, formData: FormData) {
  const parsed = vendorFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase
    .from("vendors")
    .insert({ association_id: associationId, ...parsed.fields });

  if (error) {
    return { error: error.code === "42501" ? "Only a board member can add a contractor." : error.message };
  }

  revalidatePath("/contractors");
  revalidatePath("/");
  return { ok: true };
}

export async function updateVendor(_prev: unknown, formData: FormData) {
  const vendorId = String(formData.get("vendor_id") ?? "");
  if (!vendorId) return { error: "Missing contractor." };

  const parsed = vendorFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update(parsed.fields)
    .eq("id", vendorId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can edit a contractor." };

  revalidatePath("/contractors");
  revalidatePath("/");
  return { ok: true };
}
