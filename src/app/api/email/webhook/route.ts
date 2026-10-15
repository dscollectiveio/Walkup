import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { serviceRpc } from "@/lib/email-outbox/service-rpc";
import { verifySvix } from "@/lib/email-outbox/svix";
import { scrubDetail } from "@/lib/email-outbox/webhook-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RECORDED = new Set(["email.delivered", "email.bounced", "email.complained", "email.delivery_delayed", "email.failed"]);

/**
 * Resend's delivery webhook (money spec 5.3). Public by necessity (Resend has
 * no session), so it trusts nothing until the Svix signature over the exact
 * raw body checks out. A valid event is recorded through email_record_event
 * (service key, six-function allowlist): delivered, bounced (an address that
 * hard-bounced or complained is blocked from then on), delayed or failed.
 *
 * Responses: 400 for a bad signature (no database call), 500 when the secret is
 * missing or our own database call fails (Resend retries), 200 for every valid
 * delivery including events for messages Walkup did not send, which Resend
 * reports too (Supabase Auth's account emails).
 */
export async function POST(request: NextRequest) {
  const raw = await request.text(); // exact bytes: the signature covers them
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "RESEND_WEBHOOK_SECRET is not configured." }, { status: 500 });

  const id = request.headers.get("svix-id");
  const ok = verifySvix({
    secret,
    id,
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body: raw,
  });
  if (!ok || !id) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event: { type?: unknown; data?: Record<string, unknown> };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }
  const type = typeof event.type === "string" ? event.type : "";
  const data = (event.data ?? {}) as { email_id?: unknown; bounce?: { type?: unknown; message?: unknown }; reason?: unknown };
  const emailId = typeof data.email_id === "string" ? data.email_id : "";
  if (!RECORDED.has(type) || !emailId) return NextResponse.json({ ok: true });

  const bounceMessage = typeof data.bounce?.message === "string" ? data.bounce.message : typeof data.reason === "string" ? data.reason : "";
  const result = await serviceRpc("email_record_event", {
    p_provider_message_id: emailId,
    p_event: type,
    p_detail: scrubDetail(bounceMessage),
    p_svix_id: id,
    p_permanent: type !== "email.bounced" || data.bounce?.type === "Permanent",
  });
  if (result.error) {
    console.error("[walkup-email] record_event_failed", result.error.code ?? "-");
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
