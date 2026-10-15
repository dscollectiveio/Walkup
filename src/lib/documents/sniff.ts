/**
 * What a file actually is, decided from its bytes.
 *
 * The upload path used to pass `file.type` straight to Storage. That value
 * comes from the browser, and the bucket's MIME allowlist then checks the
 * claim rather than the file — so naming a payload "application/pdf" was
 * enough to get it stored. Sniffing the leading bytes and uploading under the
 * sniffed type closes that: the allowlist starts describing the content.
 *
 * Deliberately small. This is a gate, not a general-purpose detector — it only
 * needs to recognise the eight types the bucket accepts and refuse everything
 * else, and a short list of signatures is easier to audit than a dependency.
 *
 * Pure, and safe on both sides: direct uploads (foundation-spec 6) run the
 * same check in the browser before uploading and on the server against the
 * stored bytes. Only the server's verdict counts; the browser's saves a
 * round trip for the obvious cases.
 */

/** Mirrors allowed_mime_types on the `documents` bucket (0019). */
export const ACCEPTED_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
] as const;

export type AcceptedType = (typeof ACCEPTED_TYPES)[number];

const OFFICE_ZIP = new Set<string>([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) =>
  sig.every((b, i) => bytes[offset + i] === b);

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.slice(start, end));

/**
 * The type the bytes claim to be, or null if unrecognised.
 *
 * DOCX and XLSX are both ZIP containers and indistinguishable without
 * unpacking, so both report as "zip" and the caller reconciles that against
 * what the browser said. Plain text has no signature at all, so it is inferred
 * last: printable bytes with no NUL.
 */
export function sniff(bytes: Uint8Array): AcceptedType | "zip" | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf"; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";

  // HEIC: an ISO-BMFF box whose brand sits just after "ftyp".
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }

  // PK\x03\x04 — a ZIP, which for our purposes means DOCX or XLSX.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "zip";

  // No signature. Text only if the sample is free of NUL bytes; a NUL is the
  // cheapest reliable tell that something is binary pretending otherwise.
  const sample = bytes.slice(0, 1024);
  if (sample.length > 0 && !sample.includes(0x00)) return "text/plain";

  return null;
}

export type FileVerdict =
  | { ok: true; mime: AcceptedType }
  | { ok: false; reason: string };

/**
 * Reconcile what the browser said with what the bytes show.
 *
 * The sniffed type wins wherever the two disagree, except for the pairs that
 * genuinely cannot be told apart from a signature — Office files, and CSV
 * versus plain text — where the declared type is accepted as a refinement of
 * an already-safe answer.
 */
export function verifyFile(declaredType: string, bytes: Uint8Array): FileVerdict {
  const sniffed = sniff(bytes);

  if (sniffed === null) {
    return {
      ok: false,
      reason: "isn't a file type Walkup can store. PDFs, photos, Word, Excel, and text files work.",
    };
  }

  if (sniffed === "zip") {
    if (OFFICE_ZIP.has(declaredType)) return { ok: true, mime: declaredType as AcceptedType };
    return {
      ok: false,
      reason: "looks like a zip archive. Upload the documents inside it individually.",
    };
  }

  // CSV is plain text with a convention, so honour the browser's finer answer.
  if (sniffed === "text/plain" && declaredType === "text/csv") {
    return { ok: true, mime: "text/csv" };
  }

  if (declaredType && declaredType !== sniffed && !OFFICE_ZIP.has(declaredType)) {
    // Not necessarily an attack — browsers guess from the extension and get it
    // wrong — but the bytes are the thing being stored, so they decide.
    return { ok: true, mime: sniffed };
  }

  return { ok: true, mime: sniffed };
}

/** "Text/CSV; charset=utf-8" -> "text/csv". The type without parameters, trimmed, lowercase. */
export function mimeEssence(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

/** How many leading bytes verifyFile needs: the text check samples 1,024. */
const HEAD_BYTES = 1024;

/**
 * Reads the first 1,024 bytes of a File/Blob and returns verifyFile(file.type, head).
 * Browser and server safe. `verifyFile` only looks at the first bytes, so the
 * browser and the server reach the same verdict for the same file.
 */
export async function verifyBlobHead(file: Blob): Promise<FileVerdict> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  return verifyFile(mimeEssence(file.type), head);
}
