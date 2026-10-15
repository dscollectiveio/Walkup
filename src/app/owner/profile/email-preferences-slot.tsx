import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/owner/viewer";
import { EmailPreferencesCard } from "./email-preferences-card";

/**
 * The email preferences card (money-and-reminders-spec 8.6). Reads the
 * signed-in person's own row through my_email_preferences(), which creates it
 * on first look. Renders nothing if the call fails, so the profile page never
 * breaks because of it.
 */
export async function EmailPreferencesSlot() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_email_preferences", { p_association_id: viewer.associationId });
  if (error) {
    console.error("[walkup-email] my_email_preferences", error.code ?? "-");
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean; email: string | null }
    | undefined;
  if (!row) return null;
  return (
    <EmailPreferencesCard
      email={row.email ?? "your email on file"}
      initial={{ dues_reminders: row.dues_reminders, statements: row.statements, announcements: row.announcements, unsubscribed_all: row.unsubscribed_all }}
    />
  );
}
