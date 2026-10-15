/**
 * Turning a parsed file plus the person's column mapping into the rows that are
 * staged in the database (import-spec 11.1). Pure.
 *
 * Only the mapped columns are read. A spare column holding a tax ID or a bank
 * account is never looked at, so it cannot be staged, previewed or sent.
 *
 * A value that cannot be read is kept as typed (cut to 200 characters) rather
 * than blanked, so the database can say exactly what is wrong with it and the
 * fix table can show it. Money stays a decimal string throughout.
 */

import { redactTaxIds } from "@/lib/documents/redact";
import { fromCents, toCents } from "@/lib/tax/form1120h";
import { FIELDS, type FieldDef, type ImportKind } from "./kinds";
import {
  detectDateOrder, normalizeDate, normalizeEmail, normalizeMoney, normalizePercent, normalizePhone, normalizeTrade,
  type DateHint,
} from "./normalize";
import type { ParsedFile, RowError, StagedRow } from "./types";

export interface StageInput {
  kind: ImportKind;
  file: ParsedFile;
  /** field key -> column index; only these columns are read. */
  mapping: Record<string, number | null>;
  dateHint: DateHint;
}

const KEEP_AS_TYPED = 200;
const REDACTED_FIELDS = new Set(["description", "notes", "payee", "owner_name"]);
const TEXT_LIMITS: Record<string, number> = { description: 300, notes: 2000, mailing_address: 300, owner_name: 200, name: 200 };

function asTyped(text: string): string {
  return text.slice(0, KEEP_AS_TYPED);
}

function cleanText(key: string, text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, TEXT_LIMITS[key] ?? 200);
}

function cell(row: string[], index: number | null | undefined): string {
  if (index === null || index === undefined || index < 0) return "";
  return row[index] ?? "";
}

export function buildStagedRows(input: StageInput): { rows: StagedRow[]; notes: string[] } {
  const { kind, file, mapping } = input;
  const fields = FIELDS[kind];
  const mappedFields = fields.filter((f) => mapping[f.key] !== null && mapping[f.key] !== undefined);

  // Column-level decisions first.
  let hint: DateHint = input.dateHint;
  const dateFields = mappedFields.filter((f) => f.kind === "date");
  if (hint === "auto" && dateFields.length > 0) {
    const values = file.rows.flatMap((r) => dateFields.map((f) => cell(r, mapping[f.key])));
    hint = detectDateOrder(values);
  }
  const percentField = mappedFields.find((f) => f.kind === "percent");
  const percentValues = percentField
    ? normalizePercent(file.rows.map((r) => cell(r, mapping[percentField.key])))
    : null;

  const issuesByRow = new Map<number, typeof file.issues>();
  for (const issue of file.issues) {
    const list = issuesByRow.get(issue.row) ?? [];
    list.push(issue);
    issuesByRow.set(issue.row, list);
  }
  const mappedColumns = new Set(mappedFields.map((f) => mapping[f.key] as number));

  const rows: StagedRow[] = [];
  let redactedRows = 0;
  let fractionNote = false;
  const notes: string[] = [];

  file.rows.forEach((row, i) => {
    const raw: Record<string, string> = {};
    const mapped: Record<string, string> = {};
    const errors: RowError[] = [];
    let any = false;

    for (const f of mappedFields) {
      const text = cell(row, mapping[f.key]).trim();
      raw[f.key] = text;
      if (text !== "") any = true;
    }
    if (!any) return; // a fully empty row is skipped

    let redacted = false;
    for (const f of mappedFields) {
      const text = raw[f.key];
      if (text === "") continue;
      if (f.key === "trade") {
        const t = normalizeTrade(text);
        if (t) {
          mapped.trade = t.trade;
          mapped.trade_slug = t.slug;
        }
        continue;
      }
      if (f.kind === "percent") continue; // column-level, below
      let out = normalizeField(f, text, hint, errors);
      if (REDACTED_FIELDS.has(f.key)) {
        const r = redactTaxIds(out);
        if (r.count > 0) {
          redacted = true;
          out = r.text;
        }
      }
      if (out !== "") mapped[f.key] = out;
    }
    if (percentField && percentValues?.ok) {
      const v = percentValues.values[i];
      if (v) mapped[percentField.key] = v;
      if (percentValues.asFraction && v) fractionNote = true;
    }
    if (percentField && percentValues && !percentValues.ok && raw[percentField.key]) {
      mapped[percentField.key] = asTyped(raw[percentField.key]);
    }

    if (kind === "transactions") combineInOut(mapped, raw, errors);

    // Problems the parser met in a mapped column of this row.
    for (const issue of issuesByRow.get(i) ?? []) {
      if (!mappedColumns.has(issue.col)) continue;
      const field = mappedFields.find((f) => mapping[f.key] === issue.col);
      errors.push({ field: field?.key ?? "row", code: issue.code, message: issue.message });
    }
    if (redacted) redactedRows += 1;

    rows.push({ row_number: i + 1, raw, mapped, errors });
  });

  if (percentValues && !percentValues.ok) notes.push(percentValues.error);
  if (fractionNote) notes.push("Ownership values were read as fractions of the whole and multiplied by 100.");
  if (redactedRows > 0) {
    notes.push(`Removed a number that looked like a tax ID from ${redactedRows} ${redactedRows === 1 ? "row" : "rows"}.`);
  }
  return { rows, notes };
}

function normalizeField(f: FieldDef, text: string, hint: DateHint, errors: RowError[]): string {
  switch (f.kind) {
    case "date": {
      const r = normalizeDate(text, hint);
      return r.ok ? r.iso : asTyped(text);
    }
    case "money": {
      const r = normalizeMoney(text);
      if (r.ok) return r.text;
      if (r.message) errors.push({ field: f.key, code: "parse_amount_comma", message: r.message });
      return asTyped(text);
    }
    case "email":
      return normalizeEmail(text).slice(0, 254);
    case "phone":
      return normalizePhone(text);
    case "percent":
      return text;
    case "unit":
    case "category":
    case "fund":
      return text.replace(/\s+/g, " ").trim().slice(0, 120);
    default:
      return cleanText(f.key, text);
  }
}

/** Separate deposit and withdrawal columns become one signed amount, in cents. */
function combineInOut(mapped: Record<string, string>, raw: Record<string, string>, errors: RowError[]): void {
  const hasIn = "money_in" in raw && raw.money_in !== "";
  const hasOut = "money_out" in raw && raw.money_out !== "";
  if (!hasIn && !hasOut) {
    delete mapped.money_in;
    delete mapped.money_out;
    return;
  }
  const inText = mapped.money_in;
  const outText = mapped.money_out;
  delete mapped.money_in;
  delete mapped.money_out;
  if (hasIn && hasOut && !isZero(inText) && !isZero(outText)) {
    errors.push({ field: "amount", code: "parse_amount_conflict", message: "This row has both a deposit and a withdrawal." });
    return;
  }
  const side = hasIn && !isZero(inText) ? "in" : hasOut && !isZero(outText) ? "out" : hasIn ? "in" : "out";
  const text = side === "in" ? inText : outText;
  if (text === undefined || !/^-?\d+\.\d{2}$/.test(text)) {
    // Unreadable: keep what was typed so the database names the problem.
    if (text !== undefined) mapped.amount = text;
    return;
  }
  const magnitude = Math.abs(toCents(text));
  mapped.amount = fromCents(side === "in" ? magnitude : -magnitude);
}

function isZero(text: string | undefined): boolean {
  return text !== undefined && /^-?0\.00$/.test(text);
}

/**
 * A value typed into the fix table, normalised like a staged one. Unreadable
 * text is kept as typed so the database can say what is wrong with it.
 */
export function normalizeEdit(kind: ImportKind, key: string, text: string, hint: DateHint = "mdy"): string {
  const field = FIELDS[kind].find((f) => f.key === key);
  const t = text.trim();
  if (!field || t === "") return "";
  if (key === "trade") return t.slice(0, 60);
  if (field.kind === "percent") return t.replace(/\s+/g, "").replace(/%$/, "").slice(0, KEEP_AS_TYPED);
  return normalizeField(field, t, hint, []);
}
