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

const PATTERNS: { label: string; re: RegExp }[] = [
  // 123-45-6789 / 123 45 6789 — SSN
  { label: "ssn", re: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g },
  // 12-3456789 / 12 3456789 — EIN
  { label: "ein", re: /\b\d{2}[-\s]\d{7}\b/g },
  // 123456789 — unpunctuated TIN of either kind
  { label: "bare", re: /\b\d{9}\b/g },
];

export const REDACTION_MARKER = "[redacted]";

export interface RedactionResult {
  text: string;
  /** How many numbers were removed. Surfaced so a person can tell it happened. */
  count: number;
}

export function redactTaxIds(text: string): RedactionResult {
  let out = text;
  let count = 0;

  for (const { re } of PATTERNS) {
    out = out.replace(re, () => {
      count += 1;
      return REDACTION_MARKER;
    });
  }

  return { text: out, count };
}
