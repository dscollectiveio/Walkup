"use server";

import { createClient } from "@/lib/supabase/server";
import { currentAssociationId } from "@/lib/documents/access";
import { LINKABLE_TABLES, type LinkableTable } from "./upload/link-targets";
import { revalidateLinked } from "./upload/link-revalidate";
import { documentError } from "@/lib/documents/errors";

/** Attach a document that's already in the hub, without re-uploading it. */
export async function linkExistingDocument(_prev: unknown, formData: FormData) {
  const documentId = String(formData.get("document_id") ?? "");
  const targetTable = String(formData.get("target_table") ?? "");
  const targetId = String(formData.get("target_id") ?? "");
  const relation = String(formData.get("relation") ?? "").trim() || "source";

  if (!documentId) return { error: "Choose a document." };
  if (!LINKABLE_TABLES.includes(targetTable as LinkableTable)) {
    return { error: "Don't know how to attach a document to that." };
  }
  if (!targetId) return { error: "Missing what to attach this to." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.from("document_links").insert({
    association_id: associationId,
    document_id: documentId,
    target_table: targetTable,
    target_id: targetId,
    relation,
  });
  if (error && error.code !== "23505") return { error: documentError(error) };

  revalidateLinked(targetTable, targetId);
  return { ok: true as const };
}

/**
 * Remove the link, not the document. The file might justify something else
 * too — unlinking one relationship shouldn't touch the document itself or its
 * other links.
 */
export async function unlinkDocument(
  linkId: string,
  targetTable: string,
  targetId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_links")
    .delete()
    .eq("id", linkId)
    .select("id");

  if (error) return { error: documentError(error) };
  if (!data?.length) return { error: "Only the board can detach a document." };

  revalidateLinked(targetTable, targetId);
  return { ok: true };
}
