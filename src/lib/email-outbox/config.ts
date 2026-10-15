import { LEGAL_ADDRESS } from "@/lib/site-config";

/**
 * Whether Walkup may send email at all (DECISIONS #36, money spec 2.3).
 * Server only: it reads the environment.
 *
 * Not ok means the app still works: drafts are prepared and reviewed, and a
 * board member opens each in their own mail app (`mailto:`) and marks it sent.
 */
export type SendConfig =
  | { ok: true; apiKey: string; from: string }
  | { ok: false; reason: NotConfiguredReason };

export type NotConfiguredReason = "no_key" | "disabled" | "no_legal_address";

/** The verified Resend sender. Replies never go here; they go to the association's board contact. */
export const DEFAULT_FROM_ADDRESS = "notifications@walkuphoa.com";

/** Resend allows a few requests a second; stay well under two. */
export const SEND_INTERVAL_MS = 600;
/** Rows claimed from the outbox per round trip. */
export const CLAIM_BATCH_SIZE = 10;
/** One request or cron run stops sending after this long and leaves the rest queued. */
export const SENDER_TIME_BUDGET_MS = 240_000;
/** The database stops retrying at three attempts (email_mark_failed). */
export const MAX_ATTEMPTS = 3;

const BARE_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export function isTodoPlaceholder(value: string): boolean {
  return value.trim() === "" || value.startsWith("TODO");
}

export function sendConfig(
  env: Record<string, string | undefined> = process.env,
  legalAddress: string = LEGAL_ADDRESS,
): SendConfig {
  if ((env.EMAIL_SENDING_DISABLED ?? "").trim() === "1") return { ok: false, reason: "disabled" };
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, reason: "no_key" };
  if (isTodoPlaceholder(legalAddress)) return { ok: false, reason: "no_legal_address" };
  const configured = (env.EMAIL_FROM_ADDRESS ?? "").trim().toLowerCase();
  const from = BARE_ADDRESS.test(configured) ? configured : DEFAULT_FROM_ADDRESS;
  return { ok: true, apiKey, from };
}

export function notConfiguredCopy(reason: NotConfiguredReason): string {
  if (reason === "no_legal_address") {
    return "Walkup's mailing address isn't set yet, which every email must carry. Emails stay drafts until it is.";
  }
  return "Sending from Walkup isn't set up on this account, so emails are drafts you open in your own email app.";
}
