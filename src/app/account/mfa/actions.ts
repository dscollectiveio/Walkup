"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function verifyEnrollment(_prev: unknown, formData: FormData) {
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

  redirect("/");
}
