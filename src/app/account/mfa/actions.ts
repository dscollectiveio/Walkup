"use server";

import { createClient } from "@/lib/supabase/server";
import { issueRecoveryCodes } from "@/lib/security/mfa-server";

export type EnrollmentResult =
  | { error: string }
  | {
      /** Enrolment worked. Codes are shown once, then dropped. */
      done: true;
      codes: string[] | null;
      codesError?: string;
    }
  | null;

export async function verifyEnrollment(_prev: unknown, formData: FormData): Promise<EnrollmentResult> {
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
    return { error: "That code wasn't accepted. Check the time on your phone and try again." };
  }

  // Two-step sign-in is on. Make the recovery codes now, while the code just
  // entered counts as fresh. If this step fails the person is still enrolled
  // and can make codes from Account > Security.
  const issued = await issueRecoveryCodes(supabase);
  if ("error" in issued) return { done: true, codes: null, codesError: issued.error };
  return { done: true, codes: issued.codes };
}
