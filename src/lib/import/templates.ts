import "server-only";
import ExcelJS from "exceljs";
import { csvLine, toXlsxCell } from "./safe-cell";
import type { ImportKind } from "./kinds";

/**
 * The downloadable templates (import-spec 4.1). Server-only.
 *
 * Contents are static text and a few example rows, so nothing a person typed
 * is ever written, but every cell still passes safeCell. XLSX carries a Read
 * me sheet and a Data sheet (opening balances carry both of their sheets) with
 * dropdowns taken from this association's own funds, units and accounts.
 */

export interface TemplateContext {
  fundNames?: string[];
  unitLabels?: string[];
  accountLabels?: string[];
}

export type TemplateFormat = "csv" | "xlsx";

export interface Template {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

type Cell = string | number;

interface Sheet {
  name: string;
  headers: string[];
  examples: Cell[][];
  /** Columns (by header) with a dropdown, and which list feeds it. */
  lists: Record<string, "funds" | "units" | "accounts">;
  moneyColumns: string[];
  dateColumns: string[];
  widths: number[];
  readMe: string[];
}

const HEADERS: Record<ImportKind, string[]> = {
  units_owners: ["Unit", "Owner name", "Email", "Phone", "Mailing address", "Ownership %", "Dues amount"],
  transactions: ["Date", "Description", "Amount", "Payee", "Category", "Fund", "Unit"],
  opening_accounts: ["Account", "Fund", "Debit", "Credit"],
  opening_units: ["Unit", "Amount owed"],
  contractors: ["Name", "Trade", "Contact name", "Email", "Phone", "Website", "Notes"],
};

export const READ_ME: Record<ImportKind, string[]> = {
  units_owners: [
    "One row per owner. A unit with two owners has two rows with the same Unit. Ownership % must add up to 100 across all your units, or be left empty for all of them. Dues amount sets the unit's dues plan; nothing is charged until you charge it on the HOA Dues page.",
  ],
  transactions: [
    "One row per bank transaction. Do not include transfers between your own accounts. Do not include anything on or before the date of your opening balance. You will choose which of your accounts each category belongs to; Walkup will not guess.",
    "Amount: money in is positive, money out is negative. A file with separate Deposits and Withdrawals columns works too: match those instead.",
  ],
  opening_accounts: [
    "As of one date, list what the association had and owed. Total debits must equal total credits; the Fund balance lines make up the difference. Do not list Assessments Receivable here: put what each unit owed on the Unit balances sheet.",
  ],
  opening_units: [
    "List what each unit owed on the opening date. Leave out units that owed nothing. Credits (an owner who overpaid) are not imported here.",
  ],
  contractors: [
    "One row per contractor. Do not put tax ID numbers (SSN or EIN) in this file. Walkup keeps only the last four digits, taken from the W-9 you file with the contractor.",
  ],
};

const SHEETS: Record<ImportKind, Sheet> = {
  units_owners: {
    name: "Data",
    headers: HEADERS.units_owners,
    examples: [
      ["Unit 1", "Ada Okonkwo", "ada@example.com", "312-555-0142", "", 33.333333, 350],
      ["Unit 2", "Bo Lindqvist", "bo@example.com", "312-555-0143", "PO Box 12, Chicago IL 60647", 33.333333, 350],
      ["Unit 3", "Cy Ferreira", "cy@example.com", "", "", 33.333334, 350],
    ],
    lists: {},
    moneyColumns: ["Dues amount"],
    dateColumns: [],
    widths: [14, 24, 28, 18, 32, 14, 14],
    readMe: READ_ME.units_owners,
  },
  transactions: {
    name: "Data",
    headers: HEADERS.transactions,
    examples: [
      ["2025-03-14", "Boiler repair, Acme Plumbing", -450, "Acme Plumbing", "Repairs", "Operating", ""],
      ["2025-03-05", "March dues, Unit 2", 350, "", "Regular Assessments", "Operating", "Unit 2"],
      ["2025-03-31", "Bank interest", 3.1, "", "Interest", "Reserve", ""],
    ],
    lists: { Fund: "funds", Unit: "units" },
    moneyColumns: ["Amount"],
    dateColumns: ["Date"],
    widths: [14, 36, 14, 24, 24, 14, 12],
    readMe: READ_ME.transactions,
  },
  opening_accounts: {
    name: "Account balances",
    headers: HEADERS.opening_accounts,
    examples: [
      ["1000", "Operating", 18400, ""],
      ["1010", "Reserve", 52000, ""],
      ["2000", "Operating", "", 1200],
      ["3000", "Operating", "", 17200],
      ["3100", "Reserve", "", 52000],
    ],
    lists: { Account: "accounts", Fund: "funds" },
    moneyColumns: ["Debit", "Credit"],
    dateColumns: [],
    widths: [30, 14, 16, 16],
    readMe: READ_ME.opening_accounts,
  },
  opening_units: {
    name: "Unit balances",
    headers: HEADERS.opening_units,
    examples: [
      ["Unit 2", 750],
      ["Unit 5", 150],
    ],
    lists: { Unit: "units" },
    moneyColumns: ["Amount owed"],
    dateColumns: [],
    widths: [16, 16],
    readMe: READ_ME.opening_units,
  },
  contractors: {
    name: "Data",
    headers: HEADERS.contractors,
    examples: [
      ["Acme Plumbing", "Plumbing", "Sam Rivera", "sam@acme.example", "773-555-0100", "acme.example", "Did the boiler in 2024"],
      ["Bright Electric", "Electrical", "", "office@bright.example", "", "", ""],
    ],
    lists: {},
    moneyColumns: [],
    dateColumns: [],
    widths: [26, 16, 20, 28, 18, 22, 36],
    readMe: READ_ME.contractors,
  },
};

const FILENAME: Record<ImportKind, string> = {
  units_owners: "walkup-units-and-owners",
  transactions: "walkup-past-transactions",
  opening_accounts: "walkup-opening-balances-accounts",
  opening_units: "walkup-opening-balances-units",
  contractors: "walkup-contractors",
};

/** The headers a kind's template starts with, in order (also what a test checks). */
export function templateHeaders(kind: ImportKind): string[] {
  return [...HEADERS[kind]];
}

function csvBytes(sheet: Sheet): Uint8Array {
  const text = (v: Cell, header: string): string | number =>
    typeof v === "number" ? (sheet.moneyColumns.includes(header) ? v.toFixed(2) : String(v)) : v;
  const lines = [
    csvLine(sheet.headers),
    ...sheet.examples.map((row) => csvLine(row.map((v, c) => text(v, sheet.headers[c])))),
  ];
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

async function xlsxBytes(kind: ImportKind, ctx: TemplateContext): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Walkup";
  const sheets: Sheet[] = kind === "opening_accounts" || kind === "opening_units"
    ? [SHEETS.opening_accounts, SHEETS.opening_units]
    : [SHEETS[kind]];

  const readMe = wb.addWorksheet("Read me");
  readMe.getColumn(1).width = 90;
  const readMeLines = [
    ...sheets.flatMap((s, i) => (kind === "opening_accounts" || kind === "opening_units" ? [`${s.name}`, ...s.readMe, ...(i === 0 ? [""] : [])] : s.readMe)),
    "",
    "Delete the grey example rows before you upload.",
  ];
  readMeLines.forEach((line, i) => {
    const cell = readMe.getCell(i + 1, 1);
    cell.value = toXlsxCell(line);
    cell.alignment = { wrapText: true, vertical: "top" };
  });

  // Lists the dropdowns point at, on a hidden sheet.
  const lists = wb.addWorksheet("Lists", { state: "hidden" });
  const listData: Record<"funds" | "units" | "accounts", string[]> = {
    funds: ctx.fundNames ?? [],
    units: ctx.unitLabels ?? [],
    accounts: ctx.accountLabels ?? [],
  };
  const listColumn = { funds: 1, units: 2, accounts: 3 } as const;
  (Object.keys(listData) as (keyof typeof listData)[]).forEach((key) => {
    listData[key].forEach((v, i) => {
      lists.getCell(i + 1, listColumn[key]).value = toXlsxCell(v);
    });
  });
  const colLetter = (n: number) => String.fromCharCode(64 + n);

  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.headers.forEach((h, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.value = toXlsxCell(h);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A44" } };
      ws.getColumn(i + 1).width = s.widths[i] ?? 18;
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.getCell("A1").note = "Delete the example rows before you upload";
    s.examples.forEach((row, r) => {
      row.forEach((v, c) => {
        const cell = ws.getCell(r + 2, c + 1);
        const header = s.headers[c];
        if (s.dateColumns.includes(header) && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
          const [y, m, d] = v.split("-").map(Number);
          cell.value = new Date(Date.UTC(y, m - 1, d));
          cell.numFmt = "yyyy-mm-dd";
        } else if (typeof v === "number") {
          cell.value = v;
        } else {
          cell.value = toXlsxCell(v);
        }
        if (s.moneyColumns.includes(header)) cell.numFmt = "#,##0.00";
        cell.font = { italic: true, color: { argb: "FF808080" } };
      });
    });
    // Date and money columns keep their formats for the rows people add.
    s.headers.forEach((h, c) => {
      const col = ws.getColumn(c + 1);
      if (s.dateColumns.includes(h)) col.numFmt = "yyyy-mm-dd";
      if (s.moneyColumns.includes(h)) col.numFmt = "#,##0.00";
    });
    for (const [header, listKey] of Object.entries(s.lists)) {
      const values = listData[listKey];
      if (values.length === 0) continue;
      const c = s.headers.indexOf(header);
      if (c < 0) continue;
      const range = `Lists!$${colLetter(listColumn[listKey])}$1:$${colLetter(listColumn[listKey])}$${values.length}`;
      for (let r = 2; r <= 501; r++) {
        ws.getCell(r, c + 1).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [range],
          showErrorMessage: false,
        };
      }
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function buildTemplate(kind: ImportKind, format: TemplateFormat, ctx: TemplateContext = {}): Promise<Template> {
  if (format === "csv") {
    return {
      filename: `${FILENAME[kind]}.csv`,
      contentType: "text/csv; charset=utf-8",
      bytes: csvBytes(SHEETS[kind]),
    };
  }
  return {
    filename: `${FILENAME[kind]}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: await xlsxBytes(kind, ctx),
  };
}
