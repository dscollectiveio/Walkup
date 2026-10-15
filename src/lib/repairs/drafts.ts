// Email drafts for contractors and owners (repairs-spec §4.5). Deterministic
// templates filled from structured facts; no model call (section 19). Bodies
// use "\n"; the foundation's mailtoHref converts to CRLF. The board edits
// every draft before it opens in their own mail app (brief decision 8).
//
// Dates in an email are written out in full ("Thursday, October 22, 2026"):
// the email is read later than it is written, so "tomorrow" would go stale.

import { moneyText } from "./format";

export interface Draft { subject: string; body: string }

export interface DraftContext {
  association: { displayName: string; legalName: string; address: string | null };
  /** persons.full_name / persons.phone of the caller. */
  sender: { name: string | null; phone: string | null };
  contractor: { name: string; contactName: string | null };
}

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Thursday, October 22, 2026" from "2026-10-22"; unreadable input passes through. */
export function emailDate(dateIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateIso ?? "");
  if (!m) return dateIso;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return dateIso;
  const weekday = LONG_WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday}, ${LONG_MONTHS[mo - 1]} ${d}, ${y}`;
}

const filled = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

function greeting(contactName: string | null): string {
  const first = filled(contactName)?.split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hello,";
}

function signOff(ctx: Pick<DraftContext, "association" | "sender">, withPhone = true): string {
  return [
    "Thanks,",
    filled(ctx.sender.name),
    withPhone ? filled(ctx.sender.phone) : null,
    `Board of ${ctx.association.displayName}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

const AMOUNT_KIND_WORDS = { fixed: "fixed price", estimate: "estimate", not_to_exceed: "not to exceed" } as const;

export function quoteRequestDraft(ctx: DraftContext, job: {
  reference: number; title: string; description: string | null;
  /** "Shared area: back stairwell" / "Inside Unit 2". */
  where: string;
  /** 0 unless the board ticked "I'll attach the photos". */
  photosAttached: number;
}): Draft {
  const { displayName, address } = ctx.association;
  const description = filled(job.description);
  const photos = job.photosAttached > 0
    ? `I've attached ${job.photosAttached} photo${job.photosAttached === 1 ? "" : "s"}.`
    : "We can send photos if they would help.";
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    `We're on the board of ${displayName}${filled(address) ? `, ${filled(address)}` : ""}, a small condominium building. We'd like a quote for this job:`,
    "",
    job.title,
    `Where: ${job.where}`,
    description ? `${description}\n` : "",
    "Could you tell us:",
    "- whether you can take it on, and roughly when you could start",
    "- what you would charge, and what that includes",
    "- any deposit or payment terms",
    "- whether you carry liability insurance (we ask for a certificate before work starts)",
    "",
    `We're asking a few contractors, and nothing is approved until we confirm in writing. ${photos}`,
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `Quote request: ${job.title} (#${job.reference}), ${displayName}`, body };
}

export function jobGoAheadDraft(ctx: DraftContext, job: {
  reference: number; title: string; where: string; accessNotes: string | null;
  scheduledFor: string | null; scheduledWindow: string | null;
  amount: string | null; amountKind: "fixed" | "estimate" | "not_to_exceed" | null;
  paymentTerms: string | null;
}): Draft {
  const facts: string[] = [job.title, `Where: ${job.where}`];
  if (filled(job.amount)) {
    const kind = job.amountKind ? ` (${AMOUNT_KIND_WORDS[job.amountKind]})` : "";
    facts.push(`Agreed price: ${moneyText(filled(job.amount))}${kind}`);
  }
  if (filled(job.paymentTerms)) facts.push(`Payment terms: ${filled(job.paymentTerms)}`);
  if (filled(job.scheduledFor)) {
    const window = filled(job.scheduledWindow);
    facts.push(`Planned visit: ${emailDate(job.scheduledFor!)}${window ? `, ${window}` : ""}`);
  }
  if (filled(job.accessNotes)) facts.push(`Access: ${filled(job.accessNotes)}`);
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    "Thank you for your quote. We'd like you to go ahead with this job:",
    "",
    ...facts,
    "",
    "Please check with us before doing anything beyond what we agreed, and send us a current certificate of insurance before you start if we don't already have one.",
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `Go-ahead: ${job.title} (#${job.reference}), ${ctx.association.displayName}`, body };
}

export function notChosenDraft(ctx: DraftContext, job: { title: string }): Draft {
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    `Thank you for your quote for ${job.title}. We've decided to go with another contractor this time, and we'll keep you in mind.`,
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `Your quote for ${job.title}`, body };
}

/** Wording consistent with the Taxes tab's w9Href. */
export function w9RequestDraft(ctx: DraftContext, w9Url: string | null): Draft {
  const where = filled(w9Url) ? `The form is here: ${filled(w9Url)}` : "You can download the form from irs.gov (search for Form W-9).";
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    `${ctx.association.legalName} needs a completed Form W-9 from you for our records before we can prepare a 1099-NEC. ${where}`,
    "",
    "You can reply to this email with it attached.",
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `${ctx.association.displayName}: W-9 request`, body };
}

/**
 * Who a contractor's certificate names as additional insureds (insurance-spec
 * §12 R-3): the wording of 765 ILCS 605/12(i), which requires it for
 * contracts over $10,000 a year. Asked for on every certificate request.
 */
export const ADDITIONAL_INSUREDS = "the association, its board of directors, and its managing agent";

export function coiRequestDraft(ctx: DraftContext): Draft {
  const { displayName, legalName, address } = ctx.association;
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    `Before any more work at ${displayName}, could you send us a current certificate of insurance showing your general liability (and workers' compensation, if you have employees)?`,
    "",
    `Please name ${legalName} as the certificate holder${filled(address) ? `, ${filled(address)}` : ""}, and list ${ADDITIONAL_INSUREDS} as additional insured parties.`,
    "",
    "A PDF reply to this email is perfect.",
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `${displayName}: certificate of insurance`, body };
}

/** Certificate and W-9 in one email, when neither is on file. */
export function paperworkRequestDraft(ctx: DraftContext, w9Url: string | null): Draft {
  const { displayName, legalName, address } = ctx.association;
  const form = filled(w9Url) ? ` (the form is here: ${filled(w9Url)})` : " (from irs.gov, search for Form W-9)";
  const body = [
    greeting(ctx.contractor.contactName),
    "",
    `Before work at ${displayName}, we need two things for our records:`,
    `- a current certificate of insurance showing your general liability (and workers' compensation, if you have employees), naming ${legalName} as the certificate holder${filled(address) ? `, ${filled(address)}` : ""} and ${ADDITIONAL_INSUREDS} as additional insured parties`,
    `- a completed Form W-9, so we can prepare a 1099-NEC${form}`,
    "",
    "A PDF reply to this email is perfect.",
    "",
    signOff(ctx),
  ].join("\n");
  return { subject: `${displayName}: paperwork before work starts`, body };
}

/** Greeting, two blank lines (the editor puts the cursor on line 3), sign-off. */
export function generalDraft(ctx: DraftContext, about: string | null): Draft {
  return {
    subject: `${filled(about) ?? "A question"}, ${ctx.association.displayName}`,
    body: [greeting(ctx.contractor.contactName), "", "", signOff(ctx)].join("\n"),
  };
}

const SERVICE_WORD = { water: "Water", heat: "Heat", power: "Power", gas: "Gas" } as const;

/** For owners: who is coming, when, and what they need. Recipients are chosen by the caller (section 5.6). */
export function ownerNoticeDraft(ctx: Omit<DraftContext, "contractor">, visit: {
  contractorName: string | null; title: string; where: string; date: string; window: string | null;
  serviceOff: { what: "water" | "heat" | "power" | "gas"; from: string; to: string } | null;
  needsUnitAccess: boolean;
}): Draft {
  const { displayName } = ctx.association;
  const when = emailDate(visit.date);
  const window = filled(visit.window);
  const lines = [
    "Hello,",
    "",
    `${filled(visit.contractorName) ?? "A contractor"} will be at ${displayName} on ${when}${window ? `, ${window}` : ""} to work on: ${visit.title} (${visit.where}).`,
  ];
  if (visit.serviceOff) {
    lines.push(`${SERVICE_WORD[visit.serviceOff.what]} will be off from ${visit.serviceOff.from} to ${visit.serviceOff.to}.`);
  }
  if (visit.needsUnitAccess) lines.push("We need access to your unit. Reply if that time doesn't work.");
  lines.push("", signOff(ctx, false));
  return { subject: `${displayName}: contractor visit on ${when}`, body: lines.join("\n") };
}

/** Words for a phone call, built from the same facts as the email. Shown on screen, not a Draft. */
export function callScript(job: { title: string; where: string }): string {
  return `Job: ${job.title}. Where: ${job.where}. Ask: can you take it on, when could you come, what would you charge, any deposit, and do you carry liability insurance?`;
}
