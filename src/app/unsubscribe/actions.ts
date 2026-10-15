"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidToken, unsubscribeResult, type Choices } from "@/lib/email-outbox/unsubscribe";

export type SaveState = { status: "idle" } | { status: "saved"; message: string } | { status: "error"; message: string };

/**
 * Applies what the person chose on the unsubscribe page. Signed out is the
 * normal case: the 48-byte token is the whole credential, and the only power
 * it has is to change that one person's email preferences (0055). Showing the
 * page never changes anything; only this does.
 */
export async function saveEmailChoices(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const token = String(formData.get("token") ?? "");
  if (!isValidToken(token)) return { status: "error", message: "This link isn't valid. It may have been copied wrongly. Open the latest email and use the link at the bottom." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("email_preference_for_token", { p_token: token });
  const current = (Array.isArray(data) ? data[0] : data) as
    | { association_name: string; dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean }
    | undefined;
  if (error || !current) return { status: "error", message: "This link isn't valid. It may have been copied wrongly. Open the latest email and use the link at the bottom." };

  const wanted: Choices = {
    dues_reminders: formData.get("dues_reminders") === "on",
    statements: formData.get("statements") === "on",
    announcements: formData.get("announcements") === "on",
    stop_all: formData.get("stop_all") === "on",
  };
  const result = unsubscribeResult(
    { dues_reminders: current.dues_reminders, statements: current.statements, announcements: current.announcements, stop_all: current.unsubscribed_all },
    wanted,
    current.association_name,
  );
  for (const change of result.changes) {
    const { error: e } = await supabase.rpc("email_unsubscribe", { p_token: token, p_scope: change.scope, p_subscribe: change.subscribe });
    if (e) {
      console.error("[walkup-email] unsubscribe_failed", e.code ?? "-");
      return { status: "error", message: "Something went wrong. Try again." };
    }
  }
  return { status: "saved", message: result.message };
}
