/**
 * Matching a file's columns to Walkup's fields (import-spec 5.2). Pure.
 *
 * Scoring: an exact synonym 1.0; the header contains a synonym as whole words
 * 0.8; a synonym contains the header (header at least 4 characters) 0.6. Below
 * that no match. Each header and each field is used at most once, highest
 * score first, ties to the earlier column. A header with no match can still be
 * sniffed by its values, and is then offered as a Guess.
 */

import { FIELDS, type ImportKind } from "./kinds";
import { normalizeDate, looksLikeDate } from "./normalize";
import { isSensitiveHeader } from "./sensitive";

export { isSensitiveHeader };

export interface DetectedColumn {
  field: string;
  header: string;
  index: number;
  score: number;
  reason: "exact" | "contains" | "values";
}

/** lowercase, punctuation to spaces, collapsed; % and # are kept because they carry meaning in headers. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9%#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsWholeWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function scoreHeader(header: string, synonym: string): { score: number; reason: "exact" | "contains"; length: number } | null {
  if (!header || !synonym) return null;
  if (header === synonym) return { score: 1, reason: "exact", length: synonym.length };
  if (synonym.length >= 4 && containsWholeWords(header, synonym)) return { score: 0.8, reason: "contains", length: synonym.length };
  if (header.length >= 4 && synonym.length > header.length && containsWholeWords(synonym, header)) {
    return { score: 0.6, reason: "contains", length: header.length };
  }
  return null;
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MONEY_LIKE = /^\(?-?\$?\s?-?[\d,]+(\.\d{1,2})?\)?-?$/;

function firstValues(sampleRows: string[][], index: number, max = 8): string[] {
  const out: string[] = [];
  for (const row of sampleRows) {
    const v = (row[index] ?? "").trim();
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Only these fields are ever guessed from values; a stray money column is not a dues amount. */
const SNIFFABLE = new Set(["date", "email", "amount"]);

function sniff(fieldKey: string, fieldKind: string, values: string[]): boolean {
  if (values.length === 0 || !SNIFFABLE.has(fieldKey)) return false;
  if (fieldKind === "date") return values.every((v) => looksLikeDate(v));
  if (fieldKind === "email") return values.every((v) => EMAIL_LIKE.test(v));
  if (fieldKind === "money") {
    if (!values.every((v) => MONEY_LIKE.test(v))) return false;
    // A column of whole numbers is more likely unit numbers or years than money.
    return values.some((v) => /[.$(]/.test(v));
  }
  return false;
}

export function detectColumns(
  kind: ImportKind,
  headers: string[],
  sampleRows: string[][],
): {
  mapping: Record<string, number | null>;
  detected: DetectedColumn[];
  unmapped: { index: number; header: string; sensitive: boolean }[];
} {
  const fields = FIELDS[kind];
  const norm = headers.map(normalizeHeader);
  const sensitive = headers.map((h) => isSensitiveHeader(h));

  interface Candidate { field: string; fieldOrder: number; index: number; score: number; reason: "exact" | "contains"; length: number }
  const candidates: Candidate[] = [];
  fields.forEach((f, fieldOrder) => {
    norm.forEach((h, index) => {
      if (sensitive[index]) return;
      let best: { score: number; reason: "exact" | "contains"; length: number } | null = null;
      for (const syn of f.synonyms) {
        const s = scoreHeader(h, syn);
        if (s && (!best || s.score > best.score || (s.score === best.score && s.length > best.length))) best = s;
      }
      if (best && best.score >= 0.6) candidates.push({ field: f.key, fieldOrder, index, ...best });
    });
  });
  // Longer matched phrases win a tie ("email address" beats "owner" in "Owner Email Address").
  candidates.sort((a, b) => b.score - a.score || b.length - a.length || a.index - b.index || a.fieldOrder - b.fieldOrder);

  const mapping: Record<string, number | null> = Object.fromEntries(fields.map((f) => [f.key, null]));
  const detected: DetectedColumn[] = [];
  const usedColumns = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== null || usedColumns.has(c.index)) continue;
    mapping[c.field] = c.index;
    usedColumns.add(c.index);
    detected.push({ field: c.field, header: headers[c.index], index: c.index, score: c.score, reason: c.reason });
  }

  // Values: only for fields still free and headers still unused.
  for (const f of fields) {
    if (mapping[f.key] !== null) continue;
    for (let index = 0; index < headers.length; index++) {
      if (usedColumns.has(index) || sensitive[index]) continue;
      if (sniff(f.key, f.kind, firstValues(sampleRows, index))) {
        mapping[f.key] = index;
        usedColumns.add(index);
        detected.push({ field: f.key, header: headers[index], index, score: 0.5, reason: "values" });
        break;
      }
    }
  }

  const unmapped = headers
    .map((header, index) => ({ index, header, sensitive: sensitive[index] }))
    .filter((c) => !usedColumns.has(c.index));
  return { mapping, detected, unmapped };
}

/** Three parsed dates for the "Dates look like" preview, as ISO text or null for ones that do not parse. */
export function sampleDates(values: string[], hint: "mdy" | "dmy" | "ymd" | "auto", n = 3): (string | null)[] {
  return values
    .filter((v) => v.trim() !== "")
    .slice(0, n)
    .map((v) => {
      const r = normalizeDate(v, hint);
      return r.ok ? r.iso : null;
    });
}
