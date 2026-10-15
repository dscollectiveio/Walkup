import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * One instance wins the right to auto-sync a connection (REVIEW-2 #28). The
 * claim is a compare-and-swap on last_synced_at: it moves from the value this
 * instance read to "now" only if nobody else has moved it, so two serverless
 * instances opening the page together cannot both start from the same cursor.
 * A sync that does not finish puts the old value back; a sync that does sets
 * its own.
 */
export async function claimAutoSync(
  supabase: Supabase,
  connection: { id: string; last_synced_at: string | null },
  nowIso: string,
): Promise<boolean> {
  let q = supabase.from("bank_connections").update({ last_synced_at: nowIso }).eq("id", connection.id).eq("status", "active");
  q = connection.last_synced_at === null ? q.is("last_synced_at", null) : q.eq("last_synced_at", connection.last_synced_at);
  const { data, error } = await q.select("id");
  return !error && (data?.length ?? 0) === 1;
}

/** Put the old value back after a sync that did not finish, unless something newer has been written. */
export async function releaseAutoSync(
  supabase: Supabase,
  connection: { id: string; last_synced_at: string | null },
  nowIso: string,
): Promise<void> {
  await supabase.from("bank_connections").update({ last_synced_at: connection.last_synced_at }).eq("id", connection.id).eq("last_synced_at", nowIso);
}
