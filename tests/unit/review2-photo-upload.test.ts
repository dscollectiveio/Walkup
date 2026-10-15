// Regression test for docs/security/REVIEW-2-server.md finding 18: a ticket photo that cannot be re-encoded
// in the browser (so keeps its EXIF location and device data) is refused, not uploaded as it is.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { normaliseImage, createUploadTarget, registerUpload } = vi.hoisted(() => ({
  normaliseImage: vi.fn(),
  createUploadTarget: vi.fn(async () => ({ error: "stop here" })),
  registerUpload: vi.fn(),
}));
vi.mock("@/lib/documents/image-normalise", () => ({ normaliseImage }));
vi.mock("@/app/documents/upload/actions", () => ({ createUploadTarget, registerUpload }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { uploadFile } from "@/components/upload/upload-file";

// A JPEG header is enough for the byte sniff.
const jpeg = (name: string) => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 16, 0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2, 3, 4, 0xff, 0xd9])], name, { type: "image/jpeg" });

beforeEach(() => {
  normaliseImage.mockReset();
  createUploadTarget.mockClear();
});

describe("18. ticket photos are re-encoded or refused", () => {
  it("refuses a photo the browser could not re-encode, before anything is uploaded", async () => {
    normaliseImage.mockResolvedValue(null);
    const r = await uploadFile(jpeg("IMG_1.jpg"), { purpose: "ticket_photo", ticketId: "t1" }, () => {});
    expect(r).toMatchObject({ state: "failed" });
    expect((r as { error: string }).error).toMatch(/JPEG/);
    expect(createUploadTarget).not.toHaveBeenCalled();
  });

  it("goes on with the re-encoded file when the browser could", async () => {
    normaliseImage.mockResolvedValue(jpeg("IMG_1.jpg"));
    await uploadFile(jpeg("IMG_1.jpg"), { purpose: "ticket_photo", ticketId: "t1" }, () => {});
    expect(createUploadTarget).toHaveBeenCalled();
  });

  it("documents keep the old behaviour: the original goes up if it cannot be re-encoded", async () => {
    normaliseImage.mockResolvedValue(null);
    await uploadFile(jpeg("scan.jpg"), { purpose: "document", normaliseImages: true }, () => {});
    expect(createUploadTarget).toHaveBeenCalled();
  });
});
