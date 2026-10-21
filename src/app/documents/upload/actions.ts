"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ACCEPTED_TYPES, checksum, mimeEssence, verifyFile } from "@/lib/documents/file-type";
import { currentAssociationId } from "@/lib/documents/access";
import { runExtraction } from "@/lib/documents/pipeline";
import {
  MAX_DOCUMENT_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_TICKET,
  buildStoragePath,
  isPhotoType,
  isUuid,
  parseStoragePath,
  randomSuffix,
} from "@/lib/documents/upload-paths";
import {
  UPLOAD_COPY,
  contentsMismatch,
  couldNotSave,
  notFinished,
  tooBig,
  wrongType,
} from "@/components/upload/upload-copy";
import { isLinkableTable, type LinkableTable } from "./link-targets";
import { revalidateLinked } from "./link-revalidate";
import { createUnitDocumentTarget, registerUnitDocument } from "./unit-document";
import { registerAccountantDocument } from "./accountant-document";
import { ACCOUNTANT_UPLOAD_COPY, isAccountantUploadCategory } from "@/lib/documents/accountant-uploads";

/**
 * Direct uploads (foundation-spec 6.3). Files go browser -> Storage with a
 * signed upload URL issued here, so no file body ever passes through a
 * Server Action (Vercel caps those at 4.5 MB). A second action then
 * registers the `documents` row after re-checking the stored bytes: the
 * browser's own check only saves a round trip, this one decides.
 *
 * Every Supabase call runs with the caller's session. Storage RLS (0019,
 * 0020, 0051) is the real gate; the checks here exist to give a plain
 * answer before the policy gives an opaque one.
 */

export type { LinkableTable };

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Purpose = "document" | "ticket_photo" | "unit_document";

type PhotoRow = { document_id: string };

/**
 * Throw away an unregistered hub upload. Board admins have an unconditional
 * delete policy on the bucket, so the row check is what stops a
 * duplicate-handling path from deleting a file that is registered. Never
 * called for ticket-photo paths (no one but an admin could, and swapping
 * bytes between check and registration is exactly what that rule prevents).
 */
async function removeIfUnregistered(supabase: Supabase, associationId: string, path: string) {
  const { data } = await supabase
    .from("documents")
    .select("id")
    .eq("association_id", associationId)
    .eq("storage_path", path)
    .limit(1);
  if (data?.length) return;
  try {
    await supabase.storage.from("documents").remove([path]);
  } catch {
    // An orphan readable only by its uploader for a day; nothing to tell them.
  }
}

function validFilename(filename: unknown): filename is string {
  return typeof filename === "string" && filename.trim().length > 0 && filename.length <= 255;
}

export async function createUploadTarget(input: {
  filename: string;
  size: number;
  mime: string;
  purpose: Purpose;
  ticketId?: string;
  /** unit_document only: the unit the file is for. */
  unitId?: string;
  /** document only: the category being filed under. Required for the accountant, who may use five. */
  categorySlug?: string;
}): Promise<{ ok: true; path: string; token: string } | { error: string }> {
  const { filename, size, purpose, ticketId, unitId, categorySlug } = input ?? ({} as typeof input);
  const mime = mimeEssence(input?.mime);

  if (!validFilename(filename)) return { error: UPLOAD_COPY.couldNotStart };
  if (!Number.isInteger(size) || size <= 0) return { error: UPLOAD_COPY.couldNotStart };

  if (purpose === "document" || purpose === "unit_document") {
    if (size > MAX_DOCUMENT_BYTES) return { error: tooBig(purpose, filename) };
    if (!(ACCEPTED_TYPES as readonly string[]).includes(mime)) return { error: wrongType(purpose, filename) };
  } else if (purpose === "ticket_photo") {
    if (size > MAX_PHOTO_BYTES) return { error: tooBig(purpose, filename) };
    if (!isPhotoType(mime)) return { error: wrongType(purpose, filename) };
    if (typeof ticketId !== "string" || !isUuid(ticketId)) return { error: UPLOAD_COPY.cantAddPhotos };
  } else {
    return { error: UPLOAD_COPY.couldNotStart };
  }

  const supabase = await createClient();
  let path: string;

  if (purpose === "unit_document") {
    // The unit is checked in the database: an owner of it, or the board.
    const target = await createUnitDocumentTarget(supabase, { unitId, filename });
    if ("error" in target) return target;
    path = target.path;
  } else if (purpose === "document") {
    const associationId = await currentAssociationId(supabase);
    if (!associationId) return { error: UPLOAD_COPY.noAssociation };
    const { data: board } = await supabase.rpc("is_board", { assoc: associationId });
    if (board !== true) {
      // The accountant may add documents in five categories (0081). Anyone else is refused.
      const { data: accountant } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["accountant"] });
      if (accountant !== true) return { error: UPLOAD_COPY.notBoard };
      if (!isAccountantUploadCategory(categorySlug)) return { error: ACCOUNTANT_UPLOAD_COPY.notThatCategory };
    }
    path = buildStoragePath({
      purpose,
      associationId,
      now: Date.now(),
      suffix: randomSuffix(),
      filename,
    });
  } else {
    const tid = ticketId as string;
    const { data: associationId } = await supabase.rpc("ticket_association_id", { p_ticket_id: tid });
    if (!associationId) return { error: UPLOAD_COPY.cantAddPhotos };

    const { data: permission } = await supabase.rpc("ticket_photo_permission", { p_ticket_id: tid });
    if (permission === "closed") return { error: UPLOAD_COPY.problemClosed };
    if (permission !== "ok") return { error: UPLOAD_COPY.cantAddPhotos };

    // The board sees the true count; an owner may see fewer. The RPC enforces
    // the real limit at registration either way.
    const { data: photos } = await supabase.rpc("ticket_photos", { p_ticket_id: tid });
    if (Array.isArray(photos) && photos.length >= MAX_PHOTOS_PER_TICKET) {
      return { error: UPLOAD_COPY.photoLimit };
    }

    path = buildStoragePath({
      purpose,
      associationId: String(associationId),
      ticketId: tid,
      now: Date.now(),
      suffix: randomSuffix(),
      filename,
    });
  }

  const { data, error } = await supabase.storage.from("documents").createSignedUploadUrl(path);
  if (error || !data) {
    console.error("createUploadTarget", error?.message, path);
    // A refusal on a photo path, after the checks above passed, is almost
    // always the 30-a-day unregistered cap in the storage policy.
    if (purpose === "ticket_photo" && /row-level security|unauthorized|403/i.test(error?.message ?? "")) {
      return { error: UPLOAD_COPY.unregisteredCap };
    }
    return { error: UPLOAD_COPY.couldNotStart };
  }

  return { ok: true, path: data.path, token: data.token };
}

export async function registerUpload(input: {
  path: string;
  filename: string;
  categorySlug?: string;
  purpose: Purpose;
  ticketId?: string;
  /** unit_document only: the unit the file is for, and the kind of document (src/lib/owner/unit-documents.ts). */
  unitId?: string;
  unitKind?: string;
  title?: string;
  /** Document only: attach the new (or matching) document to this record. */
  link?: { targetTable: LinkableTable; targetId: string; relation?: string };
  /** Document only, default true. False skips the general reader (Insurance reads it itself). */
  read?: boolean;
}): Promise<
  | { ok: true; documentId: string; duplicateOf?: string; linkFailed?: boolean }
  | {
      ok: true;
      documentId: null;
      alreadyStored: true;
      onThisProblem: boolean;
      /** Identical bytes the caller can see, filed for fewer people than this problem reaches. */
      narrowerAudience?: boolean;
    }
  | { error: string }
> {
  const { path, filename, categorySlug, purpose, ticketId, unitId, unitKind, title, link, read } =
    input ?? ({} as typeof input);
  if (!validFilename(filename) || typeof path !== "string") return { error: UPLOAD_COPY.pathMismatch };

  // Documents an owner or the board adds for one unit have their own path, checks and RPC (0079).
  if (purpose === "unit_document") {
    if (link || categorySlug || ticketId) return { error: UPLOAD_COPY.pathMismatch };
    return registerUnitDocument(await createClient(), { path, filename, unitId, unitKind, title });
  }

  // 1. The path must be one we would have issued for this purpose.
  const parsed = parseStoragePath(path);
  if (!parsed || parsed.kind !== purpose) return { error: UPLOAD_COPY.pathMismatch };
  if (purpose === "ticket_photo") {
    if (parsed.kind !== "ticket_photo" || parsed.ticketId !== ticketId) {
      return { error: UPLOAD_COPY.pathMismatch };
    }
    if (link || categorySlug) return { error: UPLOAD_COPY.pathMismatch };
  }
  if (link && (!isLinkableTable(link.targetTable) || typeof link.targetId !== "string" || !link.targetId)) {
    return { error: UPLOAD_COPY.pathMismatch };
  }

  const supabase = await createClient();
  const expectedAssociation =
    purpose === "document"
      ? await currentAssociationId(supabase)
      : ((await supabase.rpc("ticket_association_id", { p_ticket_id: ticketId as string })).data as
          | string
          | null);
  if (!expectedAssociation || expectedAssociation !== parsed.associationId) {
    return { error: UPLOAD_COPY.pathMismatch };
  }
  const associationId = parsed.associationId;

  // Anyone who is not on the board is the accountant (0081): their own path, with its own function. The
  // database refuses anyone else.
  if (purpose === "document") {
    const { data: board } = await supabase.rpc("is_board", { assoc: associationId });
    if (board !== true) {
      if (link) return { error: UPLOAD_COPY.pathMismatch };
      return registerAccountantDocument(supabase, { path, associationId, filename, categorySlug, title });
    }
  }

  const discard = () =>
    purpose === "document" ? removeIfUnregistered(supabase, associationId, path) : Promise.resolve();

  // 2. Idempotency: a retried register after a dropped response. Never
  // deletes anything.
  const { data: registered } = await supabase
    .from("documents")
    .select("id")
    .eq("association_id", associationId)
    .eq("storage_path", path)
    .limit(1);
  if (registered?.[0]) return { ok: true, documentId: registered[0].id as string };

  // 3. The stored bytes, read back with the caller's session.
  const { data: blob, error: downloadError } = await supabase.storage.from("documents").download(path);
  if (downloadError || !blob) return { error: notFinished(filename) };

  // 4. Size.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const cap = purpose === "document" ? MAX_DOCUMENT_BYTES : MAX_PHOTO_BYTES;
  if (bytes.length === 0) {
    await discard();
    return { error: notFinished(filename) };
  }
  if (bytes.length > cap) {
    await discard();
    return { error: tooBig(purpose, filename) };
  }

  // 5. Type. The client declared the sniffed type, so a stored type that
  // disagrees with these bytes means something went around the browser check.
  const stored = mimeEssence(blob.type);
  const verdict = verifyFile(stored, bytes);
  if (!verdict.ok || verdict.mime !== stored) {
    await discard();
    return { error: contentsMismatch(filename) };
  }
  if (purpose === "ticket_photo" && !isPhotoType(verdict.mime)) {
    return { error: wrongType(purpose, filename) };
  }

  // 6.
  const digest = await checksum(bytes);

  if (purpose === "ticket_photo") {
    return registerPhoto(supabase, {
      ticketId: ticketId as string,
      path,
      filename,
      title,
      mime: verdict.mime,
      size: bytes.length,
      digest,
    });
  }

  // 7. Documents.
  const linkTo = async (documentId: string): Promise<boolean> => {
    if (!link) return true;
    const { error } = await supabase.from("document_links").insert({
      association_id: associationId,
      document_id: documentId,
      target_table: link.targetTable,
      target_id: link.targetId,
      relation: link.relation ?? "source",
    });
    revalidateLinked(link.targetTable, link.targetId);
    // Already attached is what was asked for. A 42501 from the
    // same-association guard (0051), or anything else, still leaves the
    // document stored; the row says to attach it from the hub.
    if (error && error.code !== "23505") {
      console.error("registerUpload", error.code, path);
      return false;
    }
    return true;
  };

  const findDuplicate = async () => {
    const { data } = await supabase
      .from("documents")
      .select("id, storage_path")
      .eq("association_id", associationId)
      .eq("checksum", digest)
      .is("deleted_at", null)
      .limit(1);
    return (data?.[0] as { id: string; storage_path: string } | undefined) ?? null;
  };

  const asDuplicate = async (existing: { id: string; storage_path: string }) => {
    if (existing.storage_path !== path) await discard();
    const linked = await linkTo(existing.id);
    revalidateDocuments();
    return {
      ok: true as const,
      documentId: existing.id,
      duplicateOf: existing.id,
      ...(linked ? {} : { linkFailed: true }),
    };
  };

  const existing = await findDuplicate();
  if (existing) return asDuplicate(existing);

  type Category = { id: string; default_visibility: string };
  let category: Category | null = null;
  if (categorySlug) {
    const { data } = await supabase
      .from("document_categories")
      .select("id, default_visibility")
      .eq("association_id", associationId)
      .eq("slug", categorySlug)
      .limit(1);
    category = (data?.[0] as Category | undefined) ?? null;
    if (!category) {
      await discard();
      return { error: UPLOAD_COPY.unknownCategory };
    }
  }

  const { data: doc, error: insertError } = await supabase
    .from("documents")
    .insert({
      association_id: associationId,
      storage_path: path,
      filename,
      title: title?.trim() || null,
      mime_type: verdict.mime,
      byte_size: bytes.length,
      checksum: digest,
      category_id: category?.id ?? null,
      visibility: category?.default_visibility ?? "board_only",
      // An explicit category is a person's decision, so the classifier
      // leaves it alone (Insurance F-3).
      tag_source: category ? "manual" : null,
      source: "upload",
      extraction_state: read === false ? "skipped" : "pending",
      extraction_error: read === false ? "Read separately." : null,
    })
    .select("id")
    .single();

  if (insertError || !doc) {
    if (insertError?.code === "23505") {
      // Identical bytes registered by someone else in the same instant.
      const raced = await findDuplicate();
      if (raced) return asDuplicate(raced);
    }
    console.error("registerUpload", insertError?.code, path);
    await discard();
    return { error: couldNotSave(filename) };
  }

  const documentId = doc.id as string;

  // The bytes were checked before the row existed, and until it did the uploader could still swap the object at
  // this path. Read it once more now that the row is there: if it is no longer what was checked, retire the row
  // (REVIEW-2 #19).
  const again = await supabase.storage.from("documents").download(path);
  const unchanged =
    !again.error && again.data !== null && (await checksum(new Uint8Array(await again.data.arrayBuffer()))) === digest;
  if (!unchanged) {
    await supabase
      .from("documents")
      .update({ deleted_at: new Date().toISOString(), extraction_state: "skipped", extraction_error: "The file changed while it was being saved." })
      .eq("id", documentId);
    return { error: contentsMismatch(filename) };
  }

  const linked = await linkTo(documentId);

  if (read !== false) {
    after(async () => {
      const bg = await createClient();
      try {
        await runExtraction(bg, documentId);
      } catch {
        // runExtraction records its own failures on the row.
      }
      revalidatePath("/documents");
    });
  }

  // 9.
  revalidateDocuments();
  return { ok: true, documentId, ...(linked ? {} : { linkFailed: true }) };
}

function revalidateDocuments() {
  revalidatePath("/documents");
  revalidatePath("/");
}

function revalidateTicket(ticketId: string) {
  revalidatePath(`/maintenance/${ticketId}`);
  revalidatePath("/repairs");
}

/** 8. Ticket photos: attach_ticket_photo checks the stored object itself, never our word. */
async function registerPhoto(
  supabase: Supabase,
  p: {
    ticketId: string;
    path: string;
    filename: string;
    title?: string;
    mime: string;
    size: number;
    digest: string;
  },
): Promise<
  | { ok: true; documentId: string; duplicateOf?: string }
  | { ok: true; documentId: null; alreadyStored: true; onThisProblem: boolean; narrowerAudience?: boolean }
  | { error: string }
> {
  // What was already on the problem, to tell "already here" from a fresh
  // same-audience link (the RPC returns the same id for both).
  const { data: before } = await supabase.rpc("ticket_photos", { p_ticket_id: p.ticketId });
  const alreadyHere = new Set(((before ?? []) as PhotoRow[]).map((r) => r.document_id));

  const { data, error } = await supabase.rpc("attach_ticket_photo", {
    p_ticket_id: p.ticketId,
    p_storage_path: p.path,
    p_filename: p.filename,
    p_mime_type: p.mime,
    p_byte_size: p.size,
    p_checksum: p.digest,
    p_title: p.title?.trim() || null,
  });

  // Never discard a photo object: the uploader has no delete permission on
  // photo paths. A rejected one stays an orphan readable only by them for a day.
  if (error) {
    const hint = (error as { hint?: string }).hint;
    if (hint === "ticket_closed") return { error: UPLOAD_COPY.problemClosed };
    if (error.code === "42501") return { error: UPLOAD_COPY.cantAddPhotos };
    if (hint === "photo_limit") return { error: UPLOAD_COPY.photoLimit };
    if (hint === "not_uploaded") return { error: notFinished(p.filename) };
    if (error.code === "22023") return { error: wrongType("ticket_photo", p.filename) };
    console.error("registerUpload", error.code, p.path);
    return { error: couldNotSave(p.filename) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        document_id: string | null;
        duplicate: boolean;
        storage_path: string | null;
        linked: boolean;
        narrower_audience?: boolean | null;
      }
    | undefined;
  if (!row) {
    console.error("registerUpload", "no_row", p.path);
    return { error: couldNotSave(p.filename) };
  }

  revalidateTicket(p.ticketId);

  if (row.linked && !row.duplicate && row.document_id) {
    return { ok: true, documentId: row.document_id };
  }
  if (row.linked && row.duplicate && row.document_id) {
    // Already on this problem before the call: the row says so. A fresh
    // same-audience link reads as "Added".
    return alreadyHere.has(row.document_id)
      ? { ok: true, documentId: row.document_id, duplicateOf: row.document_id }
      : { ok: true, documentId: row.document_id };
  }
  if (row.linked) {
    return { ok: true, documentId: null, alreadyStored: true, onThisProblem: true };
  }
  return {
    ok: true,
    documentId: null,
    alreadyStored: true,
    onThisProblem: false,
    ...(row.narrower_audience ? { narrowerAudience: true } : {}),
  };
}

export async function removeTicketPhoto(input: {
  ticketId: string;
  documentId: string;
}): Promise<{ ok: true } | { error: string }> {
  const { ticketId, documentId } = input ?? ({} as typeof input);
  if (typeof ticketId !== "string" || !isUuid(ticketId) || typeof documentId !== "string" || !isUuid(documentId)) {
    return { error: UPLOAD_COPY.removeRefused };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_ticket_photo", {
    p_ticket_id: ticketId,
    p_document_id: documentId,
  });
  if (error) {
    if (error.code === "42501") return { error: UPLOAD_COPY.removeRefused };
    console.error("removeTicketPhoto", error.code);
    return { error: UPLOAD_COPY.removeFailed };
  }
  revalidateTicket(ticketId);
  return { ok: true };
}
