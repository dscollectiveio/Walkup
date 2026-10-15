import "server-only";
import ExcelJS from "exceljs";
import { cellText } from "./cell-text";
import type { ImportKind } from "./kinds";

/**
 * Reading an .xlsx (import-spec 4.2). exceljs only loads and reads values;
 * nothing is ever evaluated, and a formula contributes its saved result, not
 * its text. Server-only.
 */

export interface SheetCell {
  text: string;
  /** Set when the cell could not give a value (a formula with no saved result, an error cell). */
  formulaProblem?: boolean;
}

export interface RawSheet {
  name: string;
  /** Non-empty rows only, each as a sparse-free array of cells starting at column A. */
  rows: SheetCell[][];
  hiddenRows: number;
  emptyRowsSkipped: number;
  /** True when the sheet had more rows than the reader would take. */
  truncated: boolean;
}

const SHEET_NAMES: Record<ImportKind, string[]> = {
  units_owners: ["data", "units and owners", "units"],
  transactions: ["data", "transactions", "past transactions"],
  opening_accounts: ["account balances", "data", "accounts"],
  opening_units: ["unit balances", "data", "units"],
  contractors: ["data", "contractors"],
};

/** Rows read from a sheet before it is declared too long (the caller reports the real count). */
export const SHEET_ROW_LIMIT = 5_200;

function numberText(n: number): string {
  if (!Number.isFinite(n)) return "";
  // Strip float noise (0.1 + 0.2) without rounding anything a person could have typed.
  return String(Number(n.toPrecision(15)));
}

function valueToCell(value: ExcelJS.CellValue): SheetCell {
  if (value === null || value === undefined) return { text: "" };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { text: "" } : { text: value.toISOString().slice(0, 10) };
  }
  switch (typeof value) {
    case "string":
      return { text: cellText(value) };
    case "number":
      return { text: numberText(value) };
    case "boolean":
      return { text: value ? "TRUE" : "FALSE" };
    default:
      break;
  }
  const v = value as unknown as Record<string, unknown>;
  if ("error" in v) return { text: "", formulaProblem: true };
  if ("formula" in v || "sharedFormula" in v) {
    const result = v.result;
    if (result === undefined || result === null) return { text: "", formulaProblem: true };
    if (typeof result === "object" && !(result instanceof Date)) return { text: "", formulaProblem: true };
    return valueToCell(result as ExcelJS.CellValue);
  }
  if ("richText" in v && Array.isArray(v.richText)) {
    return { text: cellText((v.richText as { text?: string }[]).map((p) => p.text ?? "").join("")) };
  }
  if ("text" in v) {
    const t = v.text;
    if (typeof t === "string") return { text: cellText(t) };
    if (t && typeof t === "object" && "richText" in (t as object)) return valueToCell(t as ExcelJS.CellValue);
    return { text: "" };
  }
  return { text: "" };
}

function nonEmpty(row: SheetCell[]): boolean {
  return row.some((c) => c.text !== "" || c.formulaProblem);
}

function readSheet(ws: ExcelJS.Worksheet): RawSheet {
  const rows: SheetCell[][] = [];
  let hiddenRows = 0;
  let empty = 0;
  let truncated = false;
  let lastRowNumber = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (truncated) return;
    if (rows.length >= SHEET_ROW_LIMIT) {
      truncated = true;
      return;
    }
    if (rowNumber > lastRowNumber + 1 && lastRowNumber > 0) empty += rowNumber - lastRowNumber - 1;
    lastRowNumber = rowNumber;
    const cells: SheetCell[] = [];
    const width = Math.min(row.cellCount, 400);
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      // A merged cell is read as its master only.
      if (cell.type === ExcelJS.ValueType.Merge && cell.master && cell.master.address !== cell.address) {
        cells.push({ text: "" });
        continue;
      }
      cells.push(valueToCell(cell.value));
    }
    if (row.hidden) hiddenRows += 1;
    if (nonEmpty(cells)) rows.push(cells);
    else empty += 1;
  });
  return { name: ws.name, rows, hiddenRows, emptyRowsSkipped: empty, truncated };
}

/** Pick the sheet that holds the data: by name, then the first with at least two non-empty rows. */
export async function readWorkbook(bytes: Uint8Array, kind: ImportKind | undefined): Promise<RawSheet | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheets = wb.worksheets;
  if (sheets.length === 0) return null;

  const wanted = kind ? SHEET_NAMES[kind] : ["data", "transactions"];
  for (const name of wanted) {
    const ws = sheets.find((s) => s.name.trim().toLowerCase() === name);
    if (ws) {
      const sheet = readSheet(ws);
      if (sheet.rows.length >= 1) return sheet;
    }
  }
  for (const ws of sheets) {
    if (/^read ?me$/i.test(ws.name.trim())) continue;
    const sheet = readSheet(ws);
    if (sheet.rows.length >= 2) return sheet;
  }
  // Nothing has two rows: hand back the first non-empty one so the caller can say "no data".
  for (const ws of sheets) {
    const sheet = readSheet(ws);
    if (sheet.rows.length >= 1) return sheet;
  }
  return readSheet(sheets[0]);
}
