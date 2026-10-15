/**
 * Formula-injection guard (import-spec 4.4). Pure.
 *
 * A spreadsheet program treats a cell that starts with = + - @ (or a tab or
 * carriage return, which some versions skip over) as a formula. Anything
 * Walkup writes into a CSV or XLSX that a person typed into the app, or that
 * came out of an uploaded file, goes through here first.
 *
 * Numbers pass through. A string that starts with one of those characters
 * (after any leading spaces) and is not a plain number gets a single quote in
 * front, which Excel and Sheets show as plain text.
 */

import type { CellValue } from "exceljs";

const DANGEROUS_FIRST = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function safeCell(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const text = String(value);
  const first = text.replace(/^ +/, "")[0];
  if (first !== undefined && DANGEROUS_FIRST.has(first) && !PLAIN_NUMBER.test(text.trim())) {
    return `'${text}`;
  }
  return text;
}

/** One CSV line (no trailing newline): safeCell on each cell, then RFC 4180 quoting. */
export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => {
      const text = String(safeCell(c));
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

/** A cell value for exceljs: strings are written as plain strings (never { formula }) and guarded. */
export function toXlsxCell(value: string | number | null | undefined): CellValue {
  const safe = safeCell(value);
  return typeof safe === "number" ? safe : String(safe);
}
