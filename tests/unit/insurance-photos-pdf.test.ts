import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocumentProxy } from "unpdf";
import { ImageDecodeError, imagesToPdf, jpegInfo, photosPdfName, reencodeImage } from "@/lib/insurance/photos-pdf";
import { JPEG_2X5_BASE64, JPEG_4X3_BASE64 } from "../fixtures/insurance-jpegs";

const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));
const jpeg = (b64: string) => new Blob([bytes(b64)], { type: "image/jpeg" });

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe("imagesToPdf", () => {
  it("reads JPEG dimensions from the SOF segment", () => {
    expect(jpegInfo(bytes(JPEG_4X3_BASE64))).toMatchObject({ width: 4, height: 3 });
    expect(jpegInfo(bytes(JPEG_2X5_BASE64))).toMatchObject({ width: 2, height: 5 });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("two JPEGs → a PDF that unpdf opens with 2 pages, the JPEG bytes unchanged", async () => {
    const pdf = await imagesToPdf([jpeg(JPEG_4X3_BASE64), jpeg(JPEG_2X5_BASE64)], "Declarations (photos)");
    expect(pdf.type).toBe("application/pdf");
    const out = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(out.slice(0, 8))).toBe("%PDF-1.4");
    expect(indexOf(out, bytes(JPEG_4X3_BASE64))).toBeGreaterThan(0);
    expect(indexOf(out, bytes(JPEG_2X5_BASE64))).toBeGreaterThan(0);

    const doc = await getDocumentProxy(out.slice());
    expect(doc.numPages).toBe(2);
    const first = await doc.getPage(1);
    const [, , w, h] = first.view;
    expect(Math.max(w, h)).toBeCloseTo(842, 0);
    expect(w / h).toBeCloseTo(4 / 3, 2);
    const second = await doc.getPage(2);
    expect(second.view[3]).toBeCloseTo(842, 0);
  });

  it("refuses a non-JPEG", async () => {
    await expect(imagesToPdf([new Blob([new Uint8Array([1, 2, 3, 4])])], "x")).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it("names the joined file after the first photo", () => {
    expect(photosPdfName("IMG_0042.jpg")).toBe("IMG_0042 (photos).pdf");
  });
});

describe("reencodeImage (canvas mocked)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downscales to 2400 px on the longest side and exports JPEG at 0.85", async () => {
    const drawn: number[][] = [];
    let exported: { type?: string; quality?: number } | null = null;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4800, height: 3600, close: () => {} })));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(public width: number, public height: number) {
          drawn.push([width, height]);
        }
        getContext() {
          return { fillStyle: "", fillRect: () => {}, drawImage: () => {} };
        }
        async convertToBlob(opts: { type?: string; quality?: number }) {
          exported = opts;
          return new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
        }
      },
    );
    const out = await reencodeImage(new File([new Uint8Array([1])], "IMG_1.HEIC", { type: "image/heic" }));
    expect(drawn).toEqual([[2400, 1800]]);
    expect(exported).toEqual({ type: "image/jpeg", quality: 0.85 });
    expect(out.type).toBe("image/jpeg");
  });

  it("throws ImageDecodeError when the browser can't decode it", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("unsupported");
    }));
    await expect(reencodeImage(new File([new Uint8Array([1])], "x.heic"))).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
