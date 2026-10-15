/** Shapes shared by the parser, the stager and the pages. Pure types, safe for the browser. */

export interface ParseIssue {
  /** 0-based position among the data rows (the header is not counted). */
  row: number;
  /** 0-based column. */
  col: number;
  code: "parse_cell_long" | "parse_formula";
  message: string;
}

export interface ParsedFile {
  kind: "csv" | "xlsx";
  sheetName: string | null;
  /** As typed, trimmed; a blank header is named "(column C)". */
  headers: string[];
  /** Every data row as normalised text, padded to the header's width. At most 5,000. */
  rows: string[][];
  rowCount: number;
  sha256: string;
  warnings: string[];
  issues: ParseIssue[];
}

export type ParseResult = { ok: true; file: ParsedFile } | { ok: false; error: string };

export interface RowError {
  field: string;
  code: string;
  message: string;
}

export interface StagedRow {
  /** 1-based position among the file's data rows (the header is not counted). */
  row_number: number;
  raw: Record<string, string>;
  mapped: Record<string, string>;
  errors: RowError[];
}

export interface ImportSummary {
  counts: { rows: number; ok: number; errors: number; duplicates: number; skipped: number };
  batch_errors: RowError[];
  digest: string;
  money_in: string | null;
  money_out: string | null;
  debits: string | null;
  credits: string | null;
  unit_total: string | null;
  by_account: Record<string, { account: string; type: string; exempt: boolean | null; count: number; total: string }>;
  new_units: number;
  existing_units: number;
  new_people: number;
  owners_assigned: number;
  dues_plans: number;
  dues_plans_skipped_no_fund: number;
  percent_total: string | null;
  created?: number;
  amendment_id?: string;
}
