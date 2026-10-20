import { describe, expect, it } from "vitest";
import {
  announcementInput,
  announcementPreview,
  attachmentFix,
  attachmentReadable,
  audienceLabel,
  mapSaveError,
  ownersReached,
  readSummary,
  sortAnnouncements,
  type AnnouncementRow,
} from "@/lib/owner/announcements";

const GUID = "aaaa1111-0000-4000-8000-000000000001";
const valid = { id: null, title: "Water off", body: "From 9 to 11.", audience: "all", publish: true };
const row = (o: Partial<AnnouncementRow>): AnnouncementRow => ({
  id: "x", title: "t", body: "b", audience: "all", pinned: false, importance: "normal", status: "published", attachment_document_id: null,
  expires_on: null, published_at: "2026-10-01T10:00:00Z", edited_at: null, created_at: "2026-10-01T10:00:00Z", ...o,
});

describe("announcementInput", () => {
  it("accepts a plain post and fills defaults", () => {
    const r = announcementInput.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ unitIds: [], pinned: false, attachmentDocumentId: null, expiresOn: null });
  });
  it("trims and says what is missing", () => {
    const r = announcementInput.safeParse({ ...valid, title: "   ", body: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual(["Add a title.", "Write the message."]);
  });
  it("limits the title and the message", () => {
    const t = announcementInput.safeParse({ ...valid, title: "a".repeat(121) });
    expect(t.success ? "" : t.error.issues[0].message).toBe("Keep the title under 120 characters.");
    const b = announcementInput.safeParse({ ...valid, body: "a".repeat(5001) });
    expect(b.success ? "" : b.error.issues[0].message).toBe("Keep the message under 5,000 characters.");
    expect(announcementInput.safeParse({ ...valid, title: "a".repeat(120), body: "a".repeat(5000) }).success).toBe(true);
  });
  it("chosen units needs at least one unit", () => {
    const r = announcementInput.safeParse({ ...valid, audience: "units" });
    expect(r.success ? "" : r.error.issues[0].message).toBe("Choose at least one unit.");
    expect(announcementInput.safeParse({ ...valid, audience: "units", unitIds: [GUID] }).success).toBe(true);
  });
  it("only a posted announcement can be pinned", () => {
    const r = announcementInput.safeParse({ ...valid, pinned: true, publish: false });
    expect(r.success ? "" : r.error.issues[0].message).toBe("Only a posted announcement can be pinned.");
    expect(announcementInput.safeParse({ ...valid, pinned: true }).success).toBe(true);
  });
  it("rejects a malformed id and date", () => {
    expect(announcementInput.safeParse({ ...valid, id: "nope" }).success).toBe(false);
    expect(announcementInput.safeParse({ ...valid, expiresOn: "10/14/2026" }).success).toBe(false);
    expect(announcementInput.safeParse({ ...valid, expiresOn: "2026-10-14" }).success).toBe(true);
  });
});

describe("announcementPreview", () => {
  it("collapses whitespace and newlines", () => {
    expect(announcementPreview("Hello\n\n  there\tfriend")).toBe("Hello there friend");
  });
  it("cuts at a word and ends in three dots, never the ellipsis character", () => {
    const text = "The water will be off on Tuesday while the plumber replaces the main valve in the basement and checks every riser in the building";
    const p = announcementPreview(text, 60);
    expect(p.endsWith("...")).toBe(true);
    expect(p).not.toContain("…");
    expect(p.length).toBeLessThanOrEqual(63);
    expect(text.startsWith(p.slice(0, -3))).toBe(true);
    expect(p.slice(0, -3).endsWith(" ")).toBe(false);
  });
  it("leaves a short body alone", () => {
    expect(announcementPreview("Short.")).toBe("Short.");
  });
  it("drops tag-like text but keeps plain angle brackets", () => {
    expect(announcementPreview("<b>Bold</b> and <script>alert(1)</script> text")).toBe("Bold and alert(1) text");
    expect(announcementPreview("Is 5 < 6 and 7 > 3?")).toBe("Is 5 < 6 and 7 > 3?");
  });
});

describe("sortAnnouncements", () => {
  it("pinned first, then newest first", () => {
    const sorted = sortAnnouncements([
      row({ id: "old", published_at: "2026-09-01T00:00:00Z" }),
      row({ id: "pinned-old", pinned: true, published_at: "2026-08-01T00:00:00Z" }),
      row({ id: "new", published_at: "2026-10-05T00:00:00Z" }),
      row({ id: "pinned-new", pinned: true, published_at: "2026-09-20T00:00:00Z" }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["pinned-new", "pinned-old", "new", "old"]);
  });
  it("does not change the input and sorts drafts by when they were made", () => {
    const input = [row({ id: "a", status: "draft", published_at: null, created_at: "2026-10-01T00:00:00Z" }), row({ id: "b", status: "draft", published_at: null, created_at: "2026-10-09T00:00:00Z" })];
    expect(sortAnnouncements(input).map((r) => r.id)).toEqual(["b", "a"]);
    expect(input[0].id).toBe("a");
  });
});

describe("readSummary", () => {
  it("counts, singular and plural", () => {
    expect(readSummary({ readers_total: 4, readers_read: 3, no_login: 0 })).toBe("Read by 3 of 4 owners who can sign in");
    expect(readSummary({ readers_total: 1, readers_read: 1, no_login: 0 })).toBe("Read by 1 of 1 owner who can sign in");
  });
  it("says so when no owner can sign in", () => {
    expect(readSummary({ readers_total: 0, readers_read: 0, no_login: 0 })).toBe("No owner who can sign in sees this yet");
  });
  it("adds owners with no login", () => {
    expect(readSummary({ readers_total: 3, readers_read: 1, no_login: 1 })).toBe("Read by 1 of 3 owners who can sign in · 1 owner has no login yet");
    expect(readSummary({ readers_total: 3, readers_read: 1, no_login: 2 })).toBe("Read by 1 of 3 owners who can sign in · 2 owners have no login yet");
    expect(readSummary({ readers_total: 0, readers_read: 0, no_login: 2 })).toBe("No owner who can sign in sees this yet · 2 owners have no login yet");
  });
});

describe("audienceLabel", () => {
  it("everyone, one, two, many", () => {
    expect(audienceLabel({ audience: "all" }, [])).toBe("Everyone");
    expect(audienceLabel({ audience: "units" }, ["Unit 2"])).toBe("Unit 2");
    expect(audienceLabel({ audience: "units" }, ["Unit 2", "Unit 3"])).toBe("Unit 2, Unit 3");
    expect(audienceLabel({ audience: "units" }, ["Unit 2", "Unit 3", "Unit 4", "Unit 5", "Unit 6", "Unit 7"])).toBe("Unit 2, Unit 3 and 4 more");
    expect(audienceLabel({ audience: "units" }, [])).toBe("Chosen units");
  });
});

describe("mapSaveError", () => {
  it("maps the database's codes and hints to plain words", () => {
    expect(mapSaveError("42501", undefined, "x")).toBe("Only the board can post announcements.");
    expect(mapSaveError("22023", "attachment_not_shared", "x")).toBe("Owners can't open that file yet. Share it with all owners first.");
    expect(mapSaveError("22023", "no_units", "x")).toBe("Choose at least one unit.");
    expect(mapSaveError("22023", "expires_past", "x")).toBe("The end date is in the past.");
    expect(mapSaveError("23514", undefined, "only three announcements can be pinned at once")).toBe("Three announcements are already pinned. Unpin one first.");
    expect(mapSaveError(undefined, undefined, "boom")).toBe("Couldn't save that. Try again.");
    expect(mapSaveError("23514", undefined, "some other check")).toBe("Couldn't save that. Try again.");
  });
  it("never leaks the raw database message", () => {
    expect(mapSaveError("XX000", undefined, 'relation "x" does not exist')).not.toContain("relation");
  });
});

describe("attachments and audience size", () => {
  const shared = { visibility: "all_owners" as const, restrictedToUnitId: null };
  const boardOnly = { visibility: "board_only" as const, restrictedToUnitId: null };
  const pinned = { visibility: "board_only" as const, restrictedToUnitId: "u2" };
  it("a shared file fits any audience", () => {
    expect(attachmentReadable(shared, "all", [])).toBe(true);
    expect(attachmentReadable(shared, "units", ["u1", "u2"])).toBe(true);
  });
  it("a board-only file fits none and can be shared", () => {
    expect(attachmentReadable(boardOnly, "all", [])).toBe(false);
    expect(attachmentFix(boardOnly, "units", ["u1"])).toBe("share");
  });
  it("a unit-pinned file fits a post to exactly that unit", () => {
    expect(attachmentReadable(pinned, "units", ["u2"])).toBe(true);
    expect(attachmentReadable(pinned, "units", ["u1", "u2"])).toBe(false);
    expect(attachmentReadable(pinned, "all", [])).toBe(false);
    expect(attachmentFix(pinned, "all", [])).toBe("unit_only");
    expect(attachmentFix(pinned, "units", ["u2"])).toBe("none");
  });
  it("counts distinct owners reached", () => {
    const owners = { u1: ["a"], u2: ["b", "c"], u3: ["a"] };
    expect(ownersReached("all", [], owners)).toBe(3);
    expect(ownersReached("units", ["u2"], owners)).toBe(2);
    expect(ownersReached("units", ["u1", "u3"], owners)).toBe(1);
    expect(ownersReached("units", [], owners)).toBe(0);
  });
});
