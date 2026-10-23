"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidateLinked } from "./upload/link-revalidate";
import { documentError } from "@/lib/documents/errors";

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
