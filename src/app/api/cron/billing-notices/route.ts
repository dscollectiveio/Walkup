import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { billingEnabled, priceIdFor } from "@/lib/billing/config";
import { moveSubscriptionPriceAtRenewal } from "@/lib/billing/stripe";
import { tierChangeNeeded, tierChangeReady } from "@/lib/billing/tier";
import { factsFromRow } from "@/lib/billing/entitlement-rules";
import { readOnlyNoticeNeeded, renderNoticeEmail, type NoticeKind } from "@/lib/billing/notices";
import { billingServiceRpc } from "@/lib/billing/service-rpc";
import { buildingTodayIso } from "@/lib/dates";
import { sendConfig } from "@/lib/email-outbox/config";
import { sendViaResend } from "@/lib/email-outbox/resend";
import { renderSignupAlert, type SignupPerson } from "@/lib/billing/signup-alert";
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
 * It also keeps plans in step with unit counts (migration 0088, DECISIONS #44): a building whose count moves it into
 * another tier gets a 30-day notice, and only when `BILLING_TIER_AUTO` is on does the run move the plan at Stripe,
 * on the renewal the notice named. Off by default, so no price changes until that is switched on deliberately.
 *
 * The same run tells the platform admins about any new building that signed up and has not been announced yet
 * (migration 0086), one email each.
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

  let tierNotices = 0;
  let tierMoved = 0;
  if (billingEnabled()) {
    const tiers = await billingServiceRpc<
      { association_id: string; stripe_subscription_id: string; plan_key: string | null; billing_interval: "month" | "year"; current_period_end: string; unit_count: number; notice_emailed_at: string | null }[]
    >("billing_tier_candidates", {});
    if (tiers.error) {
      console.error("[walkup-billing] tier_candidates_failed", tiers.error.code ?? "-");
    } else {
      for (const t of tiers.data ?? []) {
        const facts = { planKey: t.plan_key, interval: t.billing_interval, currentPeriodEnd: t.current_period_end, unitCount: t.unit_count, noticeEmailedAt: t.notice_emailed_at };
        const needed = tierChangeNeeded(facts, now);
        if (needed) {
          const opened = await billingServiceRpc<boolean>("billing_open_tier_notice", {
            p_association_id: t.association_id,
            p_effective_on: needed.effectiveOn,
            p_key: `tier_change:${t.association_id}:${needed.toPlan}:${needed.effectiveOn}`,
            p_detail: needed.detail,
          });
          if (opened.error) console.error("[walkup-billing] open_tier_notice_failed", opened.error.code ?? "-");
          else if (opened.data) tierNotices += 1;
        }
        const ready = process.env.BILLING_TIER_AUTO === "1" ? tierChangeReady(facts, now) : null;
        const priceId = ready ? priceIdFor(ready, t.billing_interval) : null;
        if (ready && priceId) {
          try {
            await moveSubscriptionPriceAtRenewal(t.stripe_subscription_id, priceId);
            tierMoved += 1;
          } catch (cause) {
            console.error("[walkup-billing] tier_move_failed", (cause as { status?: number }).status ?? "-");
          }
        }
      }
    }
  }

  const config = sendConfig();
  if (!config.ok) {
    return NextResponse.json({ notices: { comp: comp.data ?? 0, readOnly: readOnlyOpened, tier: tierNotices }, tierMoved, skipped: config.reason });
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

  // New signups: tell the platform admins once per building.
  let signupsAnnounced = 0;
  const signups = await billingServiceRpc<
    { association_id: string; display_name: string; city: string | null; state_code: string | null; created_at: string; people: SignupPerson[]; recipients: string[] }[]
  >("platform_signup_alerts_claim", {});
  if (signups.error) {
    console.error("[walkup-billing] signup_alerts_failed", signups.error.code ?? "-");
  } else {
    for (const b of signups.data ?? []) {
      if (!b.recipients?.length) continue;
      const mail = renderSignupAlert({ displayName: b.display_name, city: b.city, stateCode: b.state_code, createdAt: b.created_at, people: b.people ?? [] });
      let ok = true;
      for (const to of b.recipients) {
        const r = await sendViaResend(config.apiKey, {
          from: `"Walkup" <${config.from}>`,
          to,
          replyTo: SUPPORT_EMAIL,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
          headers: {},
          tags: [
            { name: "kind", value: "platform_signup" },
            { name: "association", value: "platform" },
          ],
          idempotencyKey: `wk-signup-${b.association_id}-${to}`,
        });
        if (!r.ok) {
          ok = false;
          console.error("[walkup-billing] signup_alert_send_failed", r.status);
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (ok) {
        await billingServiceRpc("platform_signup_alert_mark", { p_association_id: b.association_id });
        signupsAnnounced += 1;
      }
    }
  }

  return NextResponse.json({ notices: { comp: comp.data ?? 0, readOnly: readOnlyOpened, tier: tierNotices }, tierMoved, sent, failed, signupsAnnounced });
}
