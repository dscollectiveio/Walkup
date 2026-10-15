import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildingTodayIso } from "@/lib/dates";
import { SENDER_TIME_BUDGET_MS, sendConfig } from "@/lib/email-outbox/config";
import { senderSite } from "@/lib/email-outbox/deps";
import { resendSender, runSender, type SenderDeps } from "@/lib/email-outbox/send-batch";
import { serviceRpc } from "@/lib/email-outbox/service-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sending a few dozen messages at under two a second can outlast the default limit.
export const maxDuration = 300;

/** Constant-time check of the bearer secret; hashing first keeps the length from leaking. */
function bearerMatches(header: string | null, secret: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Daily standing-rule run (DECISIONS #36, money spec 5.2). Vercel Cron calls
 * it with `Authorization: Bearer $CRON_SECRET`; there is no signed-in person,
 * so it uses the service key, and only through serviceRpc(), which can call
 * six named functions and cannot read a table. What it may send is decided in
 * SQL: rules a board admin switched on, one email per person per week, the
 * daily and hourly limits, never to an opted-out or bounced address.
 *
 * It also finishes plain reminders left queued by a manual batch whose sender
 * died. Statements and announcements need a signed-in session (PDF, text), so
 * they wait for "Resume sending" on the review page.
 *
 * Calling it twice in a day sends nothing new: each rule runs once a day
 * (reminder_rules.last_run_on) and each message is claimed once.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = sendConfig();
  if (!config.ok) return NextResponse.json({ skipped: config.reason });

  const today = buildingTodayIso();
  const rules = await serviceRpc<{ association_id: string; batch_id: string; queued: number }[]>("email_run_rules", { p_today: today });
  if (rules.error) {
    console.error("[walkup-email] run_rules_failed", rules.error.code ?? "-");
    return NextResponse.json({ error: "Could not run the reminder rules." }, { status: 500 });
  }

  const deps: SenderDeps = {
    rpc: ((name: "email_claim" | "email_mark_sent" | "email_mark_failed", args: Record<string, unknown>) => serviceRpc(name, args)) as SenderDeps["rpc"],
    loadAnnouncement: async () => null,
    loadStatementPdf: async () => null,
    send: resendSender(config),
    sleep: wait,
    now: () => Date.now(),
    today: () => today,
  };
  const outcome = await runSender({ batchId: null, deps, config, site: senderSite, budgetMs: SENDER_TIME_BUDGET_MS, maxMessages: 150 });

  const purged = await serviceRpc<number>("email_purge", { p_months: 24 });
  if (purged.error) console.error("[walkup-email] purge_failed", purged.error.code ?? "-");

  // Counts only: no address, name or amount leaves this route.
  return NextResponse.json({
    rules: (rules.data ?? []).map((r) => ({ queued: r.queued })),
    sent: outcome.sent,
    failed: outcome.failed,
    remaining: outcome.remaining,
    stoppedBecause: outcome.stoppedBecause,
    purged: purged.data ?? 0,
  });
}
