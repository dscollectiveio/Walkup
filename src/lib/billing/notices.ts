import { buildingTodayIso, longDate } from "@/lib/dates";
import { escapeHtml } from "@/lib/email-outbox/sanitize";
import { LEGAL_ADDRESS, LEGAL_ENTITY, SITE_URL, SUPPORT_EMAIL } from "@/lib/site-config";
import { computeStatus, type BillingFacts } from "./entitlement-rules";

/**
 * The notices the Terms promise (DECISIONS #44, migration 0084). Pure: the words of each notice, the lead times,
 * who needs a read-only notice and when, and the guard that keeps a building from going read-only before it has
 * been told. The database makes the notices; the daily run (app/api/cron/billing-notices) emails them.
 *
 * No em dashes: this is customer-facing copy.
 */

export type NoticeKind = "price_change" | "read_only" | "early_access_end" | "founding_charge" | "tier_change";

/** Days of notice the Terms promise before each change. */
export const NOTICE_LEAD_DAYS: Record<NoticeKind, number> = {
  price_change: 30,
  read_only: 7,
  early_access_end: 90,
  founding_charge: 30,
  tier_change: 30,
};

export interface BillingNotice {
  id: string;
  kind: NoticeKind;
  /** YYYY-MM-DD, the day the change takes effect. */
  effectiveOn: string;
  detail: string | null;
  createdAt: string;
  emailedAt: string | null;
}

const DAY = 86_400_000;

const KINDS: readonly string[] = ["price_change", "read_only", "early_access_end", "founding_charge", "tier_change"];

/** Maps a billing_notices_for row to a notice; null for anything unreadable. */
export function noticeFromRow(row: Record<string, unknown> | null | undefined): BillingNotice | null {
  if (!row) return null;
  const kind = row.kind;
  const effective = row.effective_on;
  if (typeof kind !== "string" || !KINDS.includes(kind) || typeof effective !== "string" || typeof row.id !== "string") return null;
  return {
    id: row.id,
    kind: kind as NoticeKind,
    effectiveOn: effective.slice(0, 10),
    detail: typeof row.detail === "string" ? row.detail : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    emailedAt: typeof row.emailed_at === "string" ? row.emailed_at : null,
  };
}

/**
 * Whether a building may be made read-only now: it has to have been told, by email, at least 7 days ago. Any
 * notice that says the account stops being fully usable counts (read-only, the end of early access, the end of a
 * founding year). With no switch for enforcement this changes nothing today.
 */
export function readOnlyNoticeGiven(notices: BillingNotice[], now: Date = new Date()): boolean {
  const cutoff = now.getTime() - NOTICE_LEAD_DAYS.read_only * DAY;
  return notices.some((n) => {
    if (n.kind === "price_change" || n.kind === "tier_change" || !n.emailedAt) return false;
    const sent = Date.parse(n.emailedAt);
    return !Number.isNaN(sent) && sent <= cutoff;
  });
}

/**
 * The read-only notice a building needs today, or null. A building in its grace period (or with a failed payment
 * still being retried) is told the day read-only would start, and never less than 7 days ahead. One already past
 * all of that is told it starts in 7 days. The anchor date names the lapse, so the same lapse is only ever told once.
 */
export function readOnlyNoticeNeeded(
  facts: BillingFacts,
  now: Date = new Date(),
): { anchorOn: string; effectiveOn: string } | null {
  const { status, readOnlyFrom } = computeStatus(facts, now);
  if (status !== "past_due" && status !== "grace" && status !== "read_only") return null;
  const anchor = facts.paymentFailedAt ?? facts.currentPeriodEnd ?? facts.trialEndsAt;
  if (!anchor) return null;
  const anchorDate = new Date(anchor);
  if (Number.isNaN(anchorDate.getTime())) return null;
  const soonest = now.getTime() + NOTICE_LEAD_DAYS.read_only * DAY;
  const starts = readOnlyFrom ? Math.max(readOnlyFrom.getTime(), soonest) : soonest;
  return {
    effectiveOn: buildingTodayIso(new Date(starts)),
    anchorOn: buildingTodayIso(anchorDate),
  };
}

/**
 * The notices the board should still see: the change has not happened yet, and a read-only notice only while the
 * building is still behind (paying makes it moot).
 */
export function activeNotices(
  notices: BillingNotice[],
  computedStatus: string,
  now: Date = new Date(),
): BillingNotice[] {
  const today = buildingTodayIso(now);
  const behind = computedStatus === "past_due" || computedStatus === "grace" || computedStatus === "read_only";
  return notices
    .filter((n) => n.effectiveOn >= today && (n.kind !== "read_only" || behind))
    .sort((a, b) => a.effectiveOn.localeCompare(b.effectiveOn));
}

// ---- The words ------------------------------------------------------------------------------------------------

/** One notice as the board sees it in Walkup: a headline and one more line. */
export function noticeBanner(n: BillingNotice, now: Date = new Date()): { headline: string; detail: string; tone: "attention" | "neutral" } {
  const when = longDate(n.effectiveOn);
  const days = Math.ceil((Date.parse(`${n.effectiveOn}T12:00:00Z`) - now.getTime()) / DAY);
  const soon = days <= 14;
  switch (n.kind) {
    case "price_change":
      return {
        headline: `Walkup's price changes on ${when}.`,
        detail: `${n.detail ?? ""} The new price starts from your first renewal on or after that day. You can cancel before then from Account, Billing.`.trim(),
        tone: soon ? "attention" : "neutral",
      };
    case "read_only":
      return {
        headline: `Your building becomes read-only on ${when} unless the Walkup subscription is paid.`,
        detail: "Until then everything works. After that you and your owners can still view and download every record, and adding new ones pauses until a plan is paid for.",
        tone: "attention",
      };
    case "early_access_end":
      return {
        headline: `Free early access ends on ${when}.`,
        detail: "A board admin can choose a plan on the Billing page to keep adding records after that day. Nothing is charged unless you choose one.",
        tone: soon ? "attention" : "neutral",
      };
    case "tier_change":
      return {
        headline: `Your plan changes on ${when}.`,
        detail: `${n.detail ?? ""} Nothing changes before then, and you can turn auto-renew off on the Billing tab if you'd rather not continue.`.trim(),
        tone: soon ? "attention" : "neutral",
      };
    case "founding_charge":
      return {
        headline: `Your free founding year ends on ${when}.`,
        detail: "After that, the plan for your building's size applies. Nothing is charged unless a board admin chooses a plan on the Billing page.",
        tone: soon ? "attention" : "neutral",
      };
  }
}

export interface NoticeEmailInput {
  kind: NoticeKind;
  effectiveOn: string;
  detail: string | null;
  associationName: string;
  recipientName: string | null;
}

export interface NoticeEmail {
  subject: string;
  text: string;
  html: string;
}

function firstName(name: string | null): string {
  return (name ?? "").trim().split(/\s+/)[0] || "there";
}

/** The email for one notice to one board admin. Plain, with the same words in text and HTML. */
export function renderNoticeEmail(input: NoticeEmailInput): NoticeEmail {
  const when = longDate(input.effectiveOn);
  const billingUrl = `${SITE_URL}/account?tab=billing`;
  const assoc = input.associationName;
  let subject: string;
  let body: string[];

  switch (input.kind) {
    case "price_change":
      subject = `Walkup's price is changing on ${when}`;
      body = [
        `We're writing to let you know that Walkup's price is changing for ${assoc}.`,
        input.detail ? `What's changing: ${input.detail}` : "",
        `The new price applies from your first renewal on or after ${when}. You can cancel before then from the Billing page: ${billingUrl}`,
      ];
      break;
    case "read_only":
      subject = `${assoc} becomes read-only on ${when} unless the Walkup subscription is paid`;
      body = [
        `The Walkup subscription for ${assoc} is not paid up, so on ${when} the account will become read-only.`,
        "Until then everything works as usual. After that, you and your owners can still view and download every record. Adding new records and a few features pause until a plan is paid for. Paying restores full use straight away.",
        `To keep everything working, a board admin can pay or choose a plan here: ${billingUrl}`,
      ];
      break;
    case "early_access_end":
      subject = `Free early access for ${assoc} ends on ${when}`;
      body = [
        `Walkup has been free for ${assoc} during early access. That ends on ${when}.`,
        "You won't be charged unless a board admin chooses a plan. To keep adding records after that day, a board admin can choose the plan for your building's size on the Billing page.",
        `Choose a plan: ${billingUrl}`,
        "After that day, if no plan has been chosen, the account becomes read-only. You and your owners can still view and download every record.",
      ];
      break;
    case "tier_change":
      subject = `Your Walkup plan changes on ${when}`;
      body = [
        `We're writing to let you know that the Walkup plan for ${assoc} changes at your next renewal.`,
        input.detail ?? "",
        `The change starts on ${when}. Nothing changes before then. If you'd rather not continue, you can turn off auto-renew on the Billing page: ${billingUrl}`,
      ];
      break;
    case "founding_charge":
      subject = `Your free founding year with Walkup ends on ${when}`;
      body = [
        `Thank you for being one of Walkup's first associations. Your free founding year for ${assoc} ends on ${when}.`,
        "After that, the plan for your building's size applies, at the price on our pricing page. You won't be charged unless a board admin chooses a plan.",
        `See the plans and choose one: ${billingUrl}`,
      ];
      break;
  }
  const paragraphs = [`Hi ${firstName(input.recipientName)},`, ...body.filter(Boolean), `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`, "Thanks,\nWalkup"];
  const footer = [
    `You're getting this because you are a board admin for ${assoc} on Walkup. It's a required notice about your account, so it can't be turned off.`,
    `Walkup is operated by ${LEGAL_ENTITY}, ${LEGAL_ADDRESS}. Walkup does not collect or move money for associations, and never asks for payment details by email.`,
  ];

  const text = [...paragraphs, ["--", ...footer].join("\n")].join("\n\n");
  const link = (escaped: string) => escaped.replace(/https:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#1B2A41;">${url}</a>`);
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:15px;color:#1f2937;">` +
    `<div style="font-size:16px;font-weight:bold;color:#1B2A41;margin:0 0 20px;">Walkup</div>` +
    paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5;">${link(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`).join("") +
    `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d6dbe2;font-size:12px;line-height:1.5;color:#5f6b7a;">${footer.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}</div>` +
    `</div></body></html>`;
  return { subject, text, html };
}
