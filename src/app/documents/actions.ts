"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Upload a document.
 *
 * Storage path is `<association_id>/<timestamp>-<filename>`. The storage policy
 * checks the first path segment against the caller's associations, so the path
 * itself is the tenancy boundary — a guessed path from another building is
 * refused by the database, not by this function. That policy lives in
 * 0019_document_storage_and_audit.sql; until then it existed only in the
 * Supabase dashboard and this comment was a claim nothing in the repo proved.
 *
 * uploaded_by is deliberately not set here — 0019 defaults it to auth.uid(),
 * which is harder to forget than an assignment.
 */
export async function uploadDocument(_prev: unknown, formData: FormData) {
  const file = formData.get("file");
  const relation = String(formData.get("relation") ?? "general");

  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file first." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That file is larger than 25 MB. Try a smaller scan or a PDF." };
  }

  const supabase = await createClient();

  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const path = `${associationId}/${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });

  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  // The row is what RLS protects; the file is reached only through it.
  const { data: doc, error: rowError } = await supabase
    .from("documents")
    .insert({
      association_id: associationId,
      storage_path: path,
      filename: file.name,
      mime_type: file.type || null,
      byte_size: file.size,
    })
    .select("id")
    .single();

  if (rowError) {
    // Do not leave an orphaned file behind a failed row.
    await supabase.storage.from("documents").remove([path]);
    return { error: `Could not save the document record: ${rowError.message}` };
  }

  if (relation && relation !== "general" && doc) {
    await supabase.from("document_links").insert({
      association_id: associationId,
      document_id: doc.id,
      target_table: "associations",
      target_id: associationId,
      relation,
    });
  }

  revalidatePath("/documents");
  return { ok: true };
}

/**
 * Mint a short-lived signed URL.
 *
 * The bucket is private, so there is no permanent public link to leak. The
 * document row is read first: if RLS hides it, no URL is minted at all.
 */
export async function getDownloadUrl(documentId: string) {
  const supabase = await createClient();

  const { data: docs } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .limit(1);

  const path = docs?.[0]?.storage_path;
  if (!path) return { error: "That document isn't visible to you." };

  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(path, 60);

  if (error) return { error: error.message };
  return { url: data.signedUrl };
}
