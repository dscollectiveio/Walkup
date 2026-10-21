import "server-only";
import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { ACCEPTED_TYPES, checksum, mimeEssence, verifyFile } from "@/lib/documents/file-type";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/upload-paths";
import { ACCOUNTANT_UPLOAD_COPY, isAccountantUploadCategory } from "@/lib/documents/accountant-uploads";
import { contentsMismatch, couldNotSave, notFinished, tooBig } from "@/components/upload/upload-copy";

/**
 * The accountant's side of the hub upload (migration 0081). Called by registerUpload() in ./actions when the
 * caller is not on the board; the board's path there is unchanged. Who may add what is decided in the database
 * (accountant_upload_allowed on the storage policy, register_accountant_document, which checks the role, the
 * five categories, the stored object, size, type, checksum and duplicates). The checks here give a plain
 * answer first and re-read the stored bytes the way the hub path does.
 *
 * Not read by the AI at upload: the reader is a board job (claim_ai_call is board only), so the row is stored
 * as skipped and a board member can press "Read it again".
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type AccountantDocumentRegistered =
  | { ok: true; documentId: string; duplicateOf?: string }
  | { ok: true; documentId: null; alreadyStored: true; onThisProblem: boolean; narrowerAudience?: boolean }
  | { error: string };

async function discard(supabase: Supabase, path: string) {
  try {
    // The storage policy lets the uploader delete an object that has no documents row. If a row exists the
    // policy refuses, which is what we want.
    await supabase.storage.from("documents").remove([path]);
  } catch {
    // An orphan readable only by its uploader for a day; nothing to tell them.
  }
}

export async function registerAccountantDocument(
  supabase: Supabase,
  input: { path: string; associationId: string; filename: string; categorySlug: string | undefined; title?: string },
): Promise<AccountantDocumentRegistered> {
  const { path, associationId, filename, categorySlug, title } = input;
  if (!isAccountantUploadCategory(categorySlug)) return { error: ACCOUNTANT_UPLOAD_COPY.notThatCategory };

  // Idempotency: a retried register after a dropped response. Never deletes anything.
  const { data: registered } = await supabase
    .from("documents")
    .select("id")
    .eq("association_id", associationId)
    .eq("storage_path", path)
    .limit(1);
  if (registered?.[0]) return { ok: true, documentId: registered[0].id as string };

  // The stored bytes, read back with the caller's session.
  const { data: blob, error: downloadError } = await supabase.storage.from("documents").download(path);
  if (downloadError || !blob) return { error: notFinished(filename) };

  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) {
    await discard(supabase, path);
    return { error: notFinished(filename) };
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    await discard(supabase, path);
    return { error: tooBig("document", filename) };
  }

  // The browser declared the sniffed type, so a stored type that disagrees with these bytes means something
  // went around the browser check.
  const stored = mimeEssence(blob.type);
  const verdict = verifyFile(stored, bytes);
  if (!verdict.ok || verdict.mime !== stored || !(ACCEPTED_TYPES as readonly string[]).includes(stored)) {
    await discard(supabase, path);
    return { error: contentsMismatch(filename) };
  }

  const digest = await checksum(bytes);

  const { data, error } = await supabase.rpc("register_accountant_document", {
    p_storage_path: path,
    p_filename: filename,
    p_mime_type: verdict.mime,
    p_byte_size: bytes.length,
    p_checksum: digest,
    p_category_slug: categorySlug,
    p_title: title?.trim() || null,
  });

  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "not_uploaded") return { error: notFinished(filename) };
    if (hint === "daily_limit") {
      await discard(supabase, path);
      return { error: ACCOUNTANT_UPLOAD_COPY.limitDaily };
    }
    if (hint === "category") return { error: ACCOUNTANT_UPLOAD_COPY.notThatCategory };
    if (error.code === "42501") return { error: ACCOUNTANT_UPLOAD_COPY.cantAdd };
    if (error.code === "22023") return { error: contentsMismatch(filename) };
    console.error("registerAccountantDocument", error.code, path);
    return { error: couldNotSave(filename) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { document_id: string | null; duplicate: boolean } | undefined;
  if (!row) {
    console.error("registerAccountantDocument", "no_row", path);
    return { error: couldNotSave(filename) };
  }

  if (row.duplicate) {
    // The identical file is already stored: this upload is redundant either way.
    await discard(supabase, path);
    if (row.document_id) return { ok: true, documentId: row.document_id, duplicateOf: row.document_id };
    return { ok: true, documentId: null, alreadyStored: true, onThisProblem: false };
  }

  // The bytes were checked before the row existed, and until it did the uploader could still swap the object
  // at this path. Read it once more now that the row is there: if it is no longer what was checked, remove the
  // document (REVIEW-2 #19).
  const documentId = row.document_id as string;
  const again = await supabase.storage.from("documents").download(path);
  const unchanged =
    !again.error && again.data !== null && (await checksum(new Uint8Array(await again.data.arrayBuffer()))) === digest;
  if (!unchanged) {
    await supabase.rpc("remove_accountant_upload", { p_document_id: documentId });
    return { error: contentsMismatch(filename) };
  }

  revalidatePath("/documents");
  revalidatePath("/");
  return { ok: true, documentId };
}
