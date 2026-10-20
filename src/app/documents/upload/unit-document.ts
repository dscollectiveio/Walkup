import "server-only";
import { revalidatePath } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { ACCEPTED_TYPES, checksum, mimeEssence, verifyFile } from "@/lib/documents/file-type";
import {
  MAX_DOCUMENT_BYTES,
  buildUnitDocumentPath,
  isUuid,
  parseUnitDocumentPath,
  randomSuffix,
} from "@/lib/documents/upload-paths";
import { isUnitDocumentKind } from "@/lib/owner/unit-documents";
import { UPLOAD_COPY, contentsMismatch, couldNotSave, notFinished, tooBig } from "@/components/upload/upload-copy";

/**
 * The unit_document purpose of the direct-upload path (migration 0079): a file an owner adds for their own
 * unit, or the board for any unit. Called by createUploadTarget() and registerUpload() in ./actions, which
 * stay the only entry points. Who may add what is decided in the database (unit_document_association_id,
 * the storage policies, register_unit_document); the checks here give a plain answer first and re-read the
 * stored bytes the way the hub path does.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type UnitDocumentRegistered =
  | { ok: true; documentId: string; duplicateOf?: string }
  | { ok: true; documentId: null; alreadyStored: true; onThisProblem: boolean; narrowerAudience?: boolean }
  | { error: string };

/** The signed upload path for a file for one unit; refused unless the caller may add documents for it. */
export async function createUnitDocumentTarget(
  supabase: Supabase,
  input: { unitId: string | undefined; filename: string },
): Promise<{ path: string } | { error: string }> {
  const { unitId, filename } = input;
  if (typeof unitId !== "string" || !isUuid(unitId)) return { error: UPLOAD_COPY.cantAddUnitDocument };
  const { data: associationId } = await supabase.rpc("unit_document_association_id", { p_unit_id: unitId });
  if (!associationId) return { error: UPLOAD_COPY.cantAddUnitDocument };
  return {
    path: buildUnitDocumentPath({
      associationId: String(associationId),
      unitId,
      now: Date.now(),
      suffix: randomSuffix(),
      filename,
    }),
  };
}

async function discard(supabase: Supabase, path: string) {
  try {
    // The storage policy lets the uploader delete an object that has no documents row. If a row exists the
    // policy refuses, which is what we want.
    await supabase.storage.from("documents").remove([path]);
  } catch {
    // An orphan readable only by its uploader for a day; nothing to tell them.
  }
}

export async function registerUnitDocument(
  supabase: Supabase,
  input: {
    path: string;
    filename: string;
    unitId: string | undefined;
    unitKind: string | undefined;
    title?: string;
  },
): Promise<UnitDocumentRegistered> {
  const { path, filename, unitId, unitKind, title } = input;

  const parsed = parseUnitDocumentPath(path);
  if (!parsed || typeof unitId !== "string" || !isUuid(unitId) || parsed.unitId !== unitId) {
    return { error: UPLOAD_COPY.pathMismatch };
  }
  if (!isUnitDocumentKind(unitKind)) return { error: UPLOAD_COPY.pathMismatch };

  const { data: associationId } = await supabase.rpc("unit_document_association_id", { p_unit_id: unitId });
  if (!associationId || String(associationId) !== parsed.associationId) {
    return { error: UPLOAD_COPY.cantAddUnitDocument };
  }

  // Idempotency: a retried register after a dropped response. Never deletes anything.
  const { data: registered } = await supabase
    .from("documents")
    .select("id")
    .eq("association_id", parsed.associationId)
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
    return { error: tooBig("unit_document", filename) };
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

  const { data, error } = await supabase.rpc("register_unit_document", {
    p_unit_id: unitId,
    p_storage_path: path,
    p_filename: filename,
    p_mime_type: verdict.mime,
    p_byte_size: bytes.length,
    p_checksum: digest,
    p_kind: unitKind,
    p_title: title?.trim() || null,
  });

  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "not_uploaded") return { error: notFinished(filename) };
    if (hint === "unit_limit") {
      await discard(supabase, path);
      return { error: UPLOAD_COPY.unitDocumentLimit };
    }
    if (hint === "daily_limit") {
      await discard(supabase, path);
      return { error: UPLOAD_COPY.unitDocumentDaily };
    }
    if (error.code === "42501") return { error: UPLOAD_COPY.cantAddUnitDocument };
    if (error.code === "22023") return { error: contentsMismatch(filename) };
    console.error("registerUnitDocument", error.code, path);
    return { error: couldNotSave(filename) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as { document_id: string | null; duplicate: boolean } | undefined;
  if (!row) {
    console.error("registerUnitDocument", "no_row", path);
    return { error: couldNotSave(filename) };
  }

  if (row.duplicate) {
    // The identical file is already stored: this upload is redundant either way.
    await discard(supabase, path);
    if (row.document_id) return { ok: true, documentId: row.document_id, duplicateOf: row.document_id };
    return { ok: true, documentId: null, alreadyStored: true, onThisProblem: false };
  }

  // The bytes were checked before the row existed, and until it did the uploader could still swap the object
  // at this path. Read it once more now that the row is there: if it is no longer what was checked, remove
  // the document (REVIEW-2 #19).
  const documentId = row.document_id as string;
  const again = await supabase.storage.from("documents").download(path);
  const unchanged =
    !again.error && again.data !== null && (await checksum(new Uint8Array(await again.data.arrayBuffer()))) === digest;
  if (!unchanged) {
    await supabase.rpc("remove_unit_document", { p_document_id: documentId });
    return { error: contentsMismatch(filename) };
  }

  revalidatePath("/owner");
  revalidatePath("/documents");
  return { ok: true, documentId };
}
