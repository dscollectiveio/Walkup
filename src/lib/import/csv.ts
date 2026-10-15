/**
 * CSV reading (import-spec 4.2). Pure, no dependency.
 *
 * RFC 4180: quotes, doubled quotes, and CR, LF or CRLF inside quoted fields.
 * The BOM is dropped, the delimiter (comma, semicolon or tab) is chosen by
 * counting unquoted occurrences in the first lines, UTF-8 is tried first and
 * Windows-1252 is the fallback for files saved by older Excel, and UTF-16 is
 * read when its byte order mark is there (Excel's "Unicode Text").
 */

export interface DecodedCsv {
  text: string;
  warnings: string[];
}

export const WINDOWS_TEXT_WARNING = "Read as Windows text. Check that names with accents look right.";

export function decodeCsvBytes(bytes: Uint8Array): DecodedCsv {
  const warnings: string[] = [];
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), warnings };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), warnings };
  }
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const body = bytes.subarray(start);
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body), warnings };
  } catch {
    warnings.push(WINDOWS_TEXT_WARNING);
    return { text: new TextDecoder("windows-1252").decode(body), warnings };
  }
}

/** Count unquoted delimiters in the first `lines` lines and pick the most common; ties go to comma. */
export function detectDelimiter(text: string, lines = 5): "," | ";" | "\t" {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let seenLines = 0;
  for (let i = 0; i < text.length && seenLines < lines; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n") seenLines += 1;
      else if (ch in counts) counts[ch] += 1;
    }
  }
  if (counts[";"] > counts[","] && counts[";"] >= counts["\t"]) return ";";
  if (counts["\t"] > counts[","] && counts["\t"] > counts[";"]) return "\t";
  return ",";
}

/** Parse delimited text into rows of cells. Blank lines are skipped. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < n; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delim) {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (field !== "" || fieldStarted || row.length > 0) endRow();
  return rows;
}
