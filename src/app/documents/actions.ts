"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checksum, verifyFile } from "@/lib/documents/file-type";
import { currentAssociationId, signedUrlFor } from "@/lib/documents/access";

const MAX_BYTES = 25 * 1024 * 1024;

export type UploadOutcome =
  | { filename: string; status: "added"; id: string }
  | { filename: string; status: "duplicate"; existingId: string }
  | { filename: string; status: "rejected"; reason: string };

function revalidateDocuments() {
  revalidatePath("/documents");
  revalidatePath("/");
}

/**
 * Store one or more files.
 *
 * Every file is judged on its own: one rejection does not abandon the rest,
 * and the caller gets a per-file verdict rather than a single error for the
 * batch. Uploading five things and being told only that "something failed" is
 * the behaviour this exists to avoid.
 *
 * Storage path stays `<association_id>/<timestamp>-<filename>`, which is what
 * makes the first path segment the tenancy boundary (0019).
 */
export async function uploadDocuments(_prev: unknown, formData: FormData) {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;

  if (files.length === 0) return { error: "Choose a file first." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  // A category carries the visibility a board already agreed on, so filing
  // something as a governing document opens it to owners without anyone
  // having to remember a second setting.
  let visibility = "board_only";
  if (categoryId) {
    const { data } = await supabase
      .from("document_categories")
      .select("default_visibility")
      .eq("id", categoryId)
      .limit(1);
    visibility = data?.[0]?.default_visibility ?? "board_only";
  }

  const results: UploadOutcome[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      results.push({
        filename: file.name,
        status: "rejected",
        reason: "is larger than 25 MB. Try a smaller scan, or split it.",
      });
      continue;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // The bytes decide the type, not the browser's guess and not the
    // extension — see lib/documents/file-type.ts.
    const verdict = verifyFile(file.type, bytes);
    if (!verdict.ok) {
      results.push({ filename: file.name, status: "rejected", reason: verdict.reason });
      continue;
    }

    const digest = await checksum(bytes);
    const { data: existing } = await supabase
      .from("documents")
      .select("id")
      .eq("checksum", digest)
      .is("deleted_at", null)
      .limit(1);

    if (existing?.[0]) {
      results.push({ filename: file.name, status: "duplicate", existingId: existing[0].id });
      continue;
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${associationId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(path, file, { contentType: verdict.mime });

    if (uploadError) {
      results.push({ filename: file.name, status: "rejected", reason: uploadError.message });
      continue;
    }

    const { data: doc, error: rowError } = await supabase
      .from("documents")
      .insert({
        association_id: associationId,
        storage_path: path,
        filename: file.name,
        mime_type: verdict.mime,
        byte_size: file.size,
        checksum: digest,
        category_id: categoryId,
        visibility,
        tag_source: categoryId ? "manual" : null,
      })
      .select("id")
      .single();

    if (rowError || !doc) {
      // Never leave a file behind a row that failed to save.
      await supabase.storage.from("documents").remove([path]);
      results.push({
        filename: file.name,
        status: "rejected",
        reason: rowError?.message ?? "could not be saved.",
      });
      continue;
    }

    results.push({ filename: file.name, status: "added", id: doc.id });
  }

  revalidateDocuments();
  return { ok: true as const, results };
}

/** Mint a fresh signed URL on click rather than embedding one in the page. */
export async function getDownloadUrl(documentId: string) {
  const supabase = await createClient();
  return signedUrlFor(supabase, documentId);
}

/**
 * Move a document between category views.
 *
 * Explicitly does nothing else: the folder, links and permissions are
 * untouched. Retagging answers "what kind of thing is this", and conflating
 * that with "who may see it" is how a filing decision silently becomes a
 * disclosure.
 */
export async function retagDocument(_prev: unknown, formData: FormData) {
  const id = String(formData.get("document_id") ?? "");
  const categoryId = String(formData.get("category_id") ?? "").trim() || null;
  if (!id) return { error: "Missing document." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ category_id: categoryId, tag_source: "manual", review_state: "ok" })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can refile a document." };

  revalidateDocuments();
  return { ok: true };
}

export async function renameDocument(_prev: unknown, formData: FormData) {
  const id = String(formData.get("document_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!id) return { error: "Missing document." };

  const supabase = await createClient();
  // A blank title falls back to the filename in the database (0020), so
  // clearing the box is a reset rather than an error.
  const { data, error } = await supabase
    .from("documents")
    .update({ title })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can rename a document." };

  revalidateDocuments();
  return { ok: true };
}

/**
 * Who can see this. Pinning to a unit narrows to that unit's owner and the
 * board; it never widens (0020).
 */
export async function setDocumentVisibility(_prev: unknown, formData: FormData) {
  const id = String(formData.get("document_id") ?? "");
  const visibility = String(formData.get("visibility") ?? "");
  const unitId = String(formData.get("restricted_to_unit_id") ?? "").trim() || null;

  if (!id) return { error: "Missing document." };
  if (!["board_only", "all_owners"].includes(visibility)) {
    return { error: "Choose who can see this." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ visibility, restricted_to_unit_id: unitId })
    .eq("id", id)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can change who sees a document." };

  revalidateDocuments();
  return { ok: true };
}

/** Soft delete. Recoverable for 30 days; the board keeps seeing it meanwhile. */
export async function binDocument(documentId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can bin a document." };

  revalidateDocuments();
  return { ok: true };
}

export async function restoreDocument(documentId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ deleted_at: null })
    .eq("id", documentId)
    .select("id");

  if (error) return { error: error.message };
  if (!data?.length) return { error: "Only the board can restore a document." };

  revalidateDocuments();
  return { ok: true };
}

/**
 * Destroy it. board_admin only, by policy, and the file goes with the row.
 *
 * The row is deleted first: if that is refused, the file is still there and
 * nothing is lost. Removing the file first would leave a row pointing at
 * nothing when the delete then failed.
 */
export async function purgeDocument(documentId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .limit(1);
  const path = rows?.[0]?.storage_path;

  const { data, error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .select("id");

  if (error) {
    if (error.code === "23503") {
      return {
        error: "This document is cited by a posted transaction and can't be destroyed.",
      };
    }
    return { error: error.message };
  }
  if (!data?.length) return { error: "Only a board admin can destroy a document." };

  if (path) await supabase.storage.from("documents").remove([path]);

  revalidateDocuments();
  return { ok: true };
}
