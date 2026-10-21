"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { signedUrlFor } from "@/lib/documents/access";
import { runExtraction } from "@/lib/documents/pipeline";
import { documentError } from "@/lib/documents/errors";
import { isUuid } from "@/lib/documents/upload-paths";
import { ACCOUNTANT_UPLOAD_COPY } from "@/lib/documents/accountant-uploads";

function revalidateDocuments() {
  revalidatePath("/documents");
  revalidatePath("/");
}

/**
 * Read a document again — for one that failed, or was uploaded before the
 * pipeline existed. Deliberately available to the board rather than automatic:
 * a retry loop that nobody asked for is how a bad file becomes a bill.
 */
export async function rerunExtraction(
  documentId: string,
): Promise<{ ok?: true; error?: string; detail?: string }> {
  const supabase = await createClient();

  // The update inside runExtraction is RLS-gated, but checking first gives a
  // plain-language refusal instead of a silent no-op.
  const { data } = await supabase
    .from("documents")
    .select("id, association_id")
    .eq("id", documentId)
    .limit(1);
  if (!data?.length) return { error: "That document isn't visible to you." };

  // An owner can see an all-owners document but must not spend the paid read
  // (REVIEW-2 #1). Board only, decided by the database.
  const { data: boardOk } = await supabase.rpc("is_board", { assoc: data[0].association_id });
  if (boardOk !== true) return { error: "Only a board member can have a document read again." };

  const result = await runExtraction(supabase, documentId);
  revalidateDocuments();

  if (result.state === "failed") return { error: result.detail ?? "Reading it failed." };
  return { ok: true, detail: result.detail };
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

  if (error) return { error: documentError(error) };
  if (!data?.length) return { error: "Only the board can refile a document." };

  revalidateDocuments();
  return { ok: true };
}

/**
 * Accept the guess as it stands.
 *
 * The same write as refiling, minus the choosing — confirming is the common
 * case in the review queue and shouldn't cost a dropdown. `tag_source` flips to
 * manual, which is the whole point: from here on it renders as a decision a
 * person made, not a guess.
 */
export async function confirmDocumentTag(
  documentId: string,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .update({ tag_source: "manual", review_state: "ok" })
    .eq("id", documentId)
    .select("id");

  if (error) return { error: documentError(error) };
  if (!data?.length) return { error: "Only the board can confirm a document's category." };

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

  if (error) return { error: documentError(error) };
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

  if (error) return { error: documentError(error) };
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

  if (error) return { error: documentError(error) };
  if (!data?.length) return { error: "Only the board can bin a document." };

  revalidateDocuments();
  return { ok: true };
}

/**
 * The accountant removes a document they added themselves, within 30 days (migration 0081). A soft delete: the
 * board still sees it in the bin. Everything else about who may remove what is decided by the database.
 */
export async function removeOwnUpload(documentId: string): Promise<{ ok?: true; error?: string }> {
  if (typeof documentId !== "string" || !isUuid(documentId)) return { error: ACCOUNTANT_UPLOAD_COPY.removeRefused };
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_accountant_upload", { p_document_id: documentId });
  if (error) {
    if ((error as { hint?: string }).hint === "window_closed") return { error: ACCOUNTANT_UPLOAD_COPY.removeWindowClosed };
    if (error.code === "42501") return { error: ACCOUNTANT_UPLOAD_COPY.removeRefused };
    console.error("removeOwnUpload", error.code);
    return { error: ACCOUNTANT_UPLOAD_COPY.removeFailed };
  }
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

  if (error) return { error: documentError(error) };
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
    return { error: documentError(error) };
  }
  if (!data?.length) return { error: "Only a board admin can destroy a document." };

  if (path) await supabase.storage.from("documents").remove([path]);

  revalidateDocuments();
  return { ok: true };
}
