/**
 * The one place a `next` / redirect parameter is judged.
 *
 * A browser treats `\` like `/` and ignores tab, CR and LF inside a URL, so
 * `/\evil.example` and `/<TAB>/evil.example` leave the site even though they
 * start with "/" and not "//". Anything read from a query string, a form field
 * or a link goes through here before it reaches redirect().
 *
 * Accepts only a plain same-site path: one leading "/", printable ASCII, no
 * backslash, no control characters, no protocol-relative start (also after
 * percent-decoding, up to three layers), no more than 2,048 characters.
 * Anything else becomes the fallback.
 */

const MAX_LENGTH = 2048;
// "/" then printable, non-space ASCII other than a backslash.
const PLAIN_PATH = /^\/[\x21-\x5b\x5d-\x7e]*$/;
// Backslash, C0/C1 controls, line and paragraph separators.
const BAD_CHARS = new RegExp("[\\\\\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");
const BASE = "http://walkup.invalid";

function decodesToSafe(raw: string): boolean {
  let current = raw;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return false; // malformed escape: not something we wrote
    }
    if (next === current) break;
    current = next;
    if (BAD_CHARS.test(current)) return false;
    if (current.startsWith("//") || /^\/[\\\t\r\n]/.test(current)) return false;
  }
  return true;
}

export function safeNext(raw: string | null | undefined, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  if (!PLAIN_PATH.test(raw)) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (!decodesToSafe(raw)) return fallback;
  try {
    if (new URL(raw, BASE).origin !== BASE) return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
