import ExcelJS from "exceljs";

/** Workbooks and CSVs for the import tests, generated in memory (no binary fixtures are committed). */

export type SheetSpec = {
  name: string;
  rows: (ExcelJS.CellValue | { v: ExcelJS.CellValue; hidden?: boolean })[][];
  merge?: string;
  hiddenRows?: number[]; // 1-based
};

export async function workbook(sheets: SheetSpec[]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((row, r) => {
      row.forEach((v, c) => {
        if (v === undefined) return;
        ws.getCell(r + 1, c + 1).value = v as ExcelJS.CellValue;
      });
    });
    if (s.merge) ws.mergeCells(s.merge);
    for (const h of s.hiddenRows ?? []) ws.getRow(h).hidden = true;
  }
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

export const UNITS_HEADERS = ["Unit", "Owner name", "Email", "Phone", "Ownership %", "Dues amount"];

/** A tiny CSV of units with a Social Security column that must never be read. */
export function unitsCsvWithSsn(): string {
  return [
    "Unit,Owner name,Email,SSN,Phone,Bank account number",
    "Unit 1,Ada Okonkwo,ada@example.com,123-45-6789,312-555-0142,000123456789",
    "Unit 2,Bo Lindqvist,bo@example.com,987-65-4321,312-555-0143,000987654321",
  ].join("\r\n");
}
