import { describe, expect, it } from "vitest";
import { mimeEssence, verifyBlobHead } from "@/lib/documents/sniff";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function blob(bytes: number[] | string, type: string): Blob {
  const body = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  return new Blob([body], { type });
}

/** An ISO-BMFF header: size, "ftyp", brand. */
function ftyp(brand: string): number[] {
  return [0, 0, 0, 0x18, ...[..."ftyp"].map((c) => c.charCodeAt(0)), ...[...brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0];
}

/**
 * The browser runs this before uploading and the server runs verifyFile on
 * the stored bytes; both read only the head, so they agree.
 */
describe("verifyBlobHead", () => {
  it("recognises a PDF", async () => {
    expect(await verifyBlobHead(blob("%PDF-1.7\n...", "application/pdf"))).toEqual({ ok: true, mime: "application/pdf" });
  });

  it("recognises a PNG", async () => {
    expect(await verifyBlobHead(blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0], "image/png"))).toEqual({
      ok: true,
      mime: "image/png",
    });
  });

  it("recognises a JPEG even when the browser said nothing", async () => {
    expect(await verifyBlobHead(blob([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], ""))).toEqual({ ok: true, mime: "image/jpeg" });
  });

  it("recognises HEIC by its ftyp brand (heic and mif1)", async () => {
    expect(await verifyBlobHead(blob(ftyp("heic"), ""))).toEqual({ ok: true, mime: "image/heic" });
    expect(await verifyBlobHead(blob(ftyp("mif1"), "image/heif"))).toEqual({ ok: true, mime: "image/heic" });
  });

  it("accepts a docx only when the browser declared it", async () => {
    const zip = [0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0];
    expect(await verifyBlobHead(blob(zip, DOCX))).toEqual({ ok: true, mime: DOCX });
    const undeclared = await verifyBlobHead(blob(zip, ""));
    expect(undeclared.ok).toBe(false);
  });

  it("refines plain text to CSV when declared, including with parameters", async () => {
    expect(await verifyBlobHead(blob("a,b\n1,2\n", "text/csv"))).toEqual({ ok: true, mime: "text/csv" });
    expect(await verifyBlobHead(blob("a,b\n1,2\n", "Text/CSV; charset=utf-8"))).toEqual({ ok: true, mime: "text/csv" });
  });

  it("reports an HTML file declared as PDF as text/plain, so the server's mismatch rule rejects it", async () => {
    const v = await verifyBlobHead(blob("<html><script>alert(1)</script></html>", "application/pdf"));
    expect(v).toEqual({ ok: true, mime: "text/plain" });
  });

  it("rejects an unrecognised binary blob", async () => {
    const v = await verifyBlobHead(blob([0x00, 0x01, 0x02, 0x03, 0x00], "application/pdf"));
    expect(v.ok).toBe(false);
  });

  it("reads only the head of a large file", async () => {
    const big = new Uint8Array(5 * 1024 * 1024);
    big.set([0x25, 0x50, 0x44, 0x46]);
    expect(await verifyBlobHead(new Blob([big], { type: "application/pdf" }))).toEqual({
      ok: true,
      mime: "application/pdf",
    });
  });
});

describe("mimeEssence", () => {
  it("drops parameters, trims and lowercases", () => {
    expect(mimeEssence("Text/CSV; charset=utf-8")).toBe("text/csv");
    expect(mimeEssence(" image/JPEG ")).toBe("image/jpeg");
  });

  it("is empty for nothing", () => {
    expect(mimeEssence("")).toBe("");
    expect(mimeEssence(null)).toBe("");
    expect(mimeEssence(undefined)).toBe("");
  });
});
