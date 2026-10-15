import { tagValue } from "./sanitize";

/**
 * Resend's HTTP API with fetch; no SDK (money spec 4.3). One recipient per
 * call. The error text is Resend's own `message`, cut to 300 characters; the
 * body of the email is never put in an error or a log.
 */

export interface ResendSend {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
  /** List-Unsubscribe and List-Unsubscribe-Post. */
  headers: Record<string, string>;
  attachments?: { filename: string; content: string }[];
  tags: { name: string; value: string }[];
  /** wk-{outbox id} */
  idempotencyKey: string;
}

export type ResendResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; status: number; message: string; retryAfterMs?: number };

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 15_000;

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

export async function sendViaResend(apiKey: string, msg: ResendSend, fetchImpl: typeof fetch = fetch): Promise<ResendResult> {
  const body = {
    from: msg.from,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    reply_to: [msg.replyTo],
    headers: msg.headers,
    ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
    tags: msg.tags.map((t) => ({ name: tagValue(t.name), value: tagValue(t.value) })),
  };

  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": msg.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    const name = (cause as { name?: string } | null)?.name;
    return {
      ok: false,
      retryable: true,
      status: 0,
      message: name === "TimeoutError" || name === "AbortError" ? "The email service took too long to answer." : "Could not reach the email service.",
    };
  }

  let payload: { id?: unknown; message?: unknown; name?: unknown } = {};
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    // an empty or non-JSON body: classified by status below
  }

  if (res.ok) {
    if (typeof payload.id === "string" && payload.id) return { ok: true, id: payload.id };
    return { ok: false, retryable: true, status: res.status, message: "The email service did not return a message id." };
  }

  const message = (typeof payload.message === "string" && payload.message ? payload.message : `The email service refused the request (${res.status}).`).slice(0, 300);
  const errName = typeof payload.name === "string" ? payload.name : "";
  const status = res.status;

  if (status === 429) return { ok: false, retryable: true, status, message, retryAfterMs: retryAfter(res.headers.get("retry-after")) };
  if (status >= 500) return { ok: false, retryable: true, status, message };
  // A request with this key is still in flight: try again later. A reused key with a different body is a bug: stop.
  if (status === 409 && errName === "concurrent_idempotent_requests") return { ok: false, retryable: true, status, message };
  return { ok: false, retryable: false, status, message };
}

export function isKeyRejected(r: ResendResult): boolean {
  return !r.ok && (r.status === 401 || r.status === 403);
}
