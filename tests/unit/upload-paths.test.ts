import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  buildStoragePath,
  isPhotoType,
  parseStoragePath,
  randomSuffix,
  safeStorageName,
} from "@/lib/documents/upload-paths";
import { STORAGE_PATH_CASES } from "../fixtures/storage-paths";

const DAMEN = "11111111-1111-1111-1111-111111111111";
const TICKET = "7c000000-0000-0000-0000-000000000001";

/**
 * The TypeScript half of the storage-path mirror. The SQL half
 * (storage_path_kind, 0051) runs the same fixture table in
 * tests/db/ai-and-uploads.test.ts, so a path one side accepts and the other
 * refuses fails a test instead of failing an upload.
 */
describe("safeStorageName", () => {
  it("replaces runs of unsafe characters with one underscore", () => {
    expect(safeStorageName("Board minutes (May).pdf")).toBe("Board_minutes_May_.pdf");
  });

  it("replaces non-ASCII letters", () => {
    expect(safeStorageName("Résumé ünit.pdf")).toBe("R_sum_nit.pdf");
  });

  it("keeps the last 120 characters", () => {
    const long = `${"a".repeat(200)}.pdf`;
    const safe = safeStorageName(long);
    expect(safe).toHaveLength(120);
    expect(safe.endsWith(".pdf")).toBe(true);
  });

  it("falls back to 'file' when nothing is left", () => {
    expect(safeStorageName("")).toBe("file");
  });

  it("never produces a path separator", () => {
    expect(safeStorageName("../../etc/passwd")).not.toContain("/");
  });
});

describe("randomSuffix", () => {
  it("is 6 characters of [a-z0-9]", () => {
    for (let i = 0; i < 50; i++) expect(randomSuffix()).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("buildStoragePath", () => {
  it("builds a hub document path the parser recognises", () => {
    const path = buildStoragePath({
      purpose: "document",
      associationId: DAMEN,
      now: 1700000000000,
      suffix: "abc123",
      filename: "Declarations page.pdf",
    });
    expect(path).toBe(`${DAMEN}/1700000000000-abc123-Declarations_page.pdf`);
    expect(parseStoragePath(path)).toEqual({ kind: "document", associationId: DAMEN });
  });

  it("builds a ticket photo path the parser recognises", () => {
    const path = buildStoragePath({
      purpose: "ticket_photo",
      associationId: DAMEN,
      ticketId: TICKET,
      now: 1760000000000,
      suffix: "zz99aa",
      filename: "IMG 0042.jpg",
    });
    expect(path).toBe(`${DAMEN}/tickets/${TICKET}/1760000000000-zz99aa-IMG_0042.jpg`);
    expect(parseStoragePath(path)).toEqual({ kind: "ticket_photo", associationId: DAMEN, ticketId: TICKET });
  });

  it("an empty or all-unicode filename still yields a valid path", () => {
    for (const filename of ["", "写真"]) {
      const path = buildStoragePath({
        purpose: "document",
        associationId: DAMEN,
        now: Date.now(),
        suffix: randomSuffix(),
        filename,
      });
      expect(parseStoragePath(path)?.kind).toBe("document");
    }
  });
});

describe("parseStoragePath agrees with SQL storage_path_kind", () => {
  it.each(STORAGE_PATH_CASES.map((c) => [c.name.slice(0, 90), c] as const))("%s", (_label, c) => {
    expect(parseStoragePath(c.name)).toEqual(c.expected);
  });
});

describe("limits", () => {
  it("match the bucket and attach_ticket_photo caps", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(26214400);
    expect(MAX_PHOTO_BYTES).toBe(15728640);
    expect([...PHOTO_TYPES]).toEqual(["image/jpeg", "image/png", "image/heic"]);
    expect(isPhotoType("image/png")).toBe(true);
    expect(isPhotoType("application/pdf")).toBe(false);
  });
});
