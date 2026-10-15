/**
 * Why a message was left out, in words a board member reads (money spec 8.4).
 * The keys are the skip_reason values written by 0055.
 */
export const SKIP_REASON_WORDS: Record<string, string> = {
  no_email: "no email address",
  suppressed: "address blocked after a bounce",
  opted_out: "opted out",
  weekly_cap: "already emailed this week",
  daily_cap: "daily limit reached",
  platform_cap: "busy, try again later",
  balance_changed: "balance changed since you prepared it",
  address_changed: "address changed",
  sending_off: "sending was turned off",
  left_out: "you left them out",
  cancelled: "cancelled",
  unknown_outcome: "Walkup could not confirm it was delivered",
};

export function skipReasonWords(reason: string | null | undefined): string {
  if (!reason) return "left out";
  return SKIP_REASON_WORDS[reason] ?? "left out";
}

/** Plural-aware words for the review page's summary: "no email address (1)", "opted out (2)". */
export function skipSummary(counts: { reason: string; n: number }[]): string {
  return counts.map((c) => `${skipReasonWords(c.reason)} (${c.n})`).join(", ");
}

/** The outbox status in the words the send log shows. */
export function statusWords(status: string, opts: { manual?: boolean; reason?: string | null; error?: string | null }): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "queued":
      return "Waiting to send";
    case "sending":
      return "Sending";
    case "sent":
      return opts.manual ? "Marked sent by hand" : "Sent";
    case "delivered":
      return "Delivered";
    case "bounced":
      return "Bounced";
    case "complained":
      return "Spam report";
    case "failed":
      return opts.error ? `Failed: ${opts.error}` : "Failed";
    case "skipped":
      return `Skipped: ${skipReasonWords(opts.reason)}`;
    case "cancelled":
      return opts.reason === "left_out" ? "Left out" : "Cancelled";
    default:
      return status;
  }
}
