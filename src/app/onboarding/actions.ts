"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";

export async function createBuilding(_prev: unknown, formData: FormData) {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "").trim().toUpperCase();
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!legalName || !displayName) {
    return { error: "Legal name and display name are both required." };
  }
  if (!/^[A-Z]{2}$/.test(stateCode)) {
    return { error: "State must be a two-letter code, like IL." };
  }
  if (!fullName) return { error: "Your name is required." };

  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_association_and_owner", {
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

  revalidatePath("/", "layout");
  redirect("/");
}
