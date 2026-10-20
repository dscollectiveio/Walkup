"use server";

import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { digestsFor, minutesLeft, normalizeCode } from "@/lib/security/recovery-codes";
import { safeNext } from "@/lib/security/safe-next";

export async function verifyChallenge(_prev: unknown, formData: FormData) {
  const factorId = String(formData.get("factorId") ?? "");
  const code = String(formData.get("code") ?? "").trim();

  if (!factorId || !code) {
    return { error: "Enter the 6-digit code from your authenticator app." };
  }

  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError || !challenge) {
    return { error: challengeError?.message ?? "Couldn't start verification. Try again." };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    return { error: "That code wasn't accepted." };
  }

  redirect(safeNext(String(formData.get("next") ?? "")));
}

/**
 * Lost authenticator: spend a recovery code. The wrong-attempt count and the
 * 15-minute lock live in the database (mfa_recovery_redeem, migration 0078),
 * so they hold no matter how requests arrive. A good code removes this
 * account's authenticator and sends the person to enrol a new one, which also
 * makes a fresh set of recovery codes. The code is never logged or echoed.
 */
export async function redeemRecoveryCode(_prev: unknown, formData: FormData) {
  const code = normalizeCode(String(formData.get("recoveryCode") ?? ""));
  if (!code) return { error: "That isn't the right shape for a recovery code. They look like ABCDE-12345." };

  const supabase = await createClient();
  const user = await getUser();
  if (!user) return { error: "Your sign-in expired. Sign in again." };

  const { data: status } = await supabase.rpc("mfa_recovery_status");
  const st = status as { remaining?: number; locked_until?: string | null } | null;
  if (st?.locked_until) {
    const mins = minutesLeft({ failed: 0, lockedUntil: Date.parse(st.locked_until) }, Date.now());
    return { error: `Too many wrong codes. Try again in ${Math.max(1, mins)} minute${mins === 1 ? "" : "s"}.` };
  }
  if (!st || !st.remaining) {
    return { error: `This account has no recovery codes left. Email ${SUPPORT_EMAIL} and we will help you back in.` };
  }

  const { data: salts, error: saltError } = await supabase.rpc("mfa_recovery_salts");
  if (saltError) return { error: "Couldn't check that code. Try again." };
  const digests = await digestsFor(code, ((salts ?? []) as { salt: string }[]).map((r) => r.salt));

  const { data, error } = await supabase.rpc("mfa_recovery_redeem", { p_digests: digests });
  if (error) return { error: "Couldn't check that code. Try again." };

  const result = data as { ok: boolean; reason?: string; locked_until?: string; attempts_left?: number };
  if (!result.ok) {
    if (result.reason === "locked") {
      const mins = minutesLeft(
        { failed: 0, lockedUntil: result.locked_until ? Date.parse(result.locked_until) : null },
        Date.now(),
      );
      return { error: `Too many wrong codes. Try again in ${Math.max(1, mins)} minutes.` };
    }
    const left = result.attempts_left ?? 0;
    return { error: `That recovery code wasn't accepted. ${left} attempt${left === 1 ? "" : "s"} left before a 15 minute pause.` };
  }

  // Any other signed-in device may be the one that was lost: end those sessions.
  await supabase.auth.signOut({ scope: "others" });
  redirect("/account/mfa");
}
