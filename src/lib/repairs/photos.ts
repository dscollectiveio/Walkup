// Ticket photos in the browser (repairs-spec §5.2, §6), on the foundation's
// upload kit. preparePhoto refuses what isn't a photo and shrinks what is;
// uploadTicketPhotos sends each prepared file through uploadFile(), which
// asks the server for a signed upload URL, sends the bytes straight to
// Storage and registers them with attach_ticket_photo. A photo that fails
// never undoes the ticket.
//
// Client-safe: no server-only imports. Not a "use client" module itself, so
// the pure parts are testable.

import { verifyBlobHead } from "@/lib/documents/sniff";
import { normaliseImage } from "@/lib/documents/image-normalise";
import { MAX_PHOTO_BYTES, PHOTO_TYPES, isPhotoType } from "@/lib/documents/upload-paths";
import { uploadFile } from "@/components/upload/upload-file";
import { tooBig, wrongType } from "@/components/upload/upload-copy";

/** Longest edge after preparation (§5.2). */
export const PREPARED_MAX_EDGE = 2560;
export const PREPARED_JPEG_QUALITY = 0.85;
/** Re-encode anything bigger than this even when its edges are already small. */
export const REENCODE_OVER_BYTES = 2.5 * 1024 * 1024;

export type PreparedPhoto = { file: File; mime: (typeof PHOTO_TYPES)[number] };

function isHeic(file: File, sniffed: string | null): boolean {
  const t = file.type.toLowerCase();
  return sniffed === "image/heic" || t === "image/heic" || t === "image/heif" || /\.(heic|heif)$/i.test(file.name);
}

async function longestEdge(file: File): Promise<number | null> {
  if (typeof createImageBitmap === "undefined") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    bitmap.close();
    return edge;
  } catch {
    return null;
  }
}

/**
 * Make a phone photo upload-friendly before it leaves the device.
 *  1. Sniff the bytes; anything that isn't a JPEG, PNG or HEIC (a PDF, say)
 *     is refused with the foundation's photo copy.
 *  2. A HEIC, a file over 2.5 MB, or one whose longest edge is over 2,560 px
 *     is redrawn as a JPEG no longer than 2,560 px (EXIF dropped). A browser
 *     that can't decode it (HEIC outside Safari) keeps the original.
 *  3. Still over 15 MB: refused.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto | { error: string }> {
  const head = await verifyBlobHead(file).catch(() => null);
  if (!head || !head.ok || !isPhotoType(head.mime)) return { error: wrongType("ticket_photo", file.name) };
  let out: File = file;
  let mime: PreparedPhoto["mime"] = head.mime;

  const heic = isHeic(file, head.mime);
  const edge = heic || file.size > REENCODE_OVER_BYTES ? null : await longestEdge(file);
  if (heic || file.size > REENCODE_OVER_BYTES || (edge !== null && edge > PREPARED_MAX_EDGE)) {
    const redrawn = await normaliseImage(file, { maxEdge: PREPARED_MAX_EDGE, quality: PREPARED_JPEG_QUALITY });
    if (redrawn) {
      out = redrawn;
      mime = "image/jpeg";
    }
  }

  if (out.size > MAX_PHOTO_BYTES) return { error: tooBig("ticket_photo", file.name) };
  return { file: out, mime };
}

/**
 * Upload already-prepared photos to a ticket, one after the other. Failures
 * are collected and the rest carry on; the caller shows
 * reportPartialFailure(failed.length) and offers to retry just those.
 */
export async function uploadTicketPhotos(
  ticketId: string,
  files: File[],
  onProgress: (i: number, n: number) => void,
): Promise<{ uploaded: number; failed: { name: string; reason: string }[] }> {
  let uploaded = 0;
  const failed: { name: string; reason: string }[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress(i + 1, files.length);
    try {
      const outcome = await uploadFile(
        files[i],
        // Already prepared by preparePhoto: no second re-encode.
        { purpose: "ticket_photo", ticketId, normaliseImages: false },
        () => {},
      );
      if (outcome.state === "failed") failed.push({ name: files[i].name, reason: outcome.error });
      else uploaded += 1;
    } catch {
      failed.push({ name: files[i].name, reason: `${files[i].name} couldn't be saved. Try again.` });
    }
  }
  return { uploaded, failed };
}
