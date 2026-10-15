import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { csvLine, safeCell, toXlsxCell } from "@/lib/import/safe-cell";

describe("safeCell (formula injection guard)", () => {
  const payloads = ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1", '=HYPERLINK("http://x")', "  =1+1", "\n=1", "+1+1", "-cmd|' /C calc'!A0"];

  it.each(payloads)("prefixes %j so a spreadsheet shows it as text", (p) => {
    const out = safeCell(p);
    expect(out).toBe(`'${p}`);
  });

  it("leaves numbers, plain negatives and ordinary text alone", () => {
    expect(safeCell(12.5)).toBe(12.5);
    expect(safeCell(-3)).toBe(-3);
    expect(safeCell("-450.00")).toBe("-450.00");
    expect(safeCell("450")).toBe("450");
    expect(safeCell("Boiler repair, Acme")).toBe("Boiler repair, Acme");
    expect(safeCell("a=b")).toBe("a=b");
    expect(safeCell(null)).toBe("");
    expect(safeCell(Number.NaN)).toBe("");
  });

  it("csvLine guards each cell and quotes commas, quotes and line breaks", () => {
    expect(csvLine(["Unit 1", "=1+1", 5, null])).toBe("Unit 1,'=1+1,5,");
    expect(csvLine(['say "hi"', "a,b", "line\nbreak"])).toBe('"say ""hi""","a,b","line\nbreak"');
    expect(csvLine(["-12.50"])).toBe("-12.50");
  });

  it("toXlsxCell writes strings as plain strings, never as a formula object", async () => {
    for (const p of payloads) {
      const v = toXlsxCell(p);
      expect(typeof v).toBe("string");
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("t");
    ws.getCell("A1").value = toXlsxCell("=1+1");
    ws.getCell("A2").value = toXlsxCell(42);
    const buf = await wb.xlsx.writeBuffer();
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as ArrayBuffer);
    const a1 = back.worksheets[0].getCell("A1").value;
    expect(typeof a1).toBe("string");
    expect(a1).toBe("'=1+1");
    expect(back.worksheets[0].getCell("A2").value).toBe(42);
  });
});
