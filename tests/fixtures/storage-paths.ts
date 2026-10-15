/**
 * Storage object names and how they classify. One table, read by both sides
 * of the mirror: the DB test runs each `name` through SQL
 * storage_path_kind() (0051), the unit test through parseStoragePath()
 * (src/lib/documents/upload-paths.ts). `expected: null` means "not a path
 * either side recognises" (no row from SQL, null from TypeScript).
 */
export type StoragePathCase = {
  name: string;
  expected:
    | { kind: "document"; associationId: string }
    | { kind: "ticket_photo"; associationId: string; ticketId: string }
    | null;
};

const DAMEN = "11111111-1111-1111-1111-111111111111";
const TICKET = "7c000000-0000-0000-0000-000000000001";

export const STORAGE_PATH_CASES: StoragePathCase[] = [
  // Well-formed.
  {
    name: `${DAMEN}/1700000000000-abc123-declarations.pdf`,
    expected: { kind: "document", associationId: DAMEN },
  },
  {
    name: `${DAMEN}/1700000000000-0a9z00-Board_minutes-2026.v2.docx`,
    expected: { kind: "document", associationId: DAMEN },
  },
  {
    name: `${DAMEN}/tickets/${TICKET}/1700000000000-abc123-p.jpg`,
    expected: { kind: "ticket_photo", associationId: DAMEN, ticketId: TICKET },
  },
  {
    name: `${DAMEN}/tickets/${TICKET}/1760000000000-zz99aa-IMG_0042.jpeg`,
    expected: { kind: "ticket_photo", associationId: DAMEN, ticketId: TICKET },
  },

  // Junk.
  { name: "", expected: null },
  { name: "../x", expected: null },
  { name: `${DAMEN}/../x`, expected: null },
  { name: "not-a-uuid/1700000000000-abc123-a.pdf", expected: null },
  { name: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA/1700000000000-abc123-a.pdf", expected: null },
  { name: `${DAMEN}/tickets/7C000000-0000-0000-0000-000000000001/1700000000000-abc123-p.jpg`, expected: null },
  { name: `11111111-1111-1111-1111-11111111111A/1700000000000-abc123-a.pdf`, expected: null },
  { name: `${DAMEN}`, expected: null },
  { name: `${DAMEN}/`, expected: null },
  { name: `${DAMEN}/sub/1700000000000-abc123-a.pdf`, expected: null },
  { name: `${DAMEN}/tickets/${TICKET}`, expected: null },
  { name: `${DAMEN}/tickets/${TICKET}/a.jpg`, expected: null },
  { name: `${DAMEN}/tickets/${TICKET}/x/1700000000000-abc123-p.jpg`, expected: null },
  { name: `${DAMEN}/photos/${TICKET}/1700000000000-abc123-p.jpg`, expected: null },
  { name: `${DAMEN}/tickets/not-a-uuid/1700000000000-abc123-p.jpg`, expected: null },
  // Timestamp must be 13 digits, suffix 6 of [a-z0-9].
  { name: `${DAMEN}/170000000000-abc123-a.pdf`, expected: null },
  { name: `${DAMEN}/1700000000000-ABC123-a.pdf`, expected: null },
  { name: `${DAMEN}/1700000000000-abc12-a.pdf`, expected: null },
  // The name part: only [A-Za-z0-9_.-], 1 to 120 characters.
  { name: `${DAMEN}/1700000000000-abc123-`, expected: null },
  { name: `${DAMEN}/1700000000000-abc123-a b.pdf`, expected: null },
  { name: `${DAMEN}/1700000000000-abc123-${"a".repeat(121)}`, expected: null },
  {
    name: `${DAMEN}/1700000000000-abc123-${"a".repeat(120)}`,
    expected: { kind: "document", associationId: DAMEN },
  },
  // Legacy hub paths (before direct uploads) are not classified; they always
  // have a documents row.
  { name: `${DAMEN}/1700000000000-declarations.pdf`, expected: null },
];
