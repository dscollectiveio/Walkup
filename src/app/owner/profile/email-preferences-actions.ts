"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";

export type PreferencesState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/**
 * Which emails the signed-in person accepts (money spec 8.6). Only their own
 * row: set_my_email_preferences() resolves the person from the session, never
 * from anything the browser sends.
 */
export async function setMyEmailPreferences(_prev: PreferencesState, formData: FormData): Promise<PreferencesState> {
  const viewer = await getViewer();
  if (!viewer) return { status: "error", message: "Something went wrong. Try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_email_preferences", {
    p_association_id: viewer.associationId,
    p_dues_reminders: formData.get("dues_reminders") === "on",
    p_statements: formData.get("statements") === "on",
    p_announcements: formData.get("announcements") === "on",
    p_unsubscribed_all: formData.get("stop_all") === "on",
  });
  if (error) {
    console.error("[walkup-email] set_my_email_preferences", error.code ?? "-");
    return { status: "error", message: "Something went wrong. Try again." };
  }
  revalidatePath("/owner/profile");
  return { status: "saved" };
}
