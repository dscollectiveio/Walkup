import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shortDate } from "@/lib/dates";

export interface UnitDocumentRow {
  documentId: string;
  unitId: string;
  title: string;
  filename: string;
  kind: string | null;
  dateText: string;
  addedByKind: string;
  addedByName: string | null;
  canRemove: boolean;
}

/**
 * The unit documents of the given units, through unit_owner_documents() (which returns only what the caller
 * may read). Null when the call fails, so the page says so instead of showing an empty list that looks true.
 */
export async function loadUnitDocuments(
  supabase: SupabaseClient,
  unitIds: string[],
  todayIso: string,
): Promise<UnitDocumentRow[] | null> {
  const results = await Promise.all(
    unitIds.map(async (unitId) => {
      const { data, error } = await supabase.rpc("unit_owner_documents", { p_unit_id: unitId });
      if (error) {
        console.error("[owner] unit_owner_documents", error.code ?? "-");
        return null;
      }
      return ((data ?? []) as {
        document_id: string;
        title: string | null;
        filename: string;
        kind: string | null;
        uploaded_at: string;
        added_by_kind: string;
        added_by_name: string | null;
        can_remove: boolean;
      }[]).map<UnitDocumentRow>((r) => ({
        documentId: r.document_id,
        unitId,
        title: r.title || r.filename,
        filename: r.filename,
        kind: r.kind,
        dateText: shortDate(r.uploaded_at, todayIso),
        addedByKind: r.added_by_kind,
        addedByName: r.added_by_name,
        canRemove: r.can_remove === true,
      }));
    }),
  );
  if (results.some((r) => r === null)) return null;
  return results.flat() as UnitDocumentRow[];
}
