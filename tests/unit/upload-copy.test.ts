import { describe, expect, it } from "vitest";
import {
  UPLOAD_COPY,
  contentsMismatch,
  couldNotSave,
  defaultHelp,
  documentHelp,
  isHeicPhoto,
  networkError,
  notFinished,
  photoAlt,
  photoCaption,
  reportPartialFailure,
  rowActive,
  rowText,
  tooBig,
  tooManyFiles,
  wrongType,
  type RowState,
} from "@/components/upload/upload-copy";

/** Exact copy from foundation-spec 6.9; DirectUpload renders these strings as they are. */
describe("upload copy", () => {
  it("document help depends on the category's default visibility", () => {
    expect(documentHelp(null)).toBe(
      "PDFs, photos, Word, Excel and text files, up to 25 MB each. Only your board can see them unless you share them.",
    );
    expect(documentHelp({ label: "Insurance", defaultVisibility: "board_only" })).toBe(documentHelp(null));
    expect(documentHelp({ label: "Governing documents", defaultVisibility: "all_owners" })).toBe(
      "PDFs, photos, Word, Excel and text files, up to 25 MB each. Filed as Governing documents, so every owner can see them.",
    );
    expect(defaultHelp("ticket_photo")).toBe("JPEG, PNG or iPhone photos, up to 15 MB each, 6 at a time.");
    expect(defaultHelp("document")).toBe(documentHelp(null));
  });

  it("list and file errors", () => {
    expect(tooManyFiles(6)).toBe("Choose up to 6 files at a time.");
    expect(tooBig("document", "policy-full.pdf")).toBe(
      "policy-full.pdf is larger than 25 MB. Try a smaller scan, or split it.",
    );
    expect(tooBig("ticket_photo", "IMG_1.jpg")).toBe("IMG_1.jpg is larger than 15 MB. Try a smaller photo.");
    expect(wrongType("ticket_photo", "inspection.pdf")).toBe(
      "inspection.pdf isn't a photo Walkup can store. JPEG, PNG and iPhone photos work.",
    );
    expect(wrongType("document", "a.exe", "isn't a file type Walkup can store. PDFs, photos, Word, Excel, and text files work.")).toBe(
      "a.exe isn't a file type Walkup can store. PDFs, photos, Word, Excel and text files work.",
    );
    expect(wrongType("document", "a.zip", "looks like a zip archive. Upload the documents inside it individually.")).toBe(
      "a.zip looks like a zip archive. Upload the documents inside it individually.",
    );
    expect(wrongType("document", "a.bin")).toBe(
      "a.bin isn't a file type Walkup can store. PDFs, photos, Word, Excel and text files work.",
    );
    expect(contentsMismatch("x.pdf")).toBe("x.pdf's contents don't match its file type, so it wasn't added.");
    expect(networkError("x.pdf")).toBe("x.pdf didn't finish uploading. Check your connection and try again.");
    expect(notFinished("x.pdf")).toBe("x.pdf didn't finish uploading. Try again.");
    expect(couldNotSave("x.pdf")).toBe("x.pdf couldn't be saved. Try again.");
  });

  it("report-time partial failure, singular and plural", () => {
    expect(reportPartialFailure(1)).toBe("Your problem was reported. 1 photo didn't upload.");
    expect(reportPartialFailure(3)).toBe("Your problem was reported. 3 photos didn't upload.");
  });

  it("contains no em dashes", () => {
    const all = [
      ...Object.values(UPLOAD_COPY),
      documentHelp({ label: "X", defaultVisibility: "all_owners" }),
      tooBig("document", "a"),
      wrongType("document", "a"),
    ];
    for (const s of all) expect(s).not.toContain("—");
  });
});

describe("rowText", () => {
  const cases: [RowState, string][] = [
    [{ state: "preparing" }, "Preparing…"],
    [{ state: "checking" }, "Checking…"],
    [{ state: "uploading", bytes: 9 * 1024 * 1024 }, "Uploading 9.0 MB…"],
    [{ state: "saving" }, "Saving…"],
    [{ state: "added" }, "Added"],
    [
      { state: "added", linkFailed: true },
      "Added, but it couldn't be attached here. Attach it from Documents.",
    ],
    [{ state: "duplicate", purpose: "document" }, "Already in your documents, so nothing new was added."],
    [{ state: "duplicate", purpose: "ticket_photo", onThisProblem: true }, "This photo is already on this problem."],
    [
      { state: "duplicate", purpose: "ticket_photo", alreadyStored: true, narrowerAudience: true },
      "This photo is already on another problem with a smaller audience.",
    ],
    [
      { state: "duplicate", purpose: "ticket_photo", alreadyStored: true },
      "Walkup already has this exact photo, so it wasn't added again. If it belongs on this problem, ask your board to attach it.",
    ],
    [{ state: "failed", error: "Nope." }, "Nope."],
  ];
  it.each(cases)("%j", (row, text) => {
    expect(rowText(row)).toBe(text);
  });

  it("only in-flight rows are active", () => {
    expect(rowActive({ state: "queued" })).toBe(false);
    expect(rowActive({ state: "uploading", bytes: 1 })).toBe(true);
    expect(rowActive({ state: "saving" })).toBe(true);
    expect(rowActive({ state: "failed", error: "x" })).toBe(false);
  });
});

describe("ticket photo captions and alt text", () => {
  it("board and accountant see names, a removed person reads as a former member", () => {
    expect(
      photoCaption({ viewerSeesNames: true, addedByKind: "owner", addedByName: "Ada Okonkwo", dateText: "October 14, 2026" }),
    ).toBe("Added by Ada Okonkwo, October 14, 2026");
    expect(photoCaption({ viewerSeesNames: true, addedByKind: "owner", addedByName: null, dateText: "May 1, 2026" })).toBe(
      "Added by a former member, May 1, 2026",
    );
  });

  it("everyone else sees roles", () => {
    const base = { viewerSeesNames: false, addedByName: null, dateText: "October 14, 2026" };
    expect(photoCaption({ ...base, addedByKind: "you" })).toBe("Added by you, October 14, 2026");
    expect(photoCaption({ ...base, addedByKind: "board" })).toBe("Added by the board, October 14, 2026");
    expect(photoCaption({ ...base, addedByKind: "owner" })).toBe("Added by an owner, October 14, 2026");
  });

  it("alt text uses the board's title when there is one", () => {
    expect(photoAlt({ index: 2, count: 3, title: null, dateText: "October 14, 2026" })).toBe(
      "Photo 2 of 3, added October 14, 2026",
    );
    expect(photoAlt({ index: 1, count: 3, title: "Ceiling stain", dateText: "x" })).toBe("Ceiling stain, photo 1 of 3");
  });

  it("HEIC renders as a chip", () => {
    expect(isHeicPhoto("image/heic")).toBe(true);
    expect(isHeicPhoto("image/jpeg")).toBe(false);
    expect(isHeicPhoto(null)).toBe(false);
  });
});
