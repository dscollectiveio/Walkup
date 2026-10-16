"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Marks the first-login tour as seen, on Done or Skip alike. Stored on the
 * person's own sign-in (user metadata), so it follows them across devices
 * and buildings without a table. Nothing depends on it but the tour itself.
 */
export async function completeTour(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.user_metadata?.tour_completed_at) return;
  const { error } = await supabase.auth.updateUser({ data: { tour_completed_at: new Date().toISOString() } });
  // The layout reads user metadata from the access token's claims, which only
  // pick up the change on the next token; refresh now so a reload doesn't
  // start the tour again.
  if (!error) await supabase.auth.refreshSession();
}
