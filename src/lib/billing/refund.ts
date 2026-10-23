import { escapeHtml } from "@/lib/email-outbox/sanitize";
import { SITE_URL } from "@/lib/site-config";

/**
 * The yearly refund request and the offer shown before it (DECISIONS #44, #53, migration 0087). Pure words. No em
 * dashes: the offer is read by customers.
 */

/** Days after a yearly charge in which a full refund can be requested (the Terms). */
export const REFUND_WINDOW_DAYS = 14;

/** What the pop-up offers before a refund request can be sent (Doug's offer, DECISIONS #53). */
export const REFUND_OFFER = {
  headline: "Before you go: stay, and get 2 months free",
  body: "Stay with Walkup and we'll give you 2 free months, then $15 a month for the following 4 months.",
  fine: "We set this up by hand, and email you to confirm it. Nothing changes until you hear from us.",
  take: "Take the offer",
  decline: "No thanks, I still want a refund",
} as const;

export type RefundKind = "refund" | "offer";

export interface RefundEligibility {
  eligible: boolean;
  /** YYYY-MM-DD the yearly plan was charged, and the last day to ask. */
  chargedOn: string | null;
  until: string | null;
  /** A request that is already with us, if any. */
  openKind: RefundKind | null;
}

export function refundEligibilityFromRow(row: Record<string, unknown> | null | undefined): RefundEligibility | null {
  if (!row) return null;
  const s = (k: string) => (typeof row[k] === "string" ? (row[k] as string).slice(0, 10) : null);
  const open = row.open_kind;
  return {
    eligible: row.eligible === true,
    chargedOn: s("charged_on"),
    until: s("until"),
    openKind: open === "refund" || open === "offer" ? open : null,
  };
}

/** The note to support when a board admin sends a request. Plain text and HTML, the same words. */
export function renderRefundNotice(input: {
  kind: RefundKind;
  associationName: string;
  requesterName: string | null;
  planName: string | null;
  chargedOn: string | null;
  reason: string | null;
}): { subject: string; text: string; html: string } {
  const what = input.kind === "offer" ? "took the stay offer" : "asked for a yearly refund";
  const subject = `${input.associationName} ${what}`;
  const lines = [
    `${input.requesterName ?? "A board admin"} at ${input.associationName} ${what}.`,
    input.planName ? `Plan: ${input.planName}, yearly${input.chargedOn ? `, charged ${input.chargedOn}` : ""}.` : "",
    input.kind === "offer"
      ? "To do: email them to confirm 2 free months, then $15 a month for 4 months, and set it up in Stripe."
      : "To do: refund the yearly charge in Stripe (it is inside the 14 days), then mark the request done.",
    input.reason ? `Their note: ${input.reason}` : "",
    `Open it: ${SITE_URL}/admin/billing`,
  ].filter(Boolean);
  const text = lines.join("\n\n");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#ffffff;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:15px;color:#1f2937;">` +
    lines.map((l) => `<p style="margin:0 0 16px;line-height:1.5;">${escapeHtml(l)}</p>`).join("") +
    `</div></body></html>`;
  return { subject, text, html };
}
