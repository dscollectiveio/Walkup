import { MAIL_APP_LABEL, MAIL_APPS, type MailApp } from "@/lib/email/mailto";

/**
 * Pure state and copy behind DraftEmail (foundation-spec 7.2), split out so
 * every branch is unit-tested without a DOM.
 */

export const MAIL_APP_STORAGE_KEY = "walkup.mailApp";

/** A remembered value from localStorage, or the default. */
export function parseMailApp(value: string | null | undefined): MailApp {
  return (MAIL_APPS as readonly string[]).includes(value ?? "") ? (value as MailApp) : "mailto";
}

/** The two apps not currently primary, in a fixed order. */
export function otherApps(app: MailApp): MailApp[] {
  return MAIL_APPS.filter((a) => a !== app);
}

export interface PrimaryState {
  label: string;
  /** primary: filled ink button; ghost: secondary style while blanks remain. */
  style: "primary" | "ghost";
  /** link: a plain <a>; copyAndOpen: copy the body, then open a short draft to paste into. */
  action: "link" | "copyAndOpen";
}

/** The main button: "Open anyway" in ghost style while blanks remain; copy-and-open for long drafts. */
export function primaryState(blanks: number, fits: boolean, app: MailApp): PrimaryState {
  const action = fits ? "link" : "copyAndOpen";
  if (blanks > 0) return { label: "Open anyway", style: "ghost", action };
  return { label: fits ? MAIL_APP_LABEL[app] : "Copy and open", style: "primary", action };
}

/** Label for one of the other apps, which follow the same link-or-copy rule. */
export function otherAppLabel(app: MailApp, fits: boolean): string {
  return fits ? MAIL_APP_LABEL[app] : `Copy and ${MAIL_APP_LABEL[app].charAt(0).toLowerCase()}${MAIL_APP_LABEL[app].slice(1)}`;
}

/**
 * "Did you send it?" flow.
 *   idle      nothing shown
 *   awaiting  an open action happened; waiting for the person to come back
 *   asking    they came back (visibilitychange to visible): the prompt shows
 */
export type PromptState = "idle" | "awaiting" | "asking";
export type PromptEvent = "opened" | "visible" | "notYet" | "marked";

export function nextPromptState(
  state: PromptState,
  event: PromptEvent,
  ctx: { canMark: boolean; sent: boolean },
): PromptState {
  if (!ctx.canMark || ctx.sent) return "idle";
  switch (event) {
    case "opened":
      return state === "asking" ? "asking" : "awaiting";
    case "visible":
      return state === "awaiting" ? "asking" : state;
    case "notYet":
    case "marked":
      return "idle";
  }
}

/** "Fill in 1 blank before sending: [x]." / "Fill in 2 blanks before sending: [x], [y]." */
export function blanksMessage(blanks: string[]): string | null {
  if (blanks.length === 0) return null;
  return `Fill in ${blanks.length} blank${blanks.length === 1 ? "" : "s"} before sending: ${blanks.join(", ")}.`;
}

/** "Couldn't read: bob@acme" (comma-separated when several). */
export function invalidMessage(invalid: string[]): string | null {
  return invalid.length ? `Couldn't read: ${invalid.join(", ")}` : null;
}

export const DRAFT_COPY = {
  noRecipient: "No email address on file. The draft opens without a recipient; add one in your mail app.",
  bccHint: "People in Bcc don't see each other's addresses.",
  addCcBcc: "Add Cc or Bcc",
  longDraft: "This email is long, so some mail apps would cut it off. Use “Copy and open”, then paste the text into the new email.",
  nothingOpened: "Nothing opened? Use Copy text and paste it into a new email.",
  copied: "Copied. Paste it into the email.",
  copyFailed: "Couldn't copy automatically. Select the text above and copy it.",
  saved: "Saved.",
  checkHeadline: "Check these before sending",
  didYouSend: "Did you send it?",
  yesMark: "Yes, mark as sent",
  notYet: "Not yet",
  sentAgain: "Sent again? Update the date",
  footer: "Drafts like this open in your own mail app. Walkup does not send them.",
} as const;

/** True when the edited draft differs from the last saved (or original) one. */
export function draftChanged(
  a: { to: string; cc: string; bcc: string; subject: string; body: string },
  b: { to: string; cc: string; bcc: string; subject: string; body: string },
): boolean {
  return a.to !== b.to || a.cc !== b.cc || a.bcc !== b.bcc || a.subject !== b.subject || a.body !== b.body;
}

/** Split text into plain and blank segments, for the highlight layer and read-only marks. */
export function blankSegments(text: string): { text: string; blank: boolean }[] {
  const out: { text: string; blank: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/\[[^\]\n]{1,60}\]/g)) {
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start), blank: false });
    out.push({ text: m[0], blank: true });
    at = start + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), blank: false });
  return out;
}
