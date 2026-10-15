import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import { detectColumns } from "@/lib/import/columns";
import { IMPORT_KINDS, KIND_SLUG, kindFromSlug, templateUrl } from "@/lib/import/kinds";
import { parseImportFile } from "@/lib/import/parse-file";
import { buildStagedRows } from "@/lib/import/stage";
import { buildTemplate, READ_ME, templateHeaders } from "@/lib/import/templates";

const DOCUMENTED: Record<string, string[]> = {
  units_owners: ["Unit", "Owner name", "Email", "Phone", "Mailing address", "Ownership %", "Dues amount"],
  transactions: ["Date", "Description", "Amount", "Payee", "Category", "Fund", "Unit"],
  opening_accounts: ["Account", "Fund", "Debit", "Credit"],
  opening_units: ["Unit", "Amount owed"],
  contractors: ["Name", "Trade", "Contact name", "Email", "Phone", "Website", "Notes"],
};

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

describe("templates", () => {
  it("have the documented headers in order", () => {
    for (const kind of IMPORT_KINDS) expect(templateHeaders(kind)).toEqual(DOCUMENTED[kind]);
  });

  it("CSV starts with a BOM, uses CRLF, and no cell begins with a formula character (plain numbers aside)", async () => {
    for (const kind of IMPORT_KINDS) {
      const t = await buildTemplate(kind, "csv");
      expect(t.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
      const text = new TextDecoder().decode(t.bytes).replace(/^﻿/, "");
      expect(text).toContain("\r\n");
      expect(text.split("\r\n")[0]).toBe(DOCUMENTED[kind].map((h) => (/[",]/.test(h) ? `"${h}"` : h)).join(","));
      const parsed = await parseImportFile(t.bytes, t.filename, { kindHint: kind });
      expect(parsed.ok, kind).toBe(true);
      if (!parsed.ok) continue;
      for (const cell of [...parsed.file.headers, ...parsed.file.rows.flat()]) {
        if (cell && !PLAIN_NUMBER.test(cell)) expect(cell[0], `${kind}: ${cell}`).not.toMatch(/[=+\-@\t\r]/);
      }
    }
  });

  it("example rows parse back through the parser and the stager with no errors, in both formats", async () => {
    for (const kind of IMPORT_KINDS) {
      for (const format of ["csv", "xlsx"] as const) {
        const t = await buildTemplate(kind, format, { fundNames: ["Operating", "Reserve"], unitLabels: ["Unit 1", "Unit 2"], accountLabels: ["Operating Cash"] });
        const parsed = await parseImportFile(t.bytes, t.filename, { kindHint: kind });
        expect(parsed.ok, `${kind} ${format}`).toBe(true);
        if (!parsed.ok) continue;
        expect(parsed.file.headers).toEqual(DOCUMENTED[kind]);
        expect(parsed.file.rowCount).toBeGreaterThanOrEqual(2);
        const d = detectColumns(kind, parsed.file.headers, parsed.file.rows);
        // Every header is recognised and nothing is left over.
        expect(d.unmapped, `${kind} ${format}`).toEqual([]);
        const { rows } = buildStagedRows({ kind, file: parsed.file, mapping: d.mapping, dateHint: "auto" });
        expect(rows.length).toBe(parsed.file.rowCount);
        for (const r of rows) expect(r.errors, `${kind} ${format} row ${r.row_number}`).toEqual([]);
      }
    }
  });

  it("the transactions template gives real dates and signed amounts", async () => {
    const t = await buildTemplate("transactions", "xlsx");
    const parsed = await parseImportFile(t.bytes, t.filename, { kindHint: "transactions" });
    if (!parsed.ok) throw new Error(parsed.error);
    const d = detectColumns("transactions", parsed.file.headers, parsed.file.rows);
    const { rows } = buildStagedRows({ kind: "transactions", file: parsed.file, mapping: d.mapping, dateHint: "mdy" });
    expect(rows[0].mapped).toMatchObject({ date: "2025-03-14", amount: "-450.00", category_key: "Repairs" });
    expect(rows[1].mapped).toMatchObject({ amount: "350.00", unit_label: "Unit 2" });
    expect(rows[2].mapped.amount).toBe("3.10");
  });

  it("XLSX has a Read me sheet first with wrapped text, a frozen bold header, grey italic examples and a note on A1", async () => {
    const t = await buildTemplate("units_owners", "xlsx", { unitLabels: ["Unit 1"] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes.buffer.slice(t.bytes.byteOffset, t.bytes.byteOffset + t.bytes.byteLength) as ArrayBuffer);
    expect(wb.worksheets[0].name).toBe("Read me");
    expect(wb.worksheets[0].getColumn(1).width).toBe(90);
    expect(String(wb.worksheets[0].getCell("A1").value)).toBe(READ_ME.units_owners[0]);
    const data = wb.getWorksheet("Data")!;
    expect(data.getCell("A1").font?.bold).toBe(true);
    expect(data.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(data.getCell("A2").font).toMatchObject({ italic: true });
    expect(JSON.stringify(data.getCell("A1").note)).toContain("Delete the example rows before you upload");
  });

  it("opening balance workbooks carry both sheets and the parser picks by kind", async () => {
    for (const kind of ["opening_accounts", "opening_units"] as const) {
      const t = await buildTemplate(kind, "xlsx");
      const accounts = await parseImportFile(t.bytes, t.filename, { kindHint: "opening_accounts" });
      const units = await parseImportFile(t.bytes, t.filename, { kindHint: "opening_units" });
      expect(accounts.ok && accounts.file.sheetName).toBe("Account balances");
      expect(units.ok && units.file.sheetName).toBe("Unit balances");
    }
  });

  it("adds dropdowns from this building's own funds, units and accounts, and none without names", async () => {
    const load = async (b: Uint8Array) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
      return wb;
    };
    const withNames = await load((await buildTemplate("transactions", "xlsx", { fundNames: ["Operating", "Reserve"], unitLabels: ["Unit 1", "Unit 2"] })).bytes);
    const ws = withNames.getWorksheet("Data")!;
    expect(ws.getCell("F2").dataValidation).toMatchObject({ type: "list", formulae: ["Lists!$A$1:$A$2"] });
    expect(ws.getCell("G40").dataValidation).toMatchObject({ type: "list", formulae: ["Lists!$B$1:$B$2"] });
    expect(withNames.getWorksheet("Lists")?.state).toBe("hidden");
    expect(String(withNames.getWorksheet("Lists")!.getCell("A2").value)).toBe("Reserve");
    const accounts = await load((await buildTemplate("opening_accounts", "xlsx", { fundNames: ["Operating"], accountLabels: ["Operating Cash", "Accounts Payable"] })).bytes);
    expect(accounts.getWorksheet("Account balances")!.getCell("A3").dataValidation).toMatchObject({ type: "list", formulae: ["Lists!$C$1:$C$2"] });
    const without = await load((await buildTemplate("transactions", "xlsx")).bytes);
    expect(without.getWorksheet("Data")!.getCell("F2").dataValidation?.type).toBeUndefined();
  });

  it("hostile building names cannot become formulas in the lists", async () => {
    const t = await buildTemplate("transactions", "xlsx", { fundNames: ["=1+1"], unitLabels: ["+SUM(A1)"] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.bytes.buffer.slice(t.bytes.byteOffset, t.bytes.byteOffset + t.bytes.byteLength) as ArrayBuffer);
    expect(wb.getWorksheet("Lists")!.getCell("A1").value).toBe("'=1+1");
    expect(wb.getWorksheet("Lists")!.getCell("B1").value).toBe("'+SUM(A1)");
  });

  it("names files and routes", async () => {
    expect((await buildTemplate("units_owners", "csv")).filename).toBe("walkup-units-and-owners.csv");
    expect((await buildTemplate("transactions", "xlsx")).filename).toBe("walkup-past-transactions.xlsx");
    expect((await buildTemplate("transactions", "xlsx")).contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    for (const kind of IMPORT_KINDS) expect(kindFromSlug(KIND_SLUG[kind])).toBe(kind);
    expect(kindFromSlug("nope")).toBeNull();
    expect(templateUrl("opening_units", "csv")).toBe("/building/import/template/opening-units?format=csv");
  });
});
