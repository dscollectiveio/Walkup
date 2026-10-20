import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { makeCodeSet } from "./recovery-codes";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Checks a 6-digit authenticator code against the signed-in person's verified
 * factor. On success the session is refreshed with a new two-step timestamp,
 * which is what "fresh" means to the database (mfa_totp_age_seconds) and to
 * freshSignInError. Null when accepted, otherwise a message safe to show.
 */
export async function verifyTotpCode(supabase: Supabase, rawCode: string): Promise<string | null> {
  const code = rawCode.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return "Enter the 6-digit code from your authenticator app.";

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.all.find((f) => f.factor_type === "totp" && f.status === "verified");
  if (!factor) return "No authenticator app is set up on this account.";

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError || !challenge) return "Couldn't start verification. Try again.";

  const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
  return error ? "That code wasn't accepted." : null;
}

/**
 * Makes ten new recovery codes, stores only their hashes (replacing any
 * earlier set) and returns the plaintext for the caller to show once. The
 * database refuses unless this session entered an authenticator code in the
 * last 15 minutes. Never log the result.
 */
export async function issueRecoveryCodes(supabase: Supabase): Promise<{ codes: string[] } | { error: string }> {
  const set = await makeCodeSet();
  const { error } = await supabase.rpc("mfa_recovery_set_codes", { p_salts: set.salts, p_hashes: set.hashes });
  if (error) {
    return {
      error: /fresh code|two-step/i.test(error.message)
        ? "Enter a fresh code from your authenticator app and try again."
        : "Couldn't save your recovery codes. Try again.",
    };
  }
  return { codes: set.codes };
}
