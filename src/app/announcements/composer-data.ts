import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AttachableDocument } from "@/lib/owner/announcements";
import type { Viewer } from "@/lib/owner/viewer";
import type { ComposerInitial, ComposerUnit } from "./composer";

/** Everything the composer needs, read under the board member's own RLS. */
export async function loadComposerData(viewer: Viewer, todayIso: string, announcementId: string | null) {
  const supabase = await createClient();
  const [unitsRes, ownersRes, docsRes, existingRes, auRes] = await Promise.all([
    supabase.from("units").select("id, label, sort_order").order("sort_order"),
    supabase.from("unit_owners").select("unit_id, person_id, effective_from, effective_to, persons(full_name)"),
    supabase
      .from("documents")
      .select("id, title, filename, visibility, restricted_to_unit_id")
      .is("deleted_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(50),
    announcementId
      ? supabase
          .from("announcements")
          .select("id, title, body, audience, pinned, importance, status, attachment_document_id, expires_on")
          .eq("id", announcementId)
          .limit(1)
      : Promise.resolve({ data: [] }),
    announcementId
      ? supabase.from("announcement_units").select("unit_id").eq("announcement_id", announcementId)
      : Promise.resolve({ data: [] }),
  ]);

  const ownersByUnit: Record<string, string[]> = {};
  const nameByUnit = new Map<string, string>();
  for (const o of (ownersRes.data ?? []) as unknown as {
    unit_id: string;
    person_id: string;
    effective_from: string;
    effective_to: string | null;
    persons: { full_name: string } | { full_name: string }[] | null;
  }[]) {
    if (o.effective_from > todayIso || (o.effective_to && o.effective_to < todayIso)) continue;
    (ownersByUnit[o.unit_id] ??= []).push(o.person_id);
    const p = Array.isArray(o.persons) ? o.persons[0] : o.persons;
    if (p && !nameByUnit.has(o.unit_id)) nameByUnit.set(o.unit_id, p.full_name);
  }
  const units: ComposerUnit[] = (unitsRes.data ?? []).map((u) => ({
    id: u.id as string,
    label: u.label as string,
    ownerName: nameByUnit.get(u.id as string) ?? null,
  }));
  for (const u of units) ownersByUnit[u.id] ??= [];

  const toDoc = (d: Record<string, unknown>): AttachableDocument => ({
    id: d.id as string,
    title: ((d.title as string | null) || (d.filename as string)) ?? "File",
    visibility: d.visibility === "all_owners" ? "all_owners" : "board_only",
    restrictedToUnitId: (d.restricted_to_unit_id as string | null) ?? null,
  });
  const documents = (docsRes.data ?? []).map(toDoc);

  const row = existingRes.data?.[0] as
    | {
        id: string;
        title: string;
        body: string;
        audience: "all" | "units";
        pinned: boolean;
        importance: "normal" | "important" | "urgent";
        status: "draft" | "published" | "archived";
        attachment_document_id: string | null;
        expires_on: string | null;
      }
    | undefined;

  // The attached file may be older than the newest 50.
  if (row?.attachment_document_id && !documents.some((d) => d.id === row.attachment_document_id)) {
    const { data } = await supabase
      .from("documents")
      .select("id, title, filename, visibility, restricted_to_unit_id")
      .eq("id", row.attachment_document_id)
      .limit(1);
    if (data?.[0]) documents.unshift(toDoc(data[0]));
  }

  const initial: ComposerInitial | null = row && row.status !== "archived"
    ? {
        id: row.id,
        title: row.title,
        body: row.body,
        audience: row.audience,
        unitIds: ((auRes.data ?? []) as { unit_id: string }[]).map((a) => a.unit_id),
        pinned: row.pinned,
        importance: row.importance,
        attachmentDocumentId: row.attachment_document_id,
        expiresOn: row.expires_on,
        status: row.status,
      }
    : null;

  return { units, ownersByUnit, documents, initial, found: Boolean(row), archived: row?.status === "archived", viewerId: viewer.personId };
}
