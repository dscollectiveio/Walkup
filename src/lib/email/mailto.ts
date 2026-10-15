/**
 * Email drafts open in the board member's own mail app (brief decision 8):
 * Walkup never sends email. These builders make the links. Pure and
 * client-safe.
 *
 * Bodies go with CRLF line endings (RFC 6068) so every mail client keeps the
 * paragraphs. Some clients cut a draft near 2,000 characters of URL, so past
 * MAILTO_SAFE_LENGTH the UI copies the text and opens a short draft to paste
 * it into instead.
 */

/** Body plus subject length (characters, before encoding) above which some mail apps cut the draft. Same figure as lib/tax EMAIL_BODY_MAX. */
export const MAILTO_SAFE_LENGTH = 1_800;

export interface Recipients { cc?: string[]; bcc?: string[] }

type To = string | string[] | null | undefined;

/** A recipient that could smuggle a second address or a header: separators, brackets, quotes, whitespace, control characters. */
const UNSAFE_RECIPIENT = /[,;<>"\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function list(to: To): string[] {
  const raw = to === null || to === undefined ? [] : Array.isArray(to) ? to : [to];
  // One mailbox per entry: "a@b.com,evil@x.example" is dropped, not split (REVIEW-2 #14).
  return raw.map((s) => (s ?? "").trim()).filter((s) => s !== "" && !UNSAFE_RECIPIENT.test(s));
}

/** A subject is one line: line breaks and other control characters become a space. */
function oneLine(subject: string): string {
  return (subject ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * href for a bare "mailto:" link to an address read from the database or from
 * a verified web page. The address is encoded, so a stored value such as
 * "a@b.com?bcc=x@y.example" cannot add a recipient, a subject or a body.
 */
export function mailtoLink(email: string | null | undefined): string {
  // "@" is legal in the path and keeps the link readable; everything that could add a parameter is encoded.
  return `mailto:${encodeURIComponent((email ?? "").trim()).replace(/%40/g, "@")}`;
}

function encodeList(to: To): string {
  return list(to).map(encodeURIComponent).join(",");
}

function crlf(body: string): string {
  return body.replace(/\r\n|\r|\n/g, "\r\n");
}

/**
 * mailto: link. Recipients trimmed, empty ones dropped, each encoded (so "@" is %40),
 * joined with ","; null or [] gives "mailto:?...". Subject and body always, in that order,
 * then cc and bcc when non-empty.
 */
export function mailtoHref(to: To, subject: string, body: string, opts?: Recipients): string {
  const params = [`subject=${encodeURIComponent(oneLine(subject))}`, `body=${encodeURIComponent(crlf(body))}`];
  const cc = encodeList(opts?.cc);
  const bcc = encodeList(opts?.bcc);
  if (cc) params.push(`cc=${cc}`);
  if (bcc) params.push(`bcc=${bcc}`);
  return `mailto:${encodeList(to)}?${params.join("&")}`;
}

/** Gmail compose link (foundation-spec 2.8). Same encoding and CRLF rule. */
export function gmailComposeHref(to: To, subject: string, body: string, opts?: Recipients): string {
  const params = ["view=cm", "fs=1", `to=${encodeList(to)}`];
  const cc = encodeList(opts?.cc);
  const bcc = encodeList(opts?.bcc);
  if (cc) params.push(`cc=${cc}`);
  if (bcc) params.push(`bcc=${bcc}`);
  params.push(`su=${encodeURIComponent(oneLine(subject))}`, `body=${encodeURIComponent(crlf(body))}`);
  return `https://mail.google.com/mail/?${params.join("&")}`;
}

/** Outlook.com compose link (foundation-spec 2.8). Same encoding and CRLF rule. */
export function outlookComposeHref(to: To, subject: string, body: string, opts?: Recipients): string {
  const params = [`to=${encodeList(to)}`];
  const cc = encodeList(opts?.cc);
  const bcc = encodeList(opts?.bcc);
  if (cc) params.push(`cc=${cc}`);
  if (bcc) params.push(`bcc=${bcc}`);
  params.push(`subject=${encodeURIComponent(oneLine(subject))}`, `body=${encodeURIComponent(crlf(body))}`);
  return `https://outlook.live.com/mail/0/deeplink/compose?${params.join("&")}`;
}

export type MailApp = "mailto" | "gmail" | "outlook";
export const MAIL_APPS: readonly MailApp[] = ["mailto", "gmail", "outlook"];
export const MAIL_APP_LABEL: Record<MailApp, string> = {
  mailto: "Open in your email app",
  gmail: "Open in Gmail",
  outlook: "Open in Outlook.com",
};

/** The compose link for one app. */
export function composeHref(app: MailApp, to: To, subject: string, body: string, opts?: Recipients): string {
  if (app === "gmail") return gmailComposeHref(to, subject, body, opts);
  if (app === "outlook") return outlookComposeHref(to, subject, body, opts);
  return mailtoHref(to, subject, body, opts);
}

/** subject.length + body.length <= MAILTO_SAFE_LENGTH. Applies to all three link kinds. */
export function fitsMailto(subject: string, body: string): boolean {
  return subject.length + body.length <= MAILTO_SAFE_LENGTH;
}

export const PASTE_HINT = "(Paste the email text Walkup copied for you here.)";

/**
 * The link used when the draft is too long: recipients and subject only, and
 * a one-line body asking to paste. The caller copies the full text first.
 */
export function pasteHref(app: MailApp, to: To, subject: string, opts?: Recipients): string {
  return composeHref(app, to, subject, PASTE_HINT, opts);
}

/** Kept name for the mailto case: pasteHref("mailto", ...). */
export function mailtoPasteHref(to: To, subject: string, opts?: Recipients): string {
  return pasteHref("mailto", to, subject, opts);
}

/** "Subject: ...\n\n<body>" for the clipboard. */
export function plainTextEmail(subject: string, body: string): string {
  return `Subject: ${subject}\n\n${body}`;
}

/** Loose shape check. */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s);
}

/**
 * Split on commas, semicolons and whitespace; keep things that look like addresses; dedupe
 * case-insensitively, first spelling wins; report the pieces that didn't look like addresses.
 * Angle brackets and quotes around a piece ("<pat@x.com>") are ignored.
 */
export function parseEmailListDetailed(input: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of (input ?? "").split(/[,;\s]+/)) {
    const piece = raw.replace(/^[<"'(]+|[>"')]+$/g, "");
    if (!piece) continue;
    if (looksLikeEmail(piece)) {
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      emails.push(piece);
    } else if (!invalid.includes(piece)) {
      invalid.push(piece);
    }
  }
  return { emails, invalid };
}

/** parseEmailListDetailed(input).emails */
export function parseEmailList(input: string): string[] {
  return parseEmailListDetailed(input).emails;
}

/**
 * Bracketed blanks a person must fill or check before sending, over subject then body,
 * unique, in order. Catches the model's "[preferred dates]" and the checker's
 * "[check: $12,500]" and "[link removed]".
 */
export function findBlanks(subject: string, body: string): string[] {
  const out: string[] = [];
  for (const text of [subject ?? "", body ?? ""]) {
    for (const m of text.matchAll(/\[[^\]\n]{1,60}\]/g)) {
      if (!out.includes(m[0])) out.push(m[0]);
    }
  }
  return out;
}
