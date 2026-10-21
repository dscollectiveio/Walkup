"use client";

/**
 * The per-file direct-upload pipeline (foundation-spec 6.5), without any UI.
 * DirectUpload runs it for each row; Repairs' report form runs it after the
 * ticket exists, for the photos it held in state.
 *
 *   preparing  caller's `prepare`, then image normalising (resize, JPEG, no EXIF)
 *   checking   size cap and the same byte sniff the server runs
 *   uploading  createUploadTarget -> uploadToSignedUrl, straight to Storage
 *   saving     registerUpload re-checks the stored bytes and writes the row
 */

import { createClient } from "@/lib/supabase/client";
import { verifyBlobHead } from "@/lib/documents/sniff";
import { normaliseImage } from "@/lib/documents/image-normalise";
import {
  DOCUMENT_IMAGE_MAX_EDGE,
  DOCUMENT_JPEG_QUALITY,
  MAX_DOCUMENT_BYTES,
  MAX_PHOTO_BYTES,
  PHOTO_JPEG_QUALITY,
  PHOTO_MAX_EDGE,
  isPhotoType,
} from "@/lib/documents/upload-paths";
import { createUploadTarget, registerUpload } from "@/app/documents/upload/actions";
import type { LinkableTable } from "@/app/documents/upload/link-targets";
import {
  UPLOAD_COPY,
  couldNotSave,
  networkError,
  photoNeedsJpeg,
  tooBig,
  wrongType,
  type UploadPurpose,
} from "./upload-copy";

export type UploadStage = "preparing" | "checking" | "uploading" | "saving";

export type UploadOutcome =
  | { state: "added"; documentId: string; filename: string; linkFailed?: boolean }
  | {
      state: "duplicate";
      documentId: string | null;
      filename: string;
      onThisProblem?: boolean;
      alreadyStored?: boolean;
      narrowerAudience?: boolean;
    }
  | { state: "failed"; filename: string; error: string };

export interface UploadFileOptions {
  purpose: UploadPurpose;
  categorySlug?: string;
  ticketId?: string;
  /** unit_document: the unit the file is for, and which kind of document it is (src/lib/owner/unit-documents.ts). */
  unitId?: string;
  unitKind?: string;
  link?: { targetTable: LinkableTable; targetId: string; relation?: string };
  read?: boolean;
  /** Default true for ticket photos, false for documents. */
  normaliseImages?: boolean;
  /** Per-file hook run first (foundation-spec 17, Repairs (c) / Insurance F-4). */
  prepare?: (file: File) => Promise<File | { error: string }>;
}

const PHOTO_NORMALISE = new Set(["image/jpeg", "image/heic", "image/heif", "image/png"]);
const DOCUMENT_NORMALISE = new Set(["image/jpeg", "image/heic", "image/heif"]);

function isHeicFile(file: File, sniffed: string | null): boolean {
  const t = file.type.toLowerCase();
  return t === "image/heic" || t === "image/heif" || sniffed === "image/heic" || /\.(heic|heif)$/i.test(file.name);
}

/**
 * Step 2: the file that will actually be uploaded. For documents the worst case is the original. A ticket photo is
 * shown to other people and carries GPS and device data in its EXIF block, which only a re-encode removes; where the
 * browser cannot re-encode it, the photo is refused rather than uploaded as it is (REVIEW-2 #18).
 */
async function prepared(file: File, opts: UploadFileOptions): Promise<File | { error: string }> {
  const purpose = opts.purpose;
  const normalise = opts.normaliseImages ?? purpose === "ticket_photo";
  const head = await verifyBlobHead(file).catch(() => null);
  const sniffed = head?.ok ? head.mime : null;
  const type = (sniffed ?? file.type).toLowerCase();

  const settings =
    purpose === "ticket_photo"
      ? { maxEdge: PHOTO_MAX_EDGE, quality: PHOTO_JPEG_QUALITY }
      : { maxEdge: DOCUMENT_IMAGE_MAX_EDGE, quality: DOCUMENT_JPEG_QUALITY, keepSmaller: true };

  if (normalise) {
    const kinds = purpose === "ticket_photo" ? PHOTO_NORMALISE : DOCUMENT_NORMALISE;
    if (!kinds.has(type) && !isHeicFile(file, sniffed)) return file;
    const normalised = await normaliseImage(file, settings);
    if (normalised) return normalised;
    return purpose === "ticket_photo" ? { error: photoNeedsJpeg(file.name) } : file;
  }

  // Every caller: a HEIC the browser can decode becomes a JPEG (foundation-spec
  // 17), because almost nothing else can show or read HEIC. Where the browser
  // can't decode it, it is stored as HEIC.
  if (isHeicFile(file, sniffed)) return (await normaliseImage(file, settings)) ?? file;
  return file;
}

type UploadErrorLike = { message?: string; statusCode?: string | number; status?: number };

function uploadErrorKind(error: unknown): "size" | "exists" | "network" | "other" {
  if (error instanceof TypeError) return "network";
  const e = (error ?? {}) as UploadErrorLike;
  const message = String(e.message ?? "");
  const status = String(e.statusCode ?? e.status ?? "");
  if (status === "413" || /exceeded the maximum allowed size/i.test(message)) return "size";
  if (/already exists/i.test(message) || status === "409") return "exists";
  if (/failed to fetch|network|load failed/i.test(message)) return "network";
  return "other";
}

/** The per-file pipeline. Used by DirectUpload and by Repairs' report-time helper. */
export async function uploadFile(
  file: File,
  opts: UploadFileOptions,
  /** `bytes` is the size actually being sent (after any conversion), given with "uploading". */
  onStage: (stage: UploadStage, bytes?: number) => void,
): Promise<UploadOutcome> {
  const purpose = opts.purpose;
  const original = file.name;
  const failed = (error: string): UploadOutcome => ({ state: "failed", filename: original, error });

  // 2. preparing
  onStage("preparing");
  let working = file;
  if (opts.prepare) {
    try {
      const result = await opts.prepare(working);
      if (!(result instanceof File)) return failed(result.error);
      working = result;
    } catch {
      return failed(couldNotSave(original));
    }
  }
  const ready = await prepared(working, opts);
  if (!(ready instanceof File)) return failed(ready.error);
  working = ready;

  // 3. checking
  onStage("checking");
  const cap = purpose === "ticket_photo" ? MAX_PHOTO_BYTES : MAX_DOCUMENT_BYTES;
  if (working.size > cap) return failed(tooBig(purpose, original));
  if (working.size === 0) return failed(wrongType(purpose, original));
  const verdict = await verifyBlobHead(working);
  if (!verdict.ok) return failed(wrongType(purpose, original, verdict.reason));
  if (purpose === "ticket_photo" && !isPhotoType(verdict.mime)) return failed(wrongType(purpose, original));

  // The name the board sees is the file they picked (a converted photo keeps
  // its base name with .jpg).
  const filename = working.name || original;

  // 4 and 5, with one retry from 4 when the path was somehow taken.
  let path: string | null = null;
  for (let attempt = 0; attempt < 2 && !path; attempt++) {
    let target: Awaited<ReturnType<typeof createUploadTarget>>;
    try {
      target = await createUploadTarget({
        filename,
        size: working.size,
        mime: verdict.mime,
        purpose,
        ticketId: opts.ticketId,
        unitId: opts.unitId,
        categorySlug: opts.categorySlug,
      });
    } catch {
      return failed(networkError(original));
    }
    if ("error" in target) return failed(target.error);

    onStage("uploading", working.size);
    let uploadError: unknown = null;
    try {
      const { error } = await createClient()
        .storage.from("documents")
        // The Blob wrapper is required: for a Blob, storage-js stores the
        // Blob's own type and ignores contentType (foundation-spec 2.2).
        .uploadToSignedUrl(target.path, target.token, new Blob([working], { type: verdict.mime }));
      uploadError = error;
    } catch (e) {
      uploadError = e;
    }

    if (!uploadError) {
      path = target.path;
      break;
    }
    const kind = uploadErrorKind(uploadError);
    if (kind === "exists" && attempt === 0) continue;
    if (kind === "size") return failed(tooBig(purpose, original));
    if (kind === "network") return failed(networkError(original));
    return failed(UPLOAD_COPY.couldNotStart);
  }
  if (!path) return failed(UPLOAD_COPY.couldNotStart);

  // 6. saving
  onStage("saving");
  let registered: Awaited<ReturnType<typeof registerUpload>>;
  try {
    registered = await registerUpload({
      path,
      filename,
      categorySlug: opts.categorySlug,
      purpose,
      ticketId: opts.ticketId,
      unitId: opts.unitId,
      unitKind: opts.unitKind,
      link: opts.link,
      read: opts.read,
    });
  } catch {
    return failed(networkError(original));
  }

  if ("error" in registered) return failed(registered.error);
  if (registered.documentId === null) {
    return {
      state: "duplicate",
      documentId: null,
      filename,
      alreadyStored: true,
      onThisProblem: registered.onThisProblem,
      narrowerAudience: registered.narrowerAudience,
    };
  }
  if ("duplicateOf" in registered && registered.duplicateOf) {
    return {
      state: "duplicate",
      documentId: registered.documentId,
      filename,
      onThisProblem: purpose === "ticket_photo" ? true : undefined,
    };
  }
  return {
    state: "added",
    documentId: registered.documentId,
    filename,
    ...("linkFailed" in registered && registered.linkFailed ? { linkFailed: true } : {}),
  };
}
