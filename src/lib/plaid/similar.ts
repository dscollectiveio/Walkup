/**
 * Same merchant, different reference numbers: "COMED 8841" and "COMED 9120"
 * read as one payee. Used to offer "categorize the others too" after a human
 * categorizes one row — never to categorize anything on its own.
 */
export function normalizeDescription(d: string): string {
  return d
    .toLowerCase()
    .replace(/[0-9#*]+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fewer than three letters is too little to call two rows "the same payee". */
export function isMatchableDescription(normalized: string): boolean {
  return normalized.length >= 3;
}
