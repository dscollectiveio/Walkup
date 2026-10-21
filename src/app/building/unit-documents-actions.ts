"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/documents/upload-paths";
import { loadUnitDocuments, type UnitDocumentRow } from "@/lib/owner/unit-documents-load";
import { BOARD_UNIT_DOCUMENT_COPY } from "@/lib/owner/unit-documents";
import { todayIso } from "@/lib/dates";

/**
 * The documents added for one unit, for the board's unit card on Building & Owners. Read through
 * unit_owner_documents(), which returns rows only to the board (any unit) and the unit's owners, so this
 * checks nothing itself: a caller who may not read the unit simply gets an empty list.
 */
export async function listUnitDocuments(unitId: string): Promise<{ rows: UnitDocumentRow[] } | { error: string }> {
  if (typeof unitId !== "string" || !isUuid(unitId)) return { error: BOARD_UNIT_DOCUMENT_COPY.loadFailed };
  const supabase = await createClient();
  const rows = await loadUnitDocuments(supabase, [unitId], todayIso());
  if (rows === null) return { error: BOARD_UNIT_DOCUMENT_COPY.loadFailed };
  return { rows };
}
