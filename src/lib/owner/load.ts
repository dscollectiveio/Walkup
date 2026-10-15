import "server-only";
import type { Supabase } from "@/lib/repairs/server";
import type { UnitSummary } from "./standing";
import type { Viewer } from "./viewer";
import type { AnnouncementRow } from "./announcements";

/**
 * Reads the owner pages share. Everything goes through the caller's client,
 * so RLS and the SECURITY DEFINER readers decide what comes back.
 */

export interface OwnedUnit {
  id: string;
  label: string;
}

export async function loadOwnedUnits(supabase: Supabase, viewer: Viewer): Promise<OwnedUnit[]> {
  if (viewer.ownedUnitIds.length === 0) return [];
  const { data } = await supabase
    .from("units")
    .select("id, label, sort_order")
    .in("id", viewer.ownedUnitIds)
    .order("sort_order");
  return (data ?? []).map((u) => ({ id: u.id as string, label: u.label as string }));
}

/** `none`: no row (not this person's unit, or no such unit). `error`: the call failed. */
export type SummaryResult =
  | { ok: true; summary: UnitSummary; hasHistory: boolean }
  | { ok: false; reason: "none" | "error" };

/** unit_statement_summary() for one unit, plus whether anything has ever been charged or paid. */
export async function loadSummary(supabase: Supabase, unitId: string, todayIso: string): Promise<SummaryResult> {
  const { data, error } = await supabase.rpc("unit_statement_summary", { p_unit_id: unitId, p_as_of: todayIso });
  if (error) {
    console.error("[owner] unit_statement_summary", error.code ?? "-", error.message ?? "");
    return { ok: false, reason: "error" };
  }
  const summary = (Array.isArray(data) ? data[0] : data) as UnitSummary | undefined;
  if (!summary) return { ok: false, reason: "none" };
  let hasHistory =
    summary.open_charges > 0 || summary.last_payment_on !== null || Number(summary.owed) > 0 || Number(summary.credit) > 0;
  if (!hasHistory) {
    // Owes nothing and paid nothing: a waived or written-off charge is still history.
    const { count } = await supabase.from("assessment_charges").select("id", { count: "exact", head: true }).eq("unit_id", unitId);
    hasHistory = (count ?? 0) > 0;
  }
  return { ok: true, summary, hasHistory };
}

const ANNOUNCEMENT_COLUMNS =
  "id, title, body, audience, pinned, status, attachment_document_id, expires_on, published_at, edited_at, created_at";

/** Posted, not ended announcements the viewer can see (RLS), pinned first. */
export async function loadAnnouncements(
  supabase: Supabase,
  todayIso: string,
  limit: number,
): Promise<{ rows: AnnouncementRow[]; unread: Set<string> } | null> {
  const { data, error } = await supabase
    .from("announcements")
    .select(ANNOUNCEMENT_COLUMNS)
    .eq("status", "published")
    .or(`expires_on.is.null,expires_on.gte.${todayIso}`)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[owner] announcements", error.code ?? "-", error.message ?? "");
    return null;
  }
  const rows = (data ?? []) as unknown as AnnouncementRow[];
  const unread = await unreadSet(supabase, rows.map((r) => r.id));
  return { rows, unread };
}

/** Which of these the viewer has not opened. A person reads only their own receipts (RLS). */
export async function unreadSet(supabase: Supabase, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("announcement_reads").select("announcement_id").in("announcement_id", ids);
  const read = new Set((data ?? []).map((r) => r.announcement_id as string));
  return new Set(ids.filter((id) => !read.has(id)));
}
