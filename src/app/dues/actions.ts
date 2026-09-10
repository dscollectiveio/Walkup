"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  return associations?.[0]?.id ?? null;
}

export async function updateDuesPaymentInstructions(_prev: unknown, formData: FormData) {
  const fields = {
    dues_payee_name: String(formData.get("dues_payee_name") ?? "").trim() || null,
    dues_bank_name: String(formData.get("dues_bank_name") ?? "").trim() || null,
    dues_account_number: String(formData.get("dues_account_number") ?? "").trim() || null,
    dues_routing_number: String(formData.get("dues_routing_number") ?? "").trim() || null,
    dues_zelle_handle: String(formData.get("dues_zelle_handle") ?? "").trim() || null,
    dues_payment_notes: String(formData.get("dues_payment_notes") ?? "").trim() || null,
  };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update(fields)
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can edit payment instructions." };
  }

  revalidatePath("/dues");
  return { ok: true };
}
