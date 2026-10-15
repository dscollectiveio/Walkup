// Words for the Quotes & emails tab, the Marketplace and the contact page
// (insurance-spec §9.6, §9.7, §9.11). Pure, client-safe: no server imports,
// so the client rows and the unit tests share one copy.

import { shortDate } from "@/lib/dates";
import { centsOrNull, formatMoney } from "@/lib/insurance/format";
import { fromCents } from "@/lib/money/cents";
import type { ChipTone } from "./components/status-chip";

const DAY_MS = 86_400_000;

/** Whole days from a to b (dates or timestamps; date parts only). */
function daysFrom(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** a + n days, as YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  const d = new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export type RequestStatus = "draft" | "sent" | "quote_received" | "declined" | "expired" | "accepted";

/** The request's status chip (§9.7 item 2). */
export function requestChip(status: string, sentAt: string | null, todayIso: string): { tone: ChipTone; text: string } {
  switch (status) {
    case "draft":
      return { tone: "info", text: "Draft ready" };
    case "sent":
      return { tone: "neutral", text: sentAt ? `Sent ${shortDate(sentAt, todayIso)}` : "Sent" };
    case "quote_received":
      return { tone: "good", text: "Quote received" };
    case "declined":
      return { tone: "neutral", text: "Declined" };
    case "expired":
      return { tone: "neutral", text: "Expired" };
    case "accepted":
      return { tone: "good", text: "Chosen" };
    default:
      return { tone: "neutral", text: status };
  }
}

/** "Write a follow-up" opens 7 days after the request was sent. */
export const FOLLOW_UP_AFTER_DAYS = 7;

export function followUpOpensOn(sentAt: string): string {
  return addDays(sentAt, FOLLOW_UP_AFTER_DAYS);
}

export function canFollowUp(sentAt: string | null, todayIso: string): boolean {
  return sentAt !== null && followUpOpensOn(sentAt) <= todayIso;
}

/** "Valid until Mar 1" / "Expires in 3 days" / "Expired" (§9.7 item 3). */
export function validityText(validUntil: string | null, todayIso: string): { text: string; warning: boolean } | null {
  if (!validUntil) return null;
  const days = daysFrom(todayIso, validUntil);
  if (days < 0) return { text: "Expired", warning: true };
  if (days === 0) return { text: "Expires today", warning: true };
  if (days <= 7) return { text: days === 1 ? "Expires in 1 day" : `Expires in ${days} days`, warning: true };
  return { text: `Valid until ${shortDate(validUntil, todayIso)}`, warning: false };
}

/** "+12% vs now", "−8% vs now", "Same as now", or null when either side is missing or now is zero. Whole percent. */
export function premiumVsNow(quotePremium: string | null, nowPremium: string | null): string | null {
  const q = centsOrNull(quotePremium);
  const n = centsOrNull(nowPremium);
  if (q === null || n === null || n === 0) return null;
  if (q === n) return "Same as now";
  const pct = Math.round((Math.abs(q - n) * 100) / n);
  if (pct === 0) return "Same as now";
  return q > n ? `+${pct}% vs now` : `−${pct}% vs now`;
}

/** The kind words on an email row (§9.7 item 4). */
export const MESSAGE_KIND_LABEL: Record<string, string> = {
  quote_request: "Quote request",
  quote_follow_up: "Follow-up",
  coverage_question: "Coverage question",
  certificate_request: "Certificate request",
  claim_report: "Claim report",
  change_request: "Change request",
  documents_request: "Documents request",
  quote_decline: "Thank-you for a quote",
  other: "Email",
};

export function messageStatusText(status: string, sentAt: string | null, todayIso: string): string {
  if (status === "sent") return sentAt ? `Sent ${shortDate(sentAt, todayIso)}` : "Sent";
  if (status === "cancelled") return "Cancelled";
  return "Draft";
}

/** The line above a draft: who wrote it. */
export function draftedByLine(draftedBy: string): string {
  if (draftedBy === "model") return "Drafted by Walkup";
  if (draftedBy === "board") return "Edited by you";
  return "From Walkup's template";
}

/** The contact's source badge (§9.6 item 3). */
export function contactSourceBadge(source: string, foundAt: string | null, todayIso: string): string {
  switch (source) {
    case "web":
      return foundAt ? `Found on the web ${shortDate(foundAt, todayIso)}` : "Found on the web";
    case "policy":
      return "From a policy";
    case "partner":
      return "Listed with Walkup";
    default:
      return "Added by you";
  }
}

export const CONTACT_KIND_LABEL: Record<string, string> = {
  agency: "Agency", agent: "Agent", broker: "Broker", insurer: "Insurer", adjuster: "Adjuster", other: "Other",
};

/** Money text rounded up to the next $10,000 (the crime limit prefill, §9.7.2). Null for blank or junk. */
export function roundUpTo10k(money: string | null): string | null {
  const cents = centsOrNull(money);
  if (cents === null || cents <= 0) return null;
  const step = 1_000_000; // $10,000 in cents
  return fromCents(Math.ceil(cents / step) * step);
}

/** "$2,400,000" for an input's starting text, from money text. */
export function moneyInputText(money: string | null): string {
  return money ? (formatMoney(money) ?? "") : "";
}

/** A host name for a link label ("acme-insurance.com"). */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
