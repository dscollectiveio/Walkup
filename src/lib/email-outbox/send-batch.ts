import { parseFacts, type EmailKind } from "./facts";
import { CLAIM_BATCH_SIZE, SEND_INTERVAL_MS, SENDER_TIME_BUDGET_MS, type SendConfig } from "./config";
import { fromHeader } from "./sanitize";
import { sendViaResend, type ResendResult, type ResendSend } from "./resend";
import { render, type RenderContext } from "./templates";

/**
 * The worker loop (money spec 4.5): claim a few queued messages, build each
 * from its template, send it through Resend, record the result. Used by the
 * board admin's "Send" request (their own session) and by the daily cron (the
 * service key); the database checks every limit again at each claim, so this
 * loop cannot send what SQL would refuse.
 *
 * Never logs an address, an amount or a message body.
 */

export interface ClaimedRow {
  outbox_id: string;
  claim_token: string;
  association_id: string;
  kind: EmailKind;
  to_email: string;
  to_name: string | null;
  facts: unknown;
  board_note: string | null;
  template_key: string;
  template_version: number;
  idempotency_key: string;
  attempts: number;
  unsubscribe_token: string | null;
  association_name: string;
  reply_to_email: string;
  reply_to_name: string | null;
  batch_id: string;
  has_login: boolean;
}

type RpcResult<T> = Promise<{ data: T | null; error: { code?: string; message: string } | null }>;

export interface SenderDeps {
  rpc: <T = unknown>(name: "email_claim" | "email_mark_sent" | "email_mark_failed", args: Record<string, unknown>) => RpcResult<T>;
  loadAnnouncement: (id: string) => Promise<{ title: string; body: string; hasAttachment: boolean } | null>;
  loadStatementPdf: (unit: { unitId: string; from: string; to: string }) => Promise<Uint8Array | null>;
  send: (msg: ResendSend) => Promise<ResendResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** The building's today, YYYY-MM-DD. */
  today: () => string;
}

export interface SenderSite {
  siteUrl: string;
  legalEntity: string;
  legalAddress: string;
}

export interface SenderOutcome {
  sent: number;
  failed: number;
  /** Skips are recorded by the database itself; callers count them from the outbox. */
  skipped: number;
  remaining: boolean;
  stoppedBecause: "empty" | "time" | "fatal" | null;
}

const MAX_RETRY_SLEEP_MS = 30_000;

function firstName(toName: string | null): string {
  const first = (toName ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export function buildContext(row: ClaimedRow, site: SenderSite, todayIso: string): RenderContext | null {
  if (!row.unsubscribe_token) return null;
  return {
    associationName: row.association_name,
    replyToName: row.reply_to_name?.trim() || "The board",
    replyToEmail: row.reply_to_email,
    recipientFirstName: firstName(row.to_name),
    hasLogin: row.has_login === true,
    siteUrl: site.siteUrl,
    unsubscribeUrl: `${site.siteUrl}/unsubscribe/${row.unsubscribe_token}`,
    legalEntity: site.legalEntity,
    legalAddress: site.legalAddress,
    boardNote: row.board_note,
    todayIso,
  };
}

export async function runSender(opts: {
  batchId: string | null;
  deps: SenderDeps;
  config: Extract<SendConfig, { ok: true }>;
  site: SenderSite;
  budgetMs?: number;
  maxMessages?: number;
}): Promise<SenderOutcome> {
  const { deps, config, site } = opts;
  const budget = opts.budgetMs ?? SENDER_TIME_BUDGET_MS;
  const max = opts.maxMessages ?? Number.POSITIVE_INFINITY;
  const started = deps.now();
  const out: SenderOutcome = { sent: 0, failed: 0, skipped: 0, remaining: false, stoppedBecause: null };
  let handled = 0;

  const markFailed = async (row: ClaimedRow, error: string, retryable: boolean) => {
    const { error: e } = await deps.rpc("email_mark_failed", {
      p_outbox_id: row.outbox_id,
      p_claim_token: row.claim_token,
      p_error: error.slice(0, 500),
      p_retryable: retryable,
    });
    if (e) console.error("[walkup-email] mark_failed_error", row.outbox_id, e.code ?? "-");
    out.failed += 1;
  };

  for (;;) {
    if (deps.now() - started >= budget || handled >= max) {
      out.stoppedBecause = "time";
      out.remaining = true;
      break;
    }
    const limit = Math.min(CLAIM_BATCH_SIZE, max - handled);
    const claimed = await deps.rpc<ClaimedRow[]>("email_claim", { p_batch_id: opts.batchId, p_limit: limit });
    if (claimed.error) {
      console.error("[walkup-email] claim_failed", claimed.error.code ?? "-");
      out.stoppedBecause = "fatal";
      out.remaining = true;
      break;
    }
    const rows = claimed.data ?? [];
    if (rows.length === 0) {
      out.stoppedBecause = "empty";
      break;
    }

    for (const row of rows) {
      handled += 1;

      const parsed = parseFacts(row.kind, row.facts);
      if (!parsed.ok) {
        await markFailed(row, "The saved details for this email could not be read.", false);
        continue;
      }
      const ctx = buildContext(row, site, deps.today());
      if (!ctx) {
        await markFailed(row, "This person has no unsubscribe link, so nothing was sent.", false);
        continue;
      }

      let extra: { announcement?: { title: string; body: string; hasAttachment: boolean } } | undefined;
      if (row.kind === "announcement") {
        const id = (parsed.parsed.data as { announcement_id: string }).announcement_id;
        const a = await deps.loadAnnouncement(id);
        if (!a) {
          await markFailed(row, "The announcement is no longer available.", false);
          continue;
        }
        extra = { announcement: a };
      }

      let rendered;
      try {
        rendered = render(row.kind, row.template_key, row.template_version, row.facts, ctx, extra);
      } catch (cause) {
        console.error("[walkup-email] render_failed", row.outbox_id, (cause as Error).name);
        await markFailed(row, "This email could not be built.", false);
        continue;
      }

      const attachments: { filename: string; content: string }[] = [];
      let pdfMissing = false;
      for (const spec of rendered.attachments ?? []) {
        const bytes = await deps.loadStatementPdf({ unitId: spec.unitId, from: spec.from, to: spec.to });
        if (!bytes) {
          pdfMissing = true;
          break;
        }
        attachments.push({ filename: spec.filename, content: Buffer.from(bytes).toString("base64") });
      }
      if (pdfMissing) {
        await markFailed(row, "Could not build the statement PDF.", true);
        continue;
      }

      const oneClick = `${site.siteUrl}/unsubscribe/${row.unsubscribe_token}/one-click`;
      const result = await deps.send({
        from: fromHeader(row.association_name, config.from),
        to: row.to_email,
        replyTo: row.reply_to_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        headers: {
          "List-Unsubscribe": `<${oneClick}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        attachments: attachments.length ? attachments : undefined,
        tags: [
          { name: "kind", value: row.kind },
          { name: "association", value: row.association_id },
          { name: "batch", value: row.batch_id },
        ],
        idempotencyKey: row.idempotency_key,
      });

      if (result.ok) {
        const { error } = await deps.rpc("email_mark_sent", {
          p_outbox_id: row.outbox_id,
          p_claim_token: row.claim_token,
          p_provider_message_id: result.id,
          p_subject: rendered.subject,
        });
        if (error) {
          // It left. The stuck-row release and the webhook reconcile, and the idempotency key keeps a retry from sending twice.
          console.error("[walkup-email] sent but not recorded", row.outbox_id);
        }
        out.sent += 1;
        await deps.sleep(SEND_INTERVAL_MS);
        continue;
      }

      if (result.status === 401 || result.status === 403) {
        console.error("[walkup-email] rejected_key");
        await markFailed(row, "rejected_key: the email service rejected Walkup's key.", true);
        out.stoppedBecause = "fatal";
        out.remaining = true;
        return out;
      }

      await markFailed(row, result.message, result.retryable);
      if (result.retryable && result.retryAfterMs) {
        if (result.retryAfterMs > MAX_RETRY_SLEEP_MS) {
          out.stoppedBecause = "fatal";
          out.remaining = true;
          return out;
        }
        await deps.sleep(result.retryAfterMs);
      } else {
        await deps.sleep(SEND_INTERVAL_MS);
      }
    }
  }
  return out;
}

/** The production wiring of `send`: Resend over fetch with the configured key. */
export function resendSender(config: Extract<SendConfig, { ok: true }>, fetchImpl?: typeof fetch): SenderDeps["send"] {
  return (msg) => sendViaResend(config.apiKey, msg, fetchImpl);
}
