import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { MAX_ZIP_ENTRIES, MAX_ZIP_UNCOMPRESSED_BYTES, zipLooksSafe, zipStats } from "@/lib/import/zip-stats";

/** A zip that is only a central directory: enough for zipStats, which never inflates anything. */
function fakeZip(entries: { name: string; size: number }[], opts: { comment?: string } = {}): Uint8Array {
  const parts: number[] = [];
  const push32 = (n: number) => parts.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const push16 = (n: number) => parts.push(n & 255, (n >>> 8) & 255);
  const cdStart = parts.length;
  for (const e of entries) {
    push32(0x02014b50); push16(20); push16(20); push16(0); push16(0); push16(0); push16(0);
    push32(0); push32(10); push32(e.size);
    push16(e.name.length); push16(0); push16(0); push16(0); push16(0); push32(0); push32(0);
    for (const c of e.name) parts.push(c.charCodeAt(0));
  }
  const cdSize = parts.length - cdStart;
  const comment = opts.comment ?? "";
  push32(0x06054b50); push16(0); push16(0); push16(entries.length); push16(entries.length);
  push32(cdSize); push32(cdStart); push16(comment.length);
  for (const c of comment) parts.push(c.charCodeAt(0));
  return new Uint8Array(parts);
}

describe("zipStats", () => {
  it("reads a real small workbook", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Data").getCell("A1").value = "x";
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const s = zipStats(bytes);
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(s.entries).toBeGreaterThan(3);
      expect(s.entries).toBeLessThan(30);
      expect(zipLooksSafe(s)).toBe(true);
    }
  });

  it("reports a crafted directory declaring 61 MB and 301 entries", () => {
    const big = zipStats(fakeZip([{ name: "xl/a.xml", size: 61 * 1024 * 1024 }]));
    expect(big.ok && big.uncompressedBytes).toBe(61 * 1024 * 1024);
    expect(big.ok && zipLooksSafe(big)).toBe(false);
    const many = zipStats(fakeZip(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, size: 1 }))));
    expect(many.ok && many.entries).toBe(301);
    expect(many.ok && zipLooksSafe(many)).toBe(false);
    const edge = zipStats(fakeZip([{ name: "a", size: MAX_ZIP_UNCOMPRESSED_BYTES }]));
    expect(edge.ok && zipLooksSafe(edge)).toBe(true);
  });

  it("finds the end record behind a zip comment", () => {
    const s = zipStats(fakeZip([{ name: "a", size: 5 }], { comment: "hello comment" }));
    expect(s).toMatchObject({ ok: true, entries: 1, uncompressedBytes: 5 });
  });

  it("treats a zip64 size as unsafe", () => {
    const s = zipStats(fakeZip([{ name: "a", size: 0xffffffff }]));
    expect(s.ok && zipLooksSafe(s)).toBe(false);
  });

  it("rejects truncated bytes and non-zip bytes", () => {
    const whole = fakeZip([{ name: "a", size: 5 }]);
    expect(zipStats(new Uint8Array([0x50, 0x4b, ...new Array(40).fill(0)]))).toEqual({ ok: false, reason: "truncated" });
    expect(zipStats(whole.subarray(0, whole.length - 5))).toEqual({ ok: false, reason: "truncated" });
    expect(zipStats(new TextEncoder().encode("Unit,Owner\n1,Ada\n,,,,,,,,,,,,,,,,,,,,,,,,,,"))).toEqual({ ok: false, reason: "not_zip" });
    expect(zipStats(new Uint8Array(0))).toEqual({ ok: false, reason: "not_zip" });
  });
});
