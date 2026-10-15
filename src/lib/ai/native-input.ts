import type Anthropic from "@anthropic-ai/sdk";

/**
 * Limits on files sent to the model as themselves (brief decision 7):
 * scanned declarations pages, photos, quote PDFs. Checked before a quota
 * claim, so a file the API would refuse never costs one of today's reads.
 * Pure: no server-only, no SDK runtime import.
 *
 * Checked against Anthropic's vision and PDF docs on 2026-10-14
 * (foundation-spec 2.7): JPEG, PNG, GIF and WebP only (no HEIC); 5 MB per
 * image; PDFs up to 32 MB per request after base64, so 20 MB raw is our cap.
 */

/** Image media types the API accepts (2.7). HEIC/HEIF are not among them. */
export const NATIVE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export const NATIVE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;   // per image, decoded
export const NATIVE_PDF_MAX_BYTES = 20 * 1024 * 1024;    // our cap, under the 32 MB request limit after base64
export const NATIVE_MAX_IMAGES = 20;                      // per call; a scanned policy rarely needs more

/** Decoded byte length of a base64 string: floor(len * 3 / 4) minus padding. */
export function base64DecodedBytes(data: string): number {
  const clean = data.replace(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

interface Base64Source {
  type: "base64";
  media_type?: string;
  data?: string;
}

function base64Source(block: unknown): Base64Source | null {
  if (!block || typeof block !== "object") return null;
  const source = (block as { source?: unknown }).source;
  if (!source || typeof source !== "object") return null;
  return (source as { type?: unknown }).type === "base64" ? (source as Base64Source) : null;
}

/**
 * Scans content blocks with base64 sources. Returns "unsupported_file" for an image whose
 * media_type isn't in NATIVE_IMAGE_TYPES, "too_long" for an image over NATIVE_IMAGE_MAX_BYTES,
 * a PDF over NATIVE_PDF_MAX_BYTES, or more than NATIVE_MAX_IMAGES images; otherwise null.
 */
export function nativeInputProblem(
  content: Anthropic.MessageParam["content"],
): "unsupported_file" | "too_long" | null {
  if (typeof content === "string") return null;
  let images = 0;
  let tooLong = false;
  for (const block of content) {
    if (block.type === "image") {
      images += 1;
      const src = base64Source(block);
      if (!src) continue;
      const type = (src.media_type ?? "").toLowerCase();
      if (!(NATIVE_IMAGE_TYPES as readonly string[]).includes(type)) return "unsupported_file";
      if (base64DecodedBytes(src.data ?? "") > NATIVE_IMAGE_MAX_BYTES) tooLong = true;
    } else if (block.type === "document") {
      const src = base64Source(block);
      if (!src) continue;
      if (base64DecodedBytes(src.data ?? "") > NATIVE_PDF_MAX_BYTES) tooLong = true;
    }
  }
  if (tooLong || images > NATIVE_MAX_IMAGES) return "too_long";
  return null;
}
