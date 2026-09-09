import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Lockup } from "@/components/mark";
import { MfaChallengeForm } from "./mfa-challenge-form";

export const dynamic = "force-dynamic";

/**
 * Second step of every sign-in once a factor is enrolled. proxy.ts sends a
 * password-verified (AAL1) session here whenever a verified TOTP factor
 * exists but this session hasn't cleared a challenge yet.
 */
export default async function MfaChallengePage() {
  const supabase = await createClient();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const factor = factorsData?.all.find(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );

  if (!factor) {
    redirect("/account/mfa");
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
        Enter your authentication code
      </h1>
      <p className="mt-2 text-mute">
        Open your authenticator app and enter the current 6-digit code for
        Walkup.
      </p>
      <MfaChallengeForm factorId={factor.id} />
    </div>
  );
}
