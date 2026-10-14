"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";

export async function createBuilding(_prev: unknown, formData: FormData) {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "").trim().toUpperCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const streetAddress = String(formData.get("street_address") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const postalCode = String(formData.get("postal_code") ?? "").trim();
  const county = String(formData.get("county") ?? "").trim() || null;

  if (!legalName || !displayName) {
    return { error: "Legal name and display name are both required." };
  }
  if (!/^[A-Z]{2}$/.test(stateCode)) {
    return { error: "State must be a two-letter code, like IL." };
  }
  if (!fullName) return { error: "Your name is required." };
  if (!streetAddress) return { error: "Enter the building's street address." };
  if (!city) return { error: "Enter the city." };
  if (!/^\d{5}(-\d{4})?$/.test(postalCode)) return { error: "Enter a 5-digit ZIP code, like 60647." };

  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data: associationId, error } = await supabase.rpc("create_association_and_owner", {
    p_legal_name: legalName,
    p_display_name: displayName,
    p_state_code: stateCode,
    p_full_name: fullName,
    p_email: user.email ?? null,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "This account already belongs to a building." };
    }
    return { error: error.message };
  }

  // The new board admin can edit their own association (associations_update).
  // The address is a convenience: if saving it fails the building still exists
  // and it can be added under Building Info, so don't block the sign-up on it.
  if (associationId) {
    await supabase
      .from("associations")
      .update({ street_address: streetAddress, city, postal_code: postalCode, county })
      .eq("id", associationId as string);
  }

  revalidatePath("/", "layout");
  redirect("/");
}
