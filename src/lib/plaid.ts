import "server-only";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/**
 * Server-only Plaid client. PLAID_SECRET must never reach the browser —
 * same reasoning as the Supabase service-role key, which is why this file
 * carries the same "server-only" guard as src/lib/supabase/server.ts.
 */
export function plaidClient() {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (!(env in PlaidEnvironments)) {
    throw new Error(`PLAID_ENV must be one of sandbox, development, production — got "${env}"`);
  }

  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
        },
      },
    }),
  );
}
