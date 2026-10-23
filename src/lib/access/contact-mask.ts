import type { Supabase } from "@/lib/repairs/server";

/**
 * What the accountant may see of other people's contact details (DECISIONS #52): the Treasurer's and the
 * President's, and nobody else's. The board and a property manager see everyone's, as before. Pages that list
 * owners or managers run each email through `mask`, which leaves an officer's address alone and turns every other
 * address into the word "on file" (so "has an email" still reads right, and nothing can be mailed from it).
 *
 * This is the page's side of it. The database still returns `persons.email` to the accountant's own login, because
 * sign-in, invites and every email Walkup sends read that column; hiding it there would be a larger change.
 */

/** The emails of whoever holds the President and Treasurer offices today (lower case). */
export async function officerEmails(supabase: Supabase): Promise<Set<string>> {
  const { data: positions } = await supabase
    .from("board_positions")
    .select("person_id, position, term_end")
    .in("position", ["president", "treasurer"])
    .is("ended_at", null);
  const today = new Date().toISOString().slice(0, 10);
  const ids = (positions ?? []).filter((p) => !p.term_end || (p.term_end as string) >= today).map((p) => p.person_id as string);
  if (ids.length === 0) return new Set();
  const { data: people } = await supabase.from("persons").select("email").in("id", ids);
  return new Set((people ?? []).map((p) => (p.email as string | null)?.trim().toLowerCase()).filter((e): e is string => !!e));
}

/** Everyone but the accountant sees every address; the accountant sees an officer's and "on file" for the rest. */
export function maskEmail(email: string | null, opts: { seesAll: boolean; officers: Set<string> }): string | null {
  if (!email || email.trim() === "") return email;
  if (opts.seesAll) return email;
  return opts.officers.has(email.trim().toLowerCase()) ? email : "on file";
}
