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
