import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSealed, openSecret, sealSecret, sealingEnabled } from "@/lib/security/secret-box";

/**
 * Reads a bank connection's Plaid access token as the signed-in board admin
 * and opens it. A token stored before sealing was switched on is returned as
 * is and sealed in place, best effort, so the database drifts to ciphertext
 * without a migration script. Errors keep Supabase's own messages: callers
 * rely on "no stored access token" to mean "already disconnected".
 */
export async function readBankToken(
  supabase: SupabaseClient,
  connectionId: string,
): Promise<{ token: string | null; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("get_bank_access_token", { p_connection_id: connectionId });
  if (error) return { token: null, error };
  if (!data) return { token: null, error: { message: "No access token on file." } };

  const stored = data as string;
  let token: string;
  try {
    token = openSecret(stored);
  } catch (cause) {
    return { token: null, error: { message: (cause as Error).message } };
  }

  if (!isSealed(stored) && sealingEnabled()) {
    // The database function only accepts this when the stored value is still
    // plain and the new one is sealed, so it can't be used to overwrite a token.
    await supabase.rpc("reseal_bank_access_token", {
      p_connection_id: connectionId,
      p_sealed: sealSecret(token),
    });
  }
  return { token, error: null };
}
