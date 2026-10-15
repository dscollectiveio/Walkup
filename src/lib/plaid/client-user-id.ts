import { createHash } from "node:crypto";

/**
 * Plaid's `client_user_id` for a Link token: a stable, opaque id for the
 * signed-in person, so each board member has their own Plaid-side identity
 * (Returning User Experience, Plaid-side reporting). It is a SHA-256 of the
 * auth user id under a fixed label, so Plaid never receives the raw Supabase
 * id and the value is never an email, name or association id. Plaid asks that
 * it not be PII; this is not.
 */
export function plaidClientUserId(authUserId: string): string {
  if (!authUserId) throw new Error("plaidClientUserId needs a signed-in user id.");
  return createHash("sha256").update(`walkup:plaid-client-user:${authUserId}`).digest("hex");
}
