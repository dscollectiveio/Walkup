import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ticket photos in the browser (repairs-spec §5.2, §6, §17.3), with the
 * browser's decoder and the foundation's upload pipeline mocked.
 */

const { normaliseImage, uploadFile } = vi.hoisted(() => ({ normaliseImage: vi.fn(), uploadFile: vi.fn() }));
vi.mock("@/lib/documents/image-normalise", () => ({ normaliseImage: (...a: unknown[]) => normaliseImage(...a) }));
vi.mock("@/components/upload/upload-file", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));

import { PREPARED_MAX_EDGE, preparePhoto, uploadTicketPhotos } from "@/lib/repairs/photos";

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEIC_HEAD = [0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0];

function file(name: string, type: string, head: number[], size = 4096): File {
  const bytes = new Uint8Array(Math.max(size, head.length));
  bytes.set(head);
  return new File([bytes], name, { type });
}

function stubBitmap(width: number, height: number | null) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      if (height === null) throw new Error("can't decode");
      return { width, height, close: () => {} };
    }),
  );
}

beforeEach(() => {
  normaliseImage.mockReset();
  uploadFile.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preparePhoto", () => {
  it("re-encodes a large-edged JPEG to at most 2,560 px", async () => {
    stubBitmap(4032, 3024);
    const small = new File([new Uint8Array(1000)], "IMG_1.jpg", { type: "image/jpeg" });
    normaliseImage.mockResolvedValue(small);
    const r = await preparePhoto(file("IMG_1.jpg", "image/jpeg", JPEG_HEAD));
    expect(normaliseImage).toHaveBeenCalledWith(expect.any(File), { maxEdge: PREPARED_MAX_EDGE, quality: 0.85 });
    expect(r).toEqual({ file: small, mime: "image/jpeg" });
  });

  it("leaves a small JPEG alone", async () => {
    stubBitmap(1200, 900);
    const f = file("small.jpg", "image/jpeg", JPEG_HEAD);
    const r = await preparePhoto(f);
    expect(normaliseImage).not.toHaveBeenCalled();
    expect(r).toEqual({ file: f, mime: "image/jpeg" });
  });

  it("re-encodes anything over 2.5 MB even with small edges", async () => {
    stubBitmap(800, 600);
    normaliseImage.mockResolvedValue(new File([new Uint8Array(10)], "big.jpg", { type: "image/jpeg" }));
    await preparePhoto(file("big.png", "image/png", PNG_HEAD, 3 * 1024 * 1024));
    expect(normaliseImage).toHaveBeenCalled();
  });

  it("refuses a PDF with the foundation's photo copy", async () => {
    const r = await preparePhoto(file("quote.pdf", "application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]));
    expect(r).toEqual({ error: "quote.pdf isn't a photo Walkup can store. JPEG, PNG and iPhone photos work." });
  });

  it("passes an undecodable HEIC through unchanged", async () => {
    stubBitmap(0, null);
    normaliseImage.mockResolvedValue(null);
    const f = file("IMG_2.HEIC", "image/heic", HEIC_HEAD);
    const r = await preparePhoto(f);
    expect(r).toEqual({ file: f, mime: "image/heic" });
  });

  it("refuses a photo still over 15 MB after preparation", async () => {
    stubBitmap(0, null);
    normaliseImage.mockResolvedValue(null);
    const r = await preparePhoto(file("huge.jpg", "image/jpeg", JPEG_HEAD, 16 * 1024 * 1024));
    expect(r).toEqual({ error: "huge.jpg is larger than 15 MB. Try a smaller photo." });
  });
});

describe("uploadTicketPhotos", () => {
  it("uploads one after another, collects failures and carries on", async () => {
    uploadFile
      .mockResolvedValueOnce({ state: "added", documentId: "d1", filename: "a.jpg" })
      .mockResolvedValueOnce({ state: "failed", filename: "b.jpg", error: "b.jpg didn't finish uploading. Try again." })
      .mockResolvedValueOnce({ state: "duplicate", documentId: "d3", filename: "c.jpg" });
    const progress: [number, number][] = [];
    const files = ["a.jpg", "b.jpg", "c.jpg"].map((n) => file(n, "image/jpeg", JPEG_HEAD));
    const r = await uploadTicketPhotos("t-1", files, (i, n) => progress.push([i, n]));
    expect(r).toEqual({ uploaded: 2, failed: [{ name: "b.jpg", reason: "b.jpg didn't finish uploading. Try again." }] });
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(uploadFile.mock.calls[0][1]).toEqual({ purpose: "ticket_photo", ticketId: "t-1", normaliseImages: false });
  });

  it("a thrown upload counts as failed", async () => {
    uploadFile.mockRejectedValue(new Error("network"));
    const r = await uploadTicketPhotos("t-1", [file("a.jpg", "image/jpeg", JPEG_HEAD)], () => {});
    expect(r.uploaded).toBe(0);
    expect(r.failed[0].name).toBe("a.jpg");
  });
});
