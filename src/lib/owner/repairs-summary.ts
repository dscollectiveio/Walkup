import "server-only";
import type { Supabase } from "@/lib/repairs/server";
import { summariseRepairs, type OwnerRepairsSummary, type TicketGlance } from "./repairs-glance";
import type { Viewer } from "./viewer";

export type { OwnerRepairsSummary } from "./repairs-glance";

/**
 * The owner's repairs in one glance for the portal home (owner-portal-spec
 * 4.5). One query under RLS with only the columns an owner may read
 * (repairs-spec 14): never a cost, an assignee or an internal note.
 */
export async function ownerRepairsSummary(supabase: Supabase, viewer: Viewer, todayIso: string): Promise<OwnerRepairsSummary> {
  const { data, error } = await supabase
    .from("tickets")
    .select("id, reference, title, status, reported_by, resolved_at, scheduled_for, scheduled_window, updated_at")
    .eq("reported_by", viewer.personId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[owner] repairs summary", error.code ?? "-", error.message ?? "");
    return { open: 0, waitingOnYou: 0, latest: null };
  }
  return summariseRepairs((data ?? []) as unknown as TicketGlance[], todayIso);
}
