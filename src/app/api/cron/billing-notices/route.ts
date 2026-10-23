import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { billingEnabled } from "@/lib/billing/config";
import { factsFromRow } from "@/lib/billing/entitlement-rules";
import { readOnlyNoticeNeeded, renderNoticeEmail, type NoticeKind } from "@/lib/billing/notices";
import { billingServiceRpc } from "@/lib/billing/service-rpc";
import { buildingTodayIso } from "@/lib/dates";
import { sendConfig } from "@/lib/email-outbox/config";
import { sendViaResend } from "@/lib/email-outbox/resend";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/** Constant-time check of the bearer secret; hashing first keeps the length from leaking. */
function bearerMatches(header: string | null, secret: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

interface Claimed {
  delivery_id: string;
  notice_id: string;
  kind: NoticeKind;
  effective_on: string;
  detail: string | null;
  association_name: string;
  to_email: string;
  to_name: string | null;
  attempts: number;
}

const MAX_SENDS = 100;

/**
 * Daily billing notices (DECISIONS #44, migration 0084). Vercel Cron calls it with `Authorization: Bearer
 * $CRON_SECRET`. It never sends marketing: only the notices the Terms promise, to the board admins of the
 * building the notice is about.
 *
 *   1. Comp end dates (early access, founding year) become notices.
 *   2. While billing is switched on, a building heading for read-only gets its notice.
 *   3. Every notice with an email still to go is sent, one per board admin, a few tries each.
 *
 * Calling it twice in a day sends nothing new: notices are made once (dedupe key) and a delivery is sent once.
 * Counts only leave this route; no address, name or message does.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 500 });
  if (!bearerMatches(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = buildingTodayIso(now);

  const comp = await billingServiceRpc<number>("billing_generate_comp_notices", { p_today: today });
  if (comp.error) console.error("[walkup-billing] comp_notices_failed", comp.error.code ?? "-");

  let readOnlyOpened = 0;
  if (billingEnabled()) {
    const candidates = await billingServiceRpc<Record<string, unknown>[]>("billing_notice_candidates", {});
    if (candidates.error) {
      console.error("[walkup-billing] candidates_failed", candidates.error.code ?? "-");
    } else {
      for (const row of candidates.data ?? []) {
        const facts = factsFromRow(row);
        const associationId = typeof row.association_id === "string" ? row.association_id : null;
        if (!facts || !associationId) continue;
        const needed = readOnlyNoticeNeeded(facts, now);
        if (!needed) continue;
        const opened = await billingServiceRpc<boolean>("billing_open_read_only_notice", {
          p_association_id: associationId,
          p_effective_on: needed.effectiveOn,
          p_key: `read_only:${associationId}:${needed.anchorOn}`,
        });
        if (opened.error) console.error("[walkup-billing] open_notice_failed", opened.error.code ?? "-");
        else if (opened.data) readOnlyOpened += 1;
      }
    }
  }

  const config = sendConfig();
  if (!config.ok) {
    return NextResponse.json({ notices: { comp: comp.data ?? 0, readOnly: readOnlyOpened }, skipped: config.reason });
  }

  let sent = 0;
  let failed = 0;
  const claimed = await billingServiceRpc<Claimed[]>("billing_notice_claim", { p_limit: MAX_SENDS });
  if (claimed.error) {
    console.error("[walkup-billing] claim_failed", claimed.error.code ?? "-");
    return NextResponse.json({ error: "Could not read the notices to send." }, { status: 500 });
  }

  for (const row of claimed.data ?? []) {
    const email = renderNoticeEmail({
      kind: row.kind,
      effectiveOn: row.effective_on,
      detail: row.detail,
      associationName: row.association_name,
      recipientName: row.to_name,
    });
    const result = await sendViaResend(config.apiKey, {
      from: `"Walkup" <${config.from}>`,
      to: row.to_email,
      replyTo: SUPPORT_EMAIL,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: {},
      tags: [
        { name: "kind", value: `billing_${row.kind}` },
        { name: "association", value: "billing" },
      ],
      idempotencyKey: `wk-bn-${row.delivery_id}`,
    });
    if (result.ok) {
      sent += 1;
      await billingServiceRpc("billing_notice_mark", { p_delivery_id: row.delivery_id, p_ok: true, p_error: null });
    } else {
      failed += 1;
      await billingServiceRpc("billing_notice_mark", { p_delivery_id: row.delivery_id, p_ok: false, p_error: result.message });
      if (result.status === 401 || result.status === 403) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }

  return NextResponse.json({ notices: { comp: comp.data ?? 0, readOnly: readOnlyOpened }, sent, failed });
}
