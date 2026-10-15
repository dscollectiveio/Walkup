import { skipSummary } from "./reasons";
import type { EmailKind } from "./facts";

/**
 * Words and counts for the review page (money spec 8.2). Pure: the page passes
 * in the outbox rows of one batch.
 */
export interface BatchRow {
  status: string;
  skip_reason: string | null;
}

export const SENT_LIKE = new Set(["sent", "delivered", "bounced", "complained"]);

export function reviewHeading(kind: EmailKind): string {
  switch (kind) {
    case "dues_reminder":
      return "Review reminders";
    case "late_fee_notice":
      return "Review the late fee notice";
    case "statement":
    case "annual_statement":
      return "Review statements";
    case "announcement":
      return "Review the announcement email";
  }
}

export const REVIEW_SUBLINE = "Check each email before it goes. Nothing is sent until a board admin presses Send.";

export interface BatchSummary {
  ready: number;
  leftOut: number;
  leftOutCounts: { reason: string; n: number }[];
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
  done: number;
  total: number;
}

export function summarizeBatch(rows: BatchRow[]): BatchSummary {
  const left = new Map<string, number>();
  let ready = 0;
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let waiting = 0;
  for (const r of rows) {
    if (r.status === "draft") ready += 1;
    else if (r.status === "queued" || r.status === "sending") waiting += 1;
    else if (SENT_LIKE.has(r.status)) sent += 1;
    else if (r.status === "failed") failed += 1;
    else if (r.status === "skipped") skipped += 1;
    if (r.status === "skipped" || (r.status === "cancelled" && r.skip_reason === "left_out")) {
      const key = r.skip_reason ?? "unknown";
      left.set(key, (left.get(key) ?? 0) + 1);
    }
  }
  const leftOutCounts = [...left.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason));
  const done = sent + skipped + failed;
  return {
    ready,
    leftOut: leftOutCounts.reduce((s, c) => s + c.n, 0),
    leftOutCounts,
    sent,
    skipped,
    failed,
    waiting,
    done,
    total: done + waiting,
  };
}

/** "3 people left out: no email address (1), opted out (2)" */
export function leftOutSentence(s: BatchSummary): string | null {
  if (s.leftOut === 0) return null;
  return `${s.leftOut} ${s.leftOut === 1 ? "person" : "people"} left out: ${skipSummary(s.leftOutCounts)}`;
}

export function resultSentence(s: BatchSummary): string {
  return `Sent ${s.sent}. ${s.skipped} skipped. ${s.failed} failed.`;
}
