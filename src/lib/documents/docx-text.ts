import "server-only";
import { inflateRawSync } from "node:zlib";
import { redactTaxIds } from "./redact";

/**
 * The text of a Word (.docx) file, page by page, for the insurance reader.
 *
 * A .docx is a zip; the text is in word/document.xml. This reads just that one
 * entry with Node's zlib, so there is no zip library to trust. Limits keep a
 * crafted file from exhausting memory: the archive must be small, and the one
 * entry is inflated under a hard output cap. Pages split where Word recorded a
 * page break; a file with none comes back as one page. Redacted like every
 * other text read (see redact.ts). Null when it isn't a readable .docx or has
 * no text. The old binary .doc format is not supported.
 */

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_XML_BYTES = 12 * 1024 * 1024;
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function entryData(bytes: Uint8Array, wanted: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.byteLength || view.getUint32(p, true) !== CENTRAL) return null;
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localAt = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      if (localAt + 30 > bytes.byteLength || view.getUint32(localAt, true) !== LOCAL) return null;
      const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
      if (start + compressed > bytes.byteLength) return null;
      const raw = bytes.subarray(start, start + compressed);
      if (method === 0) return raw.byteLength <= MAX_XML_BYTES ? raw : null;
      if (method !== 8) return null;
      return inflateRawSync(raw, { maxOutputLength: MAX_XML_BYTES });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** document.xml text, with a form feed where a page break was recorded. */
export function docxXmlToPages(xml: string): string[] {
  const flat = xml
    .replace(/<w:br[^>]*w:type="page"[^>]*\/>|<w:lastRenderedPageBreak\s*\/>|<w:pageBreakBefore\s*\/>/g, "\f")
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>|<\/w:p>|<\/w:tr>/g, "\n")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<(?!\/?w:t[ >])[^>]*>/g, "")
    .replace(/<w:t[^>]*>/g, "")
    .replace(/<\/w:t>/g, "");
  return decode(flat)
    .split("\f")
    .map((page) => page.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim())
    .filter((page, i, all) => page.length > 0 || i < all.length - 1)
    .map((page) => redactTaxIds(page).text);
}

export async function extractDocxPages(bytes: Uint8Array): Promise<string[] | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) return null;
  try {
    const xml = entryData(bytes, "word/document.xml");
    if (!xml) return null;
    const pages = docxXmlToPages(new TextDecoder("utf-8").decode(xml));
    return pages.some((p) => p.length > 0) ? pages : null;
  } catch {
    return null;
  }
}
