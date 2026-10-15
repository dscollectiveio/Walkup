/**
 * Strip taxpayer identification numbers out of extracted text.
 *
 * DECISIONS #4 keeps full TINs out of this database on purpose: for a sole
 * proprietor the TIN *is* a Social Security number, and Walkup stores only
 * `tin_last4` plus the W-9 itself in Storage. Reading text out of that W-9
 * would quietly undo it — the number would land in `documents.extracted_text`,
 * get copied into every future prompt, and be readable by board_admin forever.
 *
 * So redaction runs the moment text leaves the file, before anything else sees
 * it: before the classifier prompt, before the database, before search. The
 * model does not need somebody's SSN to recognise a W-9.
 *
 * Deliberately over-inclusive. A bare nine-digit run is usually a TIN in this
 * corpus, but even when it isn't, the cost of redacting it is a slightly worse
 * search index; the cost of missing one is an SSN in a permanent record. Those
 * are not the same size of mistake.
 *
 * Pure and dependency-free so the rules can be tested directly.
 */

/**
 * Separators a PDF or a typist puts between the groups: spaces, a line break
 * (text extraction splits "123-45-\n6789"), hyphens, dots. Other dash
 * characters are folded to "-" first (see foldForMatching).
 */
const SEP = "[\\s.-]{0,3}";

const PATTERNS: { label: string; re: RegExp }[] = [
  // A taxpayer-number keyword followed by nine digits however they are spaced: "TIN 1 2 3 4 5 6 7 8 9".
  // The keyword stays; only the digits go.
  {
    label: "keyword",
    re: /\b((?:ssn|ein|tin|itin|social security(?: number)?|taxpayer(?: identification)?(?: number)?|tax id)\b[^\d]{0,20}?)\d(?:[\s.-]{0,2}\d){8}(?!\d)/gi,
  },
  // 123-45-6789 / 123 45 6789 / 123.45.6789 / 123-45-\n6789 — SSN
  { label: "ssn", re: new RegExp(`(?<!\\d)\\d{3}${SEP}\\d{2}${SEP}\\d{4}(?!\\d)`, "g") },
  // 12-3456789 / 12 3456789 / 12–3456789 — EIN
  { label: "ein", re: new RegExp(`(?<!\\d)\\d{2}${SEP}\\d{7}(?!\\d)`, "g") },
  // 123-456-789 / 123.456.789 — three groups of three, punctuation only (spaces alone are unit lists)
  { label: "333", re: /(?<!\d)\d{3}[.-]\d{3}[.-]\d{3}(?!\d)/g },
  // 123456789 — unpunctuated TIN of either kind
  { label: "bare", re: /(?<!\d)\d{9}(?!\d)/g },
];

/**
 * Full-width digits and look-alike dashes would slip past a plain pattern
 * (REVIEW-2 #10): NFKC turns full-width digits and non-breaking hyphens into
 * their ASCII forms, and every other dash, minus and soft hyphen becomes "-".
 * The returned text is the folded text, so what is stored matches what was checked.
 */
function foldForMatching(text: string): string {
  return text.normalize("NFKC").replace(/[\p{Pd}\u2212\u00ad\ufe63\uff0d]/gu, "-");
}

export const REDACTION_MARKER = "[redacted]";

export interface RedactionResult {
  text: string;
  /** How many numbers were removed. Surfaced so a person can tell it happened. */
  count: number;
}

export function redactTaxIds(text: string): RedactionResult {
  let out = foldForMatching(text);
  let count = 0;

  for (const { label, re } of PATTERNS) {
    out = out.replace(re, (_match, keyword?: string) => {
      count += 1;
      return label === "keyword" && typeof keyword === "string" ? `${keyword}${REDACTION_MARKER}` : REDACTION_MARKER;
    });
  }

  return { text: out, count };
}
