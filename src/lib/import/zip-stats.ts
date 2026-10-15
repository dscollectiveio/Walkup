/**
 * What an .xlsx zip says about itself, read before anything unpacks it
 * (import-spec 4.2, 13.4). Pure: reads the end-of-central-directory record and
 * the central directory entries, never inflates a byte.
 */

export interface ZipStats {
  ok: true;
  entries: number;
  uncompressedBytes: number;
}

export type ZipStatsResult = ZipStats | { ok: false; reason: "not_zip" | "truncated" };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const ZIP64_MARKER = 0xffffffff;

export function zipStats(bytes: Uint8Array): ZipStatsResult {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, reason: "not_zip" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end record sits in the last 22 + 65,535 bytes (a comment may follow it).
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, reason: "truncated" };

  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === ZIP64_MARKER || cdOffset === ZIP64_MARKER) {
    // A zip64 archive is far outside anything a spreadsheet needs.
    return { ok: true, entries: Number.MAX_SAFE_INTEGER, uncompressedBytes: Number.MAX_SAFE_INTEGER };
  }
  if (cdOffset + cdSize > bytes.length) return { ok: false, reason: "truncated" };

  let pos = cdOffset;
  let entries = 0;
  let uncompressed = 0;
  while (pos + 46 <= cdOffset + cdSize && entries < 100_000) {
    if (view.getUint32(pos, true) !== CEN_SIG) return { ok: false, reason: "truncated" };
    const size = view.getUint32(pos + 24, true);
    if (size === ZIP64_MARKER) {
      uncompressed = Number.MAX_SAFE_INTEGER;
    } else {
      uncompressed += size;
    }
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    pos += 46 + nameLen + extraLen + commentLen;
    entries += 1;
  }
  // The directory's own count is what the archive claims; use the larger of the two.
  return { ok: true, entries: Math.max(entries, total), uncompressedBytes: uncompressed };
}

export const MAX_ZIP_ENTRIES = 300;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;

export function zipLooksSafe(stats: ZipStats): boolean {
  return stats.entries <= MAX_ZIP_ENTRIES && stats.uncompressedBytes <= MAX_ZIP_UNCOMPRESSED_BYTES;
}
