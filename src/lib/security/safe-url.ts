/**
 * An address safe to put in an href: http(s) only, no credentials, no control
 * characters. Anything else (javascript:, data:, file:, ftp:, a relative path
 * that the browser would resolve against this site) becomes null and the link
 * is not drawn. Used wherever a URL came from a model, a web page or a
 * stored free-text field (REVIEW-2 #3).
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 2048 || /[\u0000-\u001f\u007f-\u009f\\\s]/.test(value)) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}
