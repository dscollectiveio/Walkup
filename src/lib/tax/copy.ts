// Shared tax copy: the sentences every Taxes view repeats, in one place so
// the tab, the form page, Home's "Coming up", the email drafts and the
// figures pack can't drift apart. Plus the two tiny helpers that copy needs:
// how a date reads, and the scrub that keeps anything shaped like a tax ID
// out of free text.

/** Shown on every Taxes view. Walkup never files, submits, or advises. */
export const TAX_FOOTER =
  "Walkup prepares forms from your records. It doesn't file them or give tax advice. When in doubt, ask a CPA.";

/** A due date Walkup worked out from the general rule, which nobody has checked against this year's instructions. */
export const ESTIMATED_NOTE = "Estimated: not yet checked against this year's instructions.";

/** An official link Walkup retrieved that no person has opened and confirmed yet. */
export const LINKS_NOT_CHECKED = "not yet checked by a person";

/** Under every "Open the email draft" button — Walkup has no email-sending service, and a draft can't carry attachments. */
export const NOTHING_SENT =
  "Opens a draft in your email app. Nothing is sent. Attach the files you just downloaded; Walkup can't attach them for you.";

/** Beside anything about filing 1099s on paper. Self-printed Copy A isn't scannable. */
export const COPY_A_NOTE =
  "Copy A and Form 1096 printed from the IRS website can't be filed. File through IRIS (free) or on official forms ordered from the IRS.";

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * "April 15, 2027" (or "Apr 15, 2027" short) from a "YYYY-MM-DD" string, by
 * hand — parsing it through Date would read it as UTC midnight and shift the
 * day in Chicago. Anything that isn't a date comes back unchanged.
 */
export function dateWords(iso: string, style: "long" | "short" = "long"): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m > 12) return iso;
  const month = style === "long" ? MONTHS_LONG[m - 1] : MONTHS_LONG[m - 1].slice(0, 3);
  return `${month} ${d}, ${y}`;
}

/**
 * Replaces anything shaped like an EIN (12-3456789), an SSN (123-45-6789) or
 * a bare run of nine or more digits. Free text that ends up in an email body
 * or on a contractor row passes through here: a mailto URL travels through
 * the browser and the mail app in plain text, and Walkup never stores a full
 * TIN in the first place (DECISIONS #4) — this just makes sure one typed
 * into a note can't leak either.
 */
export function scrubIdentifiers(text: string): string {
  return text
    .replace(/\b\d{2}-\d{7}\b/g, "[removed]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[removed]")
    .replace(/\b\d{9,}\b/g, "[removed]");
}
