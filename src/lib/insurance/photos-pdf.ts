// Photos of a declarations page, prepared in the browser before upload
// (insurance-spec §6.5b, §7.1.2a). Browser only: no server-only, no Node APIs.
// reencodeImage() uses Foundation's normaliseImage (createImageBitmap +
// canvas); imagesToPdf() is plain byte assembly, so a 3-page declarations
// photographed on a phone becomes one PDF and one read.

import { normaliseImage } from "@/lib/documents/image-normalise";

export const PHOTO_MAX_EDGE = 2400;
export const PHOTO_QUALITY = 0.85;
/** The longest side of a page, in points (A4 height). */
export const PAGE_LONG_SIDE_PT = 842;

export class ImageDecodeError extends Error {
  constructor(name: string) {
    super(`This browser couldn't open ${name} as an image.`);
    this.name = "ImageDecodeError";
  }
}

/**
 * Decode any image the browser can decode (JPEG, PNG, and HEIC in Safari) and
 * re-encode it as JPEG, longest side at most 2400 px, quality 0.85. Throws
 * ImageDecodeError when the browser can't decode it.
 */
export async function reencodeImage(file: File): Promise<Blob> {
  const out = await normaliseImage(file, { maxEdge: PHOTO_MAX_EDGE, quality: PHOTO_QUALITY, keepSmaller: false });
  if (!out) throw new ImageDecodeError(file.name);
  return out;
}

/** "IMG_0042.jpg" → "IMG_0042 (photos).pdf". */
export function photosPdfName(firstPhotoName: string): string {
  const dot = firstPhotoName.lastIndexOf(".");
  const base = (dot > 0 ? firstPhotoName.slice(0, dot) : firstPhotoName).trim() || "Photos";
  return `${base} (photos).pdf`;
}

export interface JpegInfo { width: number; height: number; components: number }

/** Width, height and colour components from a JPEG's SOF segment, or null when it isn't a JPEG. */
export function jpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    // Markers without a length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any SOF
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && i + 9 < bytes.length) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      return width > 0 && height > 0 ? { width, height, components } : null;
    }
    i += 2 + len;
  }
  return null;
}

const ascii = (s: string) => new TextEncoder().encode(s);

/** A PDF text string for the title: UTF-16BE hex with a byte-order mark, so any characters survive. */
function pdfTextString(s: string): string {
  let hex = "FEFF";
  for (let k = 0; k < s.length; k++) hex += s.charCodeAt(k).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Several photos → one PDF, one photo per page, in the given order. Each page
 * is sized to the image (longest side 842 pt) and embeds the JPEG bytes
 * unchanged as a DCTDecode image XObject.
 */
export async function imagesToPdf(jpegs: Blob[], title: string): Promise<Blob> {
  if (jpegs.length === 0) throw new Error("imagesToPdf needs at least one image");
  const images: { bytes: Uint8Array; info: JpegInfo }[] = [];
  for (const blob of jpegs) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const info = jpegInfo(bytes);
    if (!info) throw new ImageDecodeError("a photo");
    images.push({ bytes, info });
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: Uint8Array | string) => {
    const b = typeof part === "string" ? ascii(part) : part;
    chunks.push(b);
    length += b.length;
  };
  const object = (n: number, ...parts: (Uint8Array | string)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of parts) push(p);
    push("\nendobj\n");
  };

  // Objects: 1 catalog, 2 pages, 3 info, then per image: page, contents, image.
  const n = images.length;
  const pageObj = (k: number) => 4 + k * 3;
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker comment
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${images.map((_, k) => `${pageObj(k)} 0 R`).join(" ")}] /Count ${n} >>`);
  object(3, `<< /Title ${pdfTextString(title)} /Producer (Walkup) >>`);
  images.forEach(({ bytes, info }, k) => {
    const scale = PAGE_LONG_SIDE_PT / Math.max(info.width, info.height);
    const w = Math.round(info.width * scale * 100) / 100;
    const h = Math.round(info.height * scale * 100) / 100;
    const page = pageObj(k);
    const name = `Im${k + 1}`;
    const content = `q ${fmt(w)} 0 0 ${fmt(h)} 0 0 cm /${name} Do Q`;
    const colour = info.components === 1 ? "/DeviceGray" : info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(w)} ${fmt(h)}] /Resources << /XObject << /${name} ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    object(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(
      page + 2,
      `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${colour} /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
      bytes,
      "\nendstream",
    );
  });

  const count = 4 + n * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let k = 1; k < count; k++) push(`${String(offsets[k]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return new Blob([out], { type: "application/pdf" });
}
