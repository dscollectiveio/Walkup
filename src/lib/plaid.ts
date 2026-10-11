import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Server-only Plaid client. PLAID_SECRET must never reach the browser —
 * same reasoning as the Supabase service-role key, which is why this file
 * carries the same "server-only" guard as src/lib/supabase/server.ts.
 *
 * PLAID_ENV has no default, in any environment — not even a NODE_ENV-based
 * one. A silent fallback to sandbox in production is a wrong-environment
 * bug that looks exactly like success: Link opens, a token comes back, and
 * nothing ever talks to a real bank. NODE_ENV can't stand in for "is this
 * real" either — it's "production" for `next build` locally and for every
 * Vercel Preview deploy, not just the real one. One rule, no branches. See
 * DECISIONS #27.
 */
export function plaidClient() {
  const env = process.env.PLAID_ENV;
  const validEnvs = Object.keys(PlaidEnvironments);
  if (!env) {
    throw new Error(`PLAID_ENV is not set. It must be one of: ${validEnvs.join(", ")}.`);
  }
  if (!(env in PlaidEnvironments)) {
    throw new Error(`PLAID_ENV must be one of ${validEnvs.join(", ")} — got "${env}".`);
  }

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      `Missing ${!clientId ? "PLAID_CLIENT_ID" : "PLAID_SECRET"} — Plaid calls would otherwise ` +
        `send an "undefined" header and fail with a confusing error deep inside the SDK.`,
    );
  }

  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": clientId,
          "PLAID-SECRET": secret,
        },
      },
    }),
  );
}

/**
 * True when Plaid refused because this client isn't approved for a product
 * (e.g. real-time Balance in production, which Plaid enables per account —
 * sandbox allows everything). A fixable account setting, not a bug, so
 * callers can fall back rather than fail.
 */
export function isProductNotEnabled(cause: unknown): boolean {
  const data = (cause as { response?: { data?: { error_code?: string; error_message?: string } } })?.response?.data;
  if (!data) return false;
  return (
    data.error_code === "INVALID_PRODUCT" ||
    data.error_code === "PRODUCT_NOT_ENABLED" ||
    /not authorized to access the following products/i.test(data.error_message ?? "")
  );
}

/**
 * True when the bank wants the person to sign in again — expired consent, a
 * changed password, a locked account, or access the bank withdrew. Retrying
 * cannot fix any of these; reopening Plaid Link in update mode can, so
 * callers show "Reconnect" instead of an error.
 */
export function isLoginRequired(cause: unknown): boolean {
  const code = (cause as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
  return code === "ITEM_LOGIN_REQUIRED" || code === "ITEM_LOCKED" || code === "ACCESS_NOT_GRANTED";
}

/** Plaid's own error shape carries a plain-English display_message. Falls
 * back to something a board member can still act on when it doesn't. */
export function describePlaidError(cause: unknown): string {
  const plaidMessage = (
    cause as { response?: { data?: { error_message?: string; display_message?: string } } }
  )?.response?.data;
  return (
    plaidMessage?.display_message ??
    plaidMessage?.error_message ??
    "Couldn't reach the bank. Try again in a moment."
  );
}
