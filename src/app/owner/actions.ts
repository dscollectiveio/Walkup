"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { parseProfile, type ProfileFieldErrors } from "@/lib/owner/profile";
import { isUuid } from "@/lib/repairs/server";

export type ProfileResult = { ok: true } | { error: string; fieldErrors?: ProfileFieldErrors } | null;

/** The signed-in person edits their own phone and mailing address (name and email stay the board's). */
export async function updateMyProfile(_prev: unknown, formData: FormData): Promise<Exclude<ProfileResult, null>> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };

  const parsed = parseProfile({ phone: formData.get("phone"), mailingAddress: formData.get("mailing_address") });
  if (!parsed.ok) return { error: "Fix the highlighted fields.", fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_profile", {
    p_association_id: viewer.associationId,
    p_phone: parsed.phone,
    p_mailing_address: parsed.mailingAddress,
  });
  if (error) {
    return { error: error.code === "42501" ? "You can only change your own details." : "Couldn't save that. Try again." };
  }
  revalidatePath("/owner/profile");
  revalidatePath("/owner");
  return { ok: true };
}

/** An owner takes back a payment report the board has not answered. */
export async function withdrawPaymentReport(reportId: string): Promise<{ ok: true } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in again." };
  if (!isUuid(reportId)) return { error: "You can only withdraw your own report." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_payment_report", { p_report_id: reportId });
  if (error) {
    if (error.code === "42501") return { error: "You can only withdraw your own report." };
    if (error.code === "22023") return { error: "The board has already answered this report." };
    return { error: "Couldn't withdraw that. Try again." };
  }
  revalidatePath("/owner/pay");
  revalidatePath("/dues");
  revalidatePath("/");
  return { ok: true };
}
