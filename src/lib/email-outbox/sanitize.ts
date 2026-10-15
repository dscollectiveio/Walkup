/**
 * Everything that reaches an email header or a file name goes through here
 * first (money spec 10, "Header injection"). Pure and client-safe.
 */

// C0 and C1 controls (CR, LF, NUL, tab...), DEL, and the Unicode line and
// paragraph separators, which some mail software treats as line breaks.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Removes control characters, collapses spaces, trims, and cuts to `max`. */
export function cleanHeaderText(s: string, max = 200): string {
  const cleaned = String(s ?? "")
    .replace(CONTROLS, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

/** "Walkup on behalf of {name}", at most 78 characters, no quotes, angle brackets or backslashes. */
export function displayNameFor(associationName: string): string {
  const name = cleanHeaderText(associationName, 120).replace(/["<>\\]/g, "").replace(/\s+/g, " ").trim();
  const full = `Walkup on behalf of ${name || "your building"}`;
  return full.length > 78 ? full.slice(0, 78).trimEnd() : full;
}

const BARE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** `"Walkup on behalf of X" <address>`. Throws on an address that could carry anything but one mailbox. */
export function fromHeader(associationName: string, address: string): string {
  if (!BARE.test(address)) throw new Error("not a plain email address");
  const display = displayNameFor(associationName).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${display}" <${address}>`;
}

export function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Letters, digits, space, dot, underscore and hyphen only; 80 characters. */
export function safeFilename(s: string): string {
  const cleaned = String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .trim();
  const cut = cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
  return cut || "file";
}

/** Provider tags allow letters, digits, underscore and hyphen. */
export function tagValue(s: string): string {
  return String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}
