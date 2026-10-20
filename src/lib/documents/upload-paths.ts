/**
 * Storage paths and size limits for direct uploads (foundation-spec 6.1).
 *
 * Pure, and imported by both the browser pipeline and the server actions.
 * The path rules are mirrored in SQL by storage_path_kind() (0051), which the
 * storage policies and attach_ticket_photo() use to decide what a path is;
 * tests/fixtures/storage-paths.ts holds the one table of cases both sides
 * are tested against, so the two can't drift apart.
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // bucket cap (0019)
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // attach_ticket_photo cap
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic"] as const;
export const MAX_DOCUMENTS_PER_BATCH = 10;
export const MAX_PHOTOS_PER_BATCH = 6;
export const MAX_PHOTOS_PER_TICKET = 20;
export const MAX_PENDING_PHOTO_UPLOADS = 30; // per person per building per day (SQL)

/** Browser re-encoding targets (6.5.1). */
export const PHOTO_MAX_EDGE = 2000; // ticket photos
export const PHOTO_JPEG_QUALITY = 0.85;
export const DOCUMENT_IMAGE_MAX_EDGE = 2576; // photographed paper documents (model's working resolution)
export const DOCUMENT_JPEG_QUALITY = 0.9;

export type PhotoType = (typeof PHOTO_TYPES)[number];

export function isPhotoType(mime: string): mime is PhotoType {
  return (PHOTO_TYPES as readonly string[]).includes(mime);
}

/** Lowercase only, as Postgres prints them and as the SQL mirror requires. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `<13-digit ms timestamp>-<6 of [a-z0-9]>-<safe name, 1 to 120 chars>`. */
const FILE_PART = /^[0-9]{13}-[a-z0-9]{6}-[A-Za-z0-9_.-]{1,120}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Same rule as the hub always used: [^\w.\-]+ -> "_", keep the last 120 characters; "file" if empty. */
export function safeStorageName(filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  return safe.length > 0 ? safe : "file";
}

/** 6 chars of [a-z0-9] from crypto.randomUUID(). */
export function randomSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

export function buildStoragePath(
  a:
    | { purpose: "document"; associationId: string; now: number; suffix: string; filename: string }
    | {
        purpose: "ticket_photo";
        associationId: string;
        ticketId: string;
        now: number;
        suffix: string;
        filename: string;
      },
): string {
  const file = `${a.now}-${a.suffix}-${safeStorageName(a.filename)}`;
  return a.purpose === "document"
    ? `${a.associationId}/${file}`
    : `${a.associationId}/tickets/${a.ticketId}/${file}`;
}

/** Mirror of SQL storage_path_kind(). Null for anything it doesn't recognise. */
export function parseStoragePath(
  path: string,
):
  | { kind: "document"; associationId: string }
  | { kind: "ticket_photo"; associationId: string; ticketId: string }
  | null {
  const parts = (path ?? "").split("/");
  if (parts.length === 2 && UUID.test(parts[0]) && FILE_PART.test(parts[1])) {
    return { kind: "document", associationId: parts[0] };
  }
  if (
    parts.length === 4 &&
    UUID.test(parts[0]) &&
    parts[1] === "tickets" &&
    UUID.test(parts[2]) &&
    FILE_PART.test(parts[3])
  ) {
    return { kind: "ticket_photo", associationId: parts[0], ticketId: parts[2] };
  }
  return null;
}

/**
 * Documents an owner (or the board) adds for one unit (0079):
 * `<association>/units/<unit>/<same file part>`. Kept out of buildStoragePath()/parseStoragePath() on purpose,
 * because those mirror SQL storage_path_kind() case for case; this pair mirrors SQL unit_document_path().
 */
export function buildUnitDocumentPath(a: {
  associationId: string;
  unitId: string;
  now: number;
  suffix: string;
  filename: string;
}): string {
  return `${a.associationId}/units/${a.unitId}/${a.now}-${a.suffix}-${safeStorageName(a.filename)}`;
}

/** Mirror of SQL unit_document_path(). Null for anything it doesn't recognise. */
export function parseUnitDocumentPath(path: string): { associationId: string; unitId: string } | null {
  const parts = (path ?? "").split("/");
  if (
    parts.length === 4 &&
    UUID.test(parts[0]) &&
    parts[1] === "units" &&
    UUID.test(parts[2]) &&
    FILE_PART.test(parts[3])
  ) {
    return { associationId: parts[0], unitId: parts[2] };
  }
  return null;
}
