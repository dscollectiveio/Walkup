import "server-only";
import { createHash } from "node:crypto";
import { cellText, LONG_CELL_KEPT_CHARS, tooLong } from "./cell-text";
import { decodeCsvBytes, parseCsv } from "./csv";
import { IMPORT_LIMITS } from "./limits";
import type { ImportKind } from "./kinds";
import type { ParseIssue, ParseResult } from "./types";
import { readWorkbook } from "./xlsx";
import { zipLooksSafe, zipStats } from "./zip-stats";

/**
 * Sniff, cap and read an uploaded .csv or .xlsx into plain text rows
 * (import-spec 4.2). Server-only. The messages below are the spec's, word for
 * word.
 */

export const PARSE_MESSAGES = {
  tooBig: "That file is larger than 5 MB. Split it, or remove columns you don't need.",
  wrongType:
    "Upload a .csv or .xlsx file. Older .xls and macro files (.xlsm) are not supported: open the file and Save As .xlsx or .csv.",
  notSpreadsheet: "That doesn't look like a spreadsheet. Try saving it again as .xlsx or .csv.",
  zipLarge: "That spreadsheet is unusually large inside. Save a plain copy and try again.",
  noHeader: "We couldn't find a header row and data. The first row should be the column names.",
  tooManyRows: (n: number | null) =>
    `That file has ${n === null ? "more than 5,000" : n.toLocaleString("en-US")} rows. Walkup imports up to 5,000 at a time. Split it by year.`,
  tooManyColumns: (n: number) => `That file has ${n} columns. Remove the ones you don't need and try again.`,
  cellLong: "A cell is too long to be a normal entry.",
  formula:
    "This cell is a formula with no saved value. Open the file, copy and paste values, and save it again.",
  ragged: "A row has more cells than the header: extra cells were ignored.",
} as const;

export function fileExtension(filename: string): "csv" | "xlsx" | null {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  const ext = m?.[1].toLowerCase();
  return ext === "csv" || ext === "xlsx" ? ext : null;
}

function columnLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function parseImportFile(
  bytes: Uint8Array,
  filename: string,
  opts: { kindHint?: ImportKind } = {},
): Promise<ParseResult> {
  if (bytes.length > IMPORT_LIMITS.maxBytes) return { ok: false, error: PARSE_MESSAGES.tooBig };
  const ext = fileExtension(filename);
  if (!ext) return { ok: false, error: PARSE_MESSAGES.wrongType };
  if (bytes.length === 0) return { ok: false, error: PARSE_MESSAGES.noHeader };

  const warnings: string[] = [];
  const issues: ParseIssue[] = [];
  let headerRaw: string[];
  let dataRaw: { text: string; formulaProblem?: boolean }[][];
  let sheetName: string | null = null;

  if (ext === "xlsx") {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { ok: false, error: PARSE_MESSAGES.notSpreadsheet };
    const stats = zipStats(bytes);
    if (!stats.ok) return { ok: false, error: PARSE_MESSAGES.notSpreadsheet };
    if (!zipLooksSafe(stats)) return { ok: false, error: PARSE_MESSAGES.zipLarge };
    let sheet;
    try {
      sheet = await readWorkbook(bytes, opts.kindHint);
    } catch {
      return { ok: false, error: PARSE_MESSAGES.notSpreadsheet };
    }
    if (!sheet || sheet.rows.length < 2) return { ok: false, error: PARSE_MESSAGES.noHeader };
    sheetName = sheet.name;
    const [head, ...rest] = sheet.rows;
    headerRaw = head.map((c) => c.text);
    dataRaw = rest;
    if (sheet.hiddenRows > 0) {
      warnings.push(`${sheet.hiddenRows} hidden ${sheet.hiddenRows === 1 ? "row was" : "rows were"} read like any other.`);
    }
    if (sheet.emptyRowsSkipped > 0) {
      warnings.push(`${sheet.emptyRowsSkipped} empty ${sheet.emptyRowsSkipped === 1 ? "row was" : "rows were"} skipped.`);
    }
    if (sheet.truncated) return { ok: false, error: PARSE_MESSAGES.tooManyRows(null) };
  } else {
    // A NUL byte means binary, except in UTF-16 text, which announces itself with a byte order mark.
    const utf16 = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
    if (!utf16 && bytes.includes(0)) return { ok: false, error: PARSE_MESSAGES.notSpreadsheet };
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { ok: false, error: PARSE_MESSAGES.notSpreadsheet };
    const decoded = decodeCsvBytes(bytes);
    warnings.push(...decoded.warnings);
    const table = parseCsv(decoded.text);
    if (table.length < 2) return { ok: false, error: PARSE_MESSAGES.noHeader };
    headerRaw = table[0];
    dataRaw = table.slice(1).map((r) => r.map((t) => ({ text: t })));
  }

  // Header: trim trailing empty header cells, name blanks.
  let width = headerRaw.length;
  while (width > 0 && cellText(headerRaw[width - 1]) === "") width -= 1;
  if (width === 0) return { ok: false, error: PARSE_MESSAGES.noHeader };
  if (width > IMPORT_LIMITS.maxColumns) return { ok: false, error: PARSE_MESSAGES.tooManyColumns(width) };
  if (dataRaw.length === 0) return { ok: false, error: PARSE_MESSAGES.noHeader };
  if (dataRaw.length > IMPORT_LIMITS.maxRows) return { ok: false, error: PARSE_MESSAGES.tooManyRows(dataRaw.length) };

  const headers = Array.from({ length: width }, (_, i) => {
    const h = cellText(headerRaw[i] ?? "").slice(0, 120);
    return h === "" ? `(column ${columnLetter(i)})` : h;
  });

  let raggedSeen = false;
  const rows: string[][] = dataRaw.map((cells, r) => {
    const out: string[] = [];
    for (let c = 0; c < width; c++) {
      const cell = cells[c];
      if (!cell) {
        out.push("");
        continue;
      }
      if (cell.formulaProblem) {
        issues.push({ row: r, col: c, code: "parse_formula", message: PARSE_MESSAGES.formula });
        out.push("");
        continue;
      }
      if (tooLong(cell.text)) {
        issues.push({ row: r, col: c, code: "parse_cell_long", message: PARSE_MESSAGES.cellLong });
        out.push(cellText(cell.text.slice(0, LONG_CELL_KEPT_CHARS)));
        continue;
      }
      out.push(ext === "xlsx" ? cell.text : cellText(cell.text));
    }
    if (cells.length > width && cells.slice(width).some((c) => c.text.trim() !== "")) raggedSeen = true;
    return out;
  });
  if (raggedSeen) warnings.push(PARSE_MESSAGES.ragged);

  warnings.unshift(`Read ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "row" : "rows"}.`);

  return {
    ok: true,
    file: {
      kind: ext,
      sheetName,
      headers,
      rows,
      rowCount: rows.length,
      sha256: sha256Hex(bytes),
      warnings,
      issues,
    },
  };
}
