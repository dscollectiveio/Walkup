"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PENDING_INVITE_COOKIE } from "@/lib/invite-cookie";

export async function redeemInvite(_prev: unknown, formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!token) return { error: "Missing invite." };
  if (!fullName) return { error: "Your name is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("redeem_invite", {
    p_token: token,
    p_full_name: fullName,
  });

  if (error) {
    if (error.code === "23505") {
      return { error: "This account already belongs to a building." };
    }
    // no_data_found covers "not valid" / "already used" / "expired" — the
    // RPC's own message names which one, no need to re-map it here.
    return { error: error.message };
  }

  const jar = await cookies();
  jar.delete(PENDING_INVITE_COOKIE);

  revalidatePath("/", "layout");
  redirect("/");
}
