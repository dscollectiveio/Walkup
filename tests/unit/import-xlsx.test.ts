import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import { parseImportFile, PARSE_MESSAGES } from "@/lib/import/parse-file";
import { utf8, workbook } from "../fixtures/import/build";

async function parse(bytes: Uint8Array, name: string, kind?: "units_owners" | "transactions" | "opening_accounts" | "opening_units" | "contractors") {
  return parseImportFile(bytes, name, { kindHint: kind });
}

describe("parseImportFile: xlsx", () => {
  it("reads strings, numbers, dates and booleans as normalised text", async () => {
    const bytes = await workbook([
      { name: "Data", rows: [["Date", "Amount", "Memo", "Flag"], [new Date(Date.UTC(2026, 2, 14)), -450.1, "  Boiler   repair \n", true], [new Date(Date.UTC(2026, 2, 15)), 0.1 + 0.2, "x", false]] },
    ]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.headers).toEqual(["Date", "Amount", "Memo", "Flag"]);
    expect(r.file.rows).toEqual([["2026-03-14", "-450.1", "Boiler repair", "TRUE"], ["2026-03-15", "0.3", "x", "FALSE"]]);
    expect(r.file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.file.sheetName).toBe("Data");
    expect(r.file.warnings[0]).toBe("Read 2 rows.");
  });

  it("uses a formula's saved result, and flags one with no saved result", async () => {
    const bytes = await workbook([
      {
        name: "Data",
        rows: [
          ["Unit", "Amount"],
          ["Unit 1", { formula: "1+1", result: 2 } as ExcelJS.CellFormulaValue],
          ["Unit 2", { formula: "A2&B2", result: undefined } as unknown as ExcelJS.CellFormulaValue],
          ["Unit 3", { formula: "1/0", result: { error: "#DIV/0!" } } as unknown as ExcelJS.CellFormulaValue],
        ],
      },
    ]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.rows[0]).toEqual(["Unit 1", "2"]);
    expect(r.file.rows[1]).toEqual(["Unit 2", ""]);
    expect(r.file.issues.map((i) => [i.row, i.col, i.code])).toEqual([[1, 1, "parse_formula"], [2, 1, "parse_formula"]]);
    expect(r.file.issues[0].message).toBe(PARSE_MESSAGES.formula);
  });

  it("reads rich text, hyperlink text and error cells", async () => {
    const bytes = await workbook([
      {
        name: "Data",
        rows: [
          ["Name", "Website", "Notes"],
          [{ richText: [{ text: "Acme " }, { text: "Plumbing", font: { bold: true } }] } as ExcelJS.CellRichTextValue, { text: "acme.example", hyperlink: "http://acme.example" } as ExcelJS.CellHyperlinkValue, { error: "#N/A" } as ExcelJS.CellErrorValue],
        ],
      },
    ]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok && r.file.rows[0]).toEqual(["Acme Plumbing", "acme.example", ""]);
    expect(r.ok && r.file.issues.map((i) => i.code)).toEqual(["parse_formula"]);
  });

  it("reads a merged cell as its master only", async () => {
    const bytes = await workbook([{ name: "Data", rows: [["A", "B", "C"], ["top", undefined, "z"], ["other", "x", "y"]], merge: "A2:B2" }]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok && r.file.rows[0]).toEqual(["top", "", "z"]);
  });

  it("reads hidden rows like any other and says so", async () => {
    const bytes = await workbook([{ name: "Data", rows: [["A"], ["one"], ["two"], ["three"]], hiddenRows: [3] }]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok && r.file.rows).toEqual([["one"], ["two"], ["three"]]);
    expect(r.ok && r.file.warnings.join(" ")).toMatch(/1 hidden row was read like any other/);
  });

  it("chooses the sheet by name, then by kind, then the first with data, never Read me", async () => {
    const readMe = { name: "Read me", rows: [["Instructions"], ["Delete the example rows"]] };
    const named = await workbook([readMe, { name: "Notes", rows: [["x"], ["y"]] }, { name: "Data", rows: [["Unit"], ["Unit 1"]] }]);
    const a = await parse(named, "t.xlsx");
    expect(a.ok && a.file.sheetName).toBe("Data");

    const opening = await workbook([readMe, { name: "Unit balances", rows: [["Unit", "Amount owed"], ["Unit 2", 750]] }, { name: "Account balances", rows: [["Account", "Fund", "Debit", "Credit"], ["1000", "Operating", 5, ""]] }]);
    const accounts = await parse(opening, "t.xlsx", "opening_accounts");
    expect(accounts.ok && accounts.file.sheetName).toBe("Account balances");
    const units = await parse(opening, "t.xlsx", "opening_units");
    expect(units.ok && units.file.sheetName).toBe("Unit balances");

    const fallback = await workbook([readMe, { name: "Sheet1", rows: [["Unit"], ["Unit 1"]] }]);
    const f = await parse(fallback, "t.xlsx");
    expect(f.ok && f.file.sheetName).toBe("Sheet1");
  });

  it("skips empty rows and names blank headers", async () => {
    const bytes = await workbook([{ name: "Data", rows: [["Unit", undefined, "Owner"], ["Unit 1", "x", "Ada"], [], ["Unit 2", "y", "Bo"]] }]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok && r.file.headers).toEqual(["Unit", "(column B)", "Owner"]);
    expect(r.ok && r.file.rows).toHaveLength(2);
    expect(r.ok && r.file.warnings.join(" ")).toMatch(/1 empty row was skipped/);
  });

  it("refuses more than 5,000 rows and more than 40 columns with the spec's words", async () => {
    const many = await workbook([{ name: "Data", rows: [["Unit"], ...Array.from({ length: 5001 }, (_, i) => [`Unit ${i}`])] }]);
    const r = await parse(many, "t.xlsx");
    expect(r).toEqual({ ok: false, error: PARSE_MESSAGES.tooManyRows(5001) });
    expect(PARSE_MESSAGES.tooManyRows(5001)).toBe("That file has 5,001 rows. Walkup imports up to 5,000 at a time. Split it by year.");

    const wide = await workbook([{ name: "Data", rows: [Array.from({ length: 41 }, (_, i) => `C${i}`), Array.from({ length: 41 }, (_, i) => `v${i}`)] }]);
    expect(await parse(wide, "t.xlsx")).toEqual({ ok: false, error: "That file has 41 columns. Remove the ones you don't need and try again." });
  });

  it("accepts exactly 5,000 rows, and exactly 40 columns", async () => {
    const rows = await workbook([{ name: "Data", rows: [["Unit", "Amount"], ...Array.from({ length: 5000 }, (_, i) => [`Unit ${i}`, i])] }]);
    const r = await parse(rows, "t.xlsx");
    expect(r.ok && r.file.rowCount).toBe(5000);
    const cols = await workbook([{ name: "Data", rows: [Array.from({ length: 40 }, (_, i) => `C${i}`), Array.from({ length: 40 }, (_, i) => `v${i}`)] }]);
    const c = await parse(cols, "t.xlsx");
    expect(c.ok && c.file.headers).toHaveLength(40);
  }, 60_000);

  it("keeps a cell over 2,000 characters out of the data and flags the row", async () => {
    const bytes = await workbook([{ name: "Data", rows: [["Unit", "Notes"], ["Unit 1", "x".repeat(2500)], ["Unit 2", "y".repeat(2000)]] }]);
    const r = await parse(bytes, "t.xlsx");
    expect(r.ok && r.file.rows[0][1]).toHaveLength(200);
    expect(r.ok && r.file.rows[1][1]).toHaveLength(2000);
    expect(r.ok && r.file.issues).toEqual([{ row: 0, col: 1, code: "parse_cell_long", message: PARSE_MESSAGES.cellLong }]);
  });

  it("refuses a workbook with no data rows", async () => {
    const bytes = await workbook([{ name: "Data", rows: [["Unit", "Owner"]] }]);
    expect(await parse(bytes, "t.xlsx")).toEqual({ ok: false, error: PARSE_MESSAGES.noHeader });
  });
});

describe("parseImportFile: refusals", () => {
  it("refuses a file over 5 MB", async () => {
    const r = await parse(new Uint8Array(5 * 1024 * 1024 + 1), "big.csv");
    expect(r).toEqual({ ok: false, error: PARSE_MESSAGES.tooBig });
  });

  it("refuses other extensions, including .xls and macro workbooks", async () => {
    for (const name of ["a.xls", "a.xlsm", "a.numbers", "a.ods", "a.pdf", "a", "a.csv.exe"]) {
      expect(await parse(utf8("a,b\n1,2\n"), name), name).toEqual({ ok: false, error: PARSE_MESSAGES.wrongType });
    }
    expect((await parse(utf8("a,b\n1,2\n"), "A.CSV")).ok).toBe(true);
  });

  it("refuses an .xlsx that is not a zip, a zip that is not a workbook, and a csv with NUL bytes", async () => {
    expect(await parse(utf8("Unit,Owner\n1,Ada\n"), "a.xlsx")).toEqual({ ok: false, error: PARSE_MESSAGES.notSpreadsheet });
    expect(await parse(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), "a.xlsx")).toEqual({ ok: false, error: PARSE_MESSAGES.notSpreadsheet });
    expect(await parse(new Uint8Array([85, 110, 105, 116, 0, 44, 49, 10, 49]), "a.csv")).toEqual({ ok: false, error: PARSE_MESSAGES.notSpreadsheet });
    const zipped = await workbook([{ name: "Data", rows: [["a"], ["b"]] }]);
    expect(await parse(zipped, "a.csv")).toEqual({ ok: false, error: PARSE_MESSAGES.notSpreadsheet });
  });

  it("refuses a workbook whose zip claims to be huge inside", async () => {
    const parts: number[] = [];
    const p32 = (n: number) => parts.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    const p16 = (n: number) => parts.push(n & 255, (n >>> 8) & 255);
    p32(0x02014b50); p16(20); p16(20); p16(0); p16(0); p16(0); p16(0); p32(0); p32(10); p32(61 * 1024 * 1024);
    p16(1); p16(0); p16(0); p16(0); p16(0); p32(0); p32(0); parts.push(97);
    const cdSize = parts.length;
    p32(0x06054b50); p16(0); p16(0); p16(1); p16(1); p32(cdSize); p32(0); p16(0);
    expect(await parse(new Uint8Array(parts), "bomb.xlsx")).toEqual({ ok: false, error: PARSE_MESSAGES.zipLarge });
  });
});

describe("parseImportFile: csv", () => {
  it("reads a BOM, CRLF and quoted fields; names blank headers; pads ragged rows", async () => {
    const text = "﻿Unit,,Owner name\r\nUnit 1,x,\"Okonkwo, Ada\"\r\nUnit 2\r\n";
    const r = await parse(utf8(text), "a.csv");
    expect(r.ok && r.file.headers).toEqual(["Unit", "(column B)", "Owner name"]);
    expect(r.ok && r.file.rows).toEqual([["Unit 1", "x", "Okonkwo, Ada"], ["Unit 2", "", ""]]);
  });

  it("warns once about extra cells and about Windows text", async () => {
    const r = await parse(new Uint8Array([...utf8("Name,Note\nJos"), 0xe9, ...utf8(",ok,extra\n")]), "a.csv");
    expect(r.ok && r.file.rows[0][0]).toBe("José");
    expect(r.ok && r.file.warnings).toEqual(expect.arrayContaining([PARSE_MESSAGES.ragged, "Read as Windows text. Check that names with accents look right."]));
  });

  it("reads UTF-16 text saved by Excel", async () => {
    const text = "Unit\tOwner\nUnit 1\tAda\n";
    const bytes = new Uint8Array([0xff, 0xfe, ...Array.from(text).flatMap((c) => [c.charCodeAt(0), 0])]);
    const r = await parse(bytes, "a.csv");
    expect(r.ok && r.file.rows).toEqual([["Unit 1", "Ada"]]);
  });

  it("keeps hostile cells as text and strips control characters", async () => {
    const r = await parse(utf8('Unit,Memo\nUnit 1,"=cmd|\' /C calc\'!A0"\nUnit 2,"+1+1"\nUnit 3,"a\u0007b"\n'), "a.csv");
    expect(r.ok && r.file.rows.map((x) => x[1])).toEqual(["=cmd|' /C calc'!A0", "+1+1", "ab"]);
  });

  it("removes the apostrophe Excel adds to force text", async () => {
    const r = await parse(utf8("Unit,Phone\nUnit 1,'0123\n"), "a.csv");
    expect(r.ok && r.file.rows[0][1]).toBe("0123");
  });

  it("refuses a csv with only a header", async () => {
    expect(await parse(utf8("Unit,Owner\n"), "a.csv")).toEqual({ ok: false, error: PARSE_MESSAGES.noHeader });
    expect(await parse(utf8(""), "a.csv")).toEqual({ ok: false, error: PARSE_MESSAGES.noHeader });
  });
});
