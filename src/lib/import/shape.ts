/**
 * Character masks for the optional AI column help (import-spec 5.3). Pure.
 *
 * The model never sees a value. It sees the shape of one: letters become x
 * (lowercase) or X (uppercase), digits become 9, runs of whitespace become one
 * space. A few punctuation marks that tell a date from a name or an amount
 * from a phone number are kept; anything else becomes ?.
 */

import { isSensitiveHeader } from "./sensitive";

const KEPT = new Set([".", ",", "-", "/", "(", ")", "$", "%", "@", ":", "#", "+", "&", "'"]);
const MAX_SHAPE = 24;

export function shapeOf(cell: string): string {
  let out = "";
  let lastWasSpace = false;
  for (const ch of cell) {
    if (/\s/u.test(ch)) {
      if (!lastWasSpace && out !== "") out += " ";
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    if (/\p{L}/u.test(ch)) out += ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? "X" : "x";
    else if (/\p{Nd}/u.test(ch)) out += "9";
    else if (KEPT.has(ch)) out += ch;
    else out += "?";
  }
  out = out.trimEnd();
  const chars = [...out];
  return chars.length > MAX_SHAPE ? `${chars.slice(0, MAX_SHAPE).join("")}...` : out;
}

/** Masks of up to `maxRows` rows that have at least one non-empty cell. */
export function maskRows(rows: string[][], maxRows = 5): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    if (!row.some((c) => c.trim() !== "")) continue;
    out.push(row.map((c) => shapeOf(c)));
    if (out.length >= maxRows) break;
  }
  return out;
}

/** Words that make a capitalised phrase a column title ("Owner Name", "Unit Number") rather than a person or a place. */
const HEADER_WORDS = new Set([
  "name", "first", "last", "full", "owner", "owners", "unit", "units", "number", "no", "address", "mailing", "billing", "street",
  "city", "state", "zip", "postal", "code", "email", "phone", "mobile", "cell", "date", "due", "amount", "balance", "dues", "fee",
  "fees", "assessment", "account", "type", "status", "id", "notes", "note", "tenant", "resident", "occupant", "co", "primary",
  "secondary", "contact", "square", "feet", "sqft", "share", "percent", "percentage", "ownership", "vendor", "company", "category",
  "description", "memo", "payee", "payment", "paid", "charge", "late", "start", "end", "month", "year", "period", "occupied",
  "owner's", "parking", "storage", "locker", "building", "bedrooms", "baths", "tax", "ein", "ssn",
]);

/**
 * The first row of a file with no header row is data: a person's name, a street address, an amount. Those are
 * not column titles and must not be sent as if they were (REVIEW-2 #9). A title is a short phrase of words from
 * the vocabulary above; a number-first phrase, an amount, a date, or two capitalised words with none of those
 * vocabulary words reads as data.
 */
export function looksLikeDataHeader(header: string): boolean {
  const h = header.trim();
  if (!h) return false;
  if (/^[$(]?-?\d[\d,]*(?:\.\d+)?\)?%?$/.test(h)) return true; // 1,250.00 / 42 / (300.00) / 5%
  if (/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/.test(h)) return true; // 10/14/2026
  if (/^\p{L}[\p{L}.' -]*,?\s+\p{Lu}{2}\s+\d{5}(?:-\d{4})?$/u.test(h)) return true; // Chicago IL 60657
  if (/^\p{L}{3,9}\.?\s+\d{1,2},?\s+\d{4}$/u.test(h)) return true; // Oct 14 2026
  if (/^\d+\s+\p{L}/u.test(h) && !/^\d+\s*(?:br|bd|ba|sq|sqft|%)\b/i.test(h)) return true; // 415 W Oakdale Ave
  const words = h.split(/[\s,]+/).filter(Boolean);
  const hasTitleWord = words.some((w) => HEADER_WORDS.has(w.toLowerCase().replace(/[^\p{L}']/gu, "")));
  if (hasTitleWord) return false;
  // Two or three capitalised words and nothing that makes it a title: Jane Doe, Chicago IL.
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}.'-]*$/u.test(w));
}

/**
 * The header text that may be sent. A header that looks like data (an email
 * address, seven or more digits, over 60 characters) or like a sensitive
 * column is replaced by a placeholder; the caller maps the placeholder back.
 */
export function headerForAi(header: string, index: number): string {
  const digits = (header.match(/\d/g) ?? []).length;
  if (header.includes("@") || digits >= 7 || header.length > 60 || isSensitiveHeader(header) || looksLikeDataHeader(header)) {
    return `[column ${index + 1}]`;
  }
  return header;
}
