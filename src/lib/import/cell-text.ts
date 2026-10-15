/** The one rule for turning any cell, CSV or XLSX, into text (import-spec 4.2). Pure. */

export const MAX_CELL_CHARS = 2000;
export const LONG_CELL_KEPT_CHARS = 200;

// Control characters other than tab, newline and carriage return.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** `String(value)` with control characters dropped, whitespace collapsed, a forced-text apostrophe removed. */
export function cellText(value: string): string {
  let t = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  // Excel adds a leading ' to force text; it is not part of the value.
  if (t.startsWith("'") && t.length > 1) t = t.slice(1).trim();
  return t;
}

export function tooLong(value: string): boolean {
  return value.length > MAX_CELL_CHARS;
}
