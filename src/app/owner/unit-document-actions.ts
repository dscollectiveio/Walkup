"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/documents/upload-paths";
import { UNIT_DOCUMENT_COPY } from "@/lib/owner/unit-documents";

/**
 * Remove a document added for a unit (soft delete, 0079 remove_unit_document). An owner: their own upload,
 * within 30 days. The board: any of them. The database decides; this only turns its answer into words.
 */
export async function removeUnitDocument(documentId: string): Promise<{ ok: true } | { error: string }> {
  if (typeof documentId !== "string" || !isUuid(documentId)) return { error: UNIT_DOCUMENT_COPY.removeRefused };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_unit_document", { p_document_id: documentId });
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "window_closed") return { error: UNIT_DOCUMENT_COPY.removeWindowClosed };
    if (error.code === "42501") return { error: UNIT_DOCUMENT_COPY.removeRefused };
    console.error("removeUnitDocument", error.code);
    return { error: UNIT_DOCUMENT_COPY.removeFailed };
  }
  revalidatePath("/owner");
  revalidatePath("/documents");
  return { ok: true };
}
