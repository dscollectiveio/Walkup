import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { FRESH_SIGNIN_MESSAGE, isFreshSignIn } from "./session-policy";

/**
 * Null when this session entered a two-step code in the last 15 minutes,
 * otherwise the message to show. Read from the verified token's amr claim, so
 * there is nothing to forge client-side. Gate role changes with it
 * (syncPersonRoles, createInvite, extendAccountantAccess).
 */
export async function freshSignInError(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const amr = (data?.claims as { amr?: unknown } | undefined)?.amr;
  return isFreshSignIn(amr, Date.now()) ? null : FRESH_SIGNIN_MESSAGE;
}
