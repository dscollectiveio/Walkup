import type ExcelJS from "exceljs";

/** Walkup's look, as Excel ARGB colours. Matches the app: navy bars, cream bands, a gold accent. */
export const BRAND = {
  navy: "FF1F2B45",
  navyLight: "FFB9C1D6",
  cream: "FFF3EEE3",
  creamDark: "FFE7DFCC",
  tint: "FFFAF8F3",
  gold: "FFC9A24D",
  line: "FFE4DDCC",
  lineStrong: "FFB9B09A",
  muted: "FF5B6272",
  good: "FF2F6B4F",
  bad: "FF8A2A1F",
  goodTint: "FFE8F1EA",
  badTint: "FFF6E6E3",
  white: "FFFFFFFF",
} as const;

export const MONEY = '"$"#,##0.00;[Red]-"$"#,##0.00';
export const FONT = "Calibri";

const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const hair = (argb: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb } });

/** A sheet with gridlines off, a tinted tab, and print settings that fit the page width. */
export function brandedSheet(
  wb: ExcelJS.Workbook,
  name: string,
  opts: { landscape?: boolean; tab?: string; freezeRow?: number } = {},
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name.slice(0, 31), {
    properties: { tabColor: { argb: opts.tab ?? BRAND.navy } },
    views: [{ showGridLines: false, ...(opts.freezeRow ? { state: "frozen" as const, ySplit: opts.freezeRow } : {}) }],
    pageSetup: {
      orientation: opts.landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.7, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: "&L&8Prepared with Walkup&R&8Page &P of &N" },
  });
  return ws;
}

/** Fills a whole row, edge to edge, so bands and bars read as bars. */
function paint(row: ExcelJS.Row, lastCol: number, argb: string) {
  for (let c = 1; c <= lastCol; c++) row.getCell(c).fill = solid(argb);
}

/** The top of every sheet: a navy bar with the association and what this is, then a thin gold rule. Returns the next free row. */
export function banner(ws: ExcelJS.Worksheet, lastCol: number, title: string, subtitle: string, note?: string): number {
  const r1 = ws.getRow(1);
  r1.height = 32;
  paint(r1, lastCol, BRAND.navy);
  ws.mergeCells(1, 1, 1, lastCol);
  r1.getCell(1).value = title;
  r1.getCell(1).font = { name: FONT, bold: true, size: 16, color: { argb: BRAND.white } };
  r1.getCell(1).alignment = { vertical: "middle", indent: 1 };

  const r2 = ws.getRow(2);
  r2.height = 22;
  paint(r2, lastCol, BRAND.navy);
  ws.mergeCells(2, 1, 2, lastCol);
  r2.getCell(1).value = subtitle;
  r2.getCell(1).font = { name: FONT, size: 11, color: { argb: BRAND.navyLight } };
  r2.getCell(1).alignment = { vertical: "top", indent: 1 };

  const r3 = ws.getRow(3);
  r3.height = 4;
  paint(r3, lastCol, BRAND.gold);

  const r4 = ws.getRow(4);
  r4.height = note ? 20 : 10;
  if (note) {
    ws.mergeCells(4, 1, 4, lastCol);
    r4.getCell(1).value = note;
    r4.getCell(1).font = { name: FONT, italic: true, size: 9, color: { argb: BRAND.muted } };
    r4.getCell(1).alignment = { vertical: "middle", indent: 1 };
  }
  return 5;
}

/** Column headings: dark cream, bold navy, numbers right-aligned. `numFrom` is the first numeric column. */
export function headerRow(row: ExcelJS.Row, lastCol: number, numFrom: number, align: Record<number, "left" | "right" | "center"> = {}) {
  row.height = 24;
  paint(row, lastCol, BRAND.creamDark);
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: BRAND.navy } };
    cell.alignment = {
      vertical: "middle",
      horizontal: align[c] ?? (c >= numFrom ? "right" : "left"),
      indent: c === 1 ? 1 : 0,
      wrapText: true,
    };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.lineStrong } }, ...(c > 1 ? { left: hair(BRAND.line) } : {}) };
  }
}

/** A section heading ("INCOME") across the full width. */
export function sectionBand(ws: ExcelJS.Worksheet, lastCol: number, label: string): ExcelJS.Row {
  const row = ws.addRow([label.toUpperCase()]);
  row.height = 22;
  paint(row, lastCol, BRAND.cream);
  row.getCell(1).font = { name: FONT, bold: true, size: 9, color: { argb: BRAND.muted } };
  row.getCell(1).alignment = { vertical: "middle", indent: 1 };
  return row;
}

/** An ordinary line: hairline rule under it, faint dividers between number columns, the last column lightly tinted when asked. */
export function lineRow(row: ExcelJS.Row, lastCol: number, numFrom: number, opts: { tintLast?: boolean; money?: number[] } = {}) {
  row.height = 20;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { name: FONT, size: 10.5, color: { argb: BRAND.navy } };
    cell.alignment = { vertical: "middle", horizontal: c >= numFrom ? "right" : "left", indent: c === 1 ? 2 : 0 };
    cell.border = { bottom: hair(BRAND.line), ...(c >= numFrom ? { left: hair(BRAND.line) } : {}) };
    if (opts.tintLast && c === lastCol) cell.fill = solid(BRAND.tint);
    if (c >= numFrom && (!opts.money || opts.money.includes(c))) cell.numFmt = MONEY;
  }
}

/** A total: tinted, bold, with a heavier rule on top so it reads as the end of its section. */
export function totalRow(row: ExcelJS.Row, lastCol: number, numFrom: number, opts: { money?: number[] } = {}) {
  row.height = 22;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.fill = solid(c === lastCol ? BRAND.creamDark : BRAND.tint);
    cell.font = { name: FONT, bold: true, size: 10.5, color: { argb: BRAND.navy } };
    cell.alignment = { vertical: "middle", horizontal: c >= numFrom ? "right" : "left", indent: c === 1 ? 2 : 0 };
    cell.border = {
      top: { style: "medium", color: { argb: BRAND.lineStrong } },
      bottom: hair(BRAND.line),
      ...(c >= numFrom ? { left: hair(BRAND.line) } : {}),
    };
    if (c >= numFrom && (!opts.money || opts.money.includes(c))) cell.numFmt = MONEY;
  }
}

/** The bottom line: Excess in green, Deficit in brick, under a navy rule. The label cell says which. */
export function bottomRow(row: ExcelJS.Row, lastCol: number, numFrom: number, tones: ("good" | "bad" | "plain")[]) {
  row.height = 28;
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    const tone = c >= numFrom ? (tones[c - numFrom] ?? "plain") : "plain";
    const color = tone === "good" ? BRAND.good : tone === "bad" ? BRAND.bad : BRAND.navy;
    cell.font = { name: FONT, bold: true, size: 12, color: { argb: color } };
    cell.alignment = { vertical: "middle", horizontal: c >= numFrom ? "right" : "left", indent: c === 1 ? 1 : 0 };
    cell.border = { top: { style: "medium", color: { argb: BRAND.navy } }, bottom: { style: "medium", color: { argb: BRAND.navy } }, ...(c >= numFrom ? { left: hair(BRAND.line) } : {}) };
    if (c >= numFrom) cell.numFmt = MONEY;
    if (c === lastCol) cell.fill = solid(tone === "bad" ? BRAND.badTint : tone === "good" ? BRAND.goodTint : BRAND.cream);
  }
}

/** A quiet closing line under the table. */
export function footnote(ws: ExcelJS.Worksheet, lastCol: number, text: string) {
  ws.addRow([]).height = 10;
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, lastCol);
  row.getCell(1).font = { name: FONT, italic: true, size: 9, color: { argb: BRAND.muted } };
  row.getCell(1).alignment = { indent: 1 };
}

export const preparedNote = () =>
  `Prepared with Walkup from posted bank transactions on ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`;
