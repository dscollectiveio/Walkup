import { redirect } from "next/navigation";
import { safeNext } from "@/lib/security/safe-next";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { BackToSignIn } from "@/components/auth/back-to-sign-in";
import { MfaChallengeForm } from "./mfa-challenge-form";

export const dynamic = "force-dynamic";

/**
 * Second step of every sign-in once a factor is enrolled. proxy.ts sends a
 * password-verified (AAL1) session here whenever a verified TOTP factor
 * exists but this session hasn't cleared a challenge yet.
 */
export default async function MfaChallengePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factor = factorsData?.all.find(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );

  if (!factor) {
    redirect("/account/mfa");
  }

  return (
    <AuthShell
      title="Enter your code"
      footer={<BackToSignIn />}
      subtitle="Open your authenticator app and enter the current 6-digit code for Walkup."
      aside={{
        heading: "Almost there.",
        body: "Two-step sign-in protects the books if a password is stolen.",
      }}
    >
      <MfaChallengeForm factorId={factor.id} next={safeNext(next, "") || undefined} />
    </AuthShell>
  );
}
