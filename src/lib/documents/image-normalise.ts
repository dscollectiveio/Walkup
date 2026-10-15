/**
 * Browser only. Phone photos are made upload-friendly before they leave the
 * device (foundation-spec 6.5.1): smaller, upright, JPEG, and without the
 * EXIF block that carries the location and the device. Nothing here runs on
 * the server; calling it there returns null (no createImageBitmap).
 */

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

async function toJpeg(canvas: Canvas, quality: number): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality });
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}

/** "IMG_0042.HEIC" -> "IMG_0042.jpg". */
export function jpegName(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base || "photo"}.jpg`;
}

/**
 * Decode, downscale and re-encode an image as JPEG. Strips EXIF (location, device) because
 * only pixels are re-encoded, applies the EXIF orientation first, and turns HEIC into JPEG
 * where the browser can decode HEIC (Safari on iOS and macOS can; Chrome and Android
 * generally can't). Returns null when the browser can't decode the file.
 *
 * For documents (keepSmaller: true) the original is returned instead when it is already a
 * JPEG no larger than maxEdge and smaller than the re-encoded result.
 */
export async function normaliseImage(
  file: File,
  opts: { maxEdge: number; quality: number; keepSmaller?: boolean },
): Promise<File | null> {
  if (typeof createImageBitmap === "undefined") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // HEIC outside Safari, a truncated file, or not an image at all.
    return null;
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    if (!longest) return null;
    const scale = Math.min(1, opts.maxEdge / longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = makeCanvas(width, height);
    const ctx = canvas?.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null
      | undefined;
    if (!canvas || !ctx) return null;

    // JPEG has no transparency; a PNG's clear pixels would otherwise turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await toJpeg(canvas, opts.quality);
    if (!blob) return null;

    if (
      opts.keepSmaller &&
      file.type === "image/jpeg" &&
      longest <= opts.maxEdge &&
      file.size <= blob.size
    ) {
      return file;
    }

    return new File([blob], jpegName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
