import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { MfaSetupForm } from "./mfa-setup-form";

export const dynamic = "force-dynamic";

/**
 * Forced enrollment step. proxy.ts sends every signed-in user here until
 * they have a verified TOTP factor — Walkup requires MFA for everyone, not
 * just board_admin, per the 2026-08-05 decision to answer Plaid's security
 * questionnaire honestly rather than leave this page unbuilt.
 */
export default async function MfaSetupPage() {
  const supabase = await createClient();

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const totpFactors = factorsData?.all.filter((f) => f.factor_type === "totp") ?? [];

  const verified = totpFactors.find((f) => f.status === "verified");
  if (verified) {
    redirect("/");
  }

  // Clear abandoned attempts before starting fresh — Supabase caps how many
  // unverified factors one account can hold, and a stale one from a reload
  // would otherwise make enroll() fail.
  const stale = totpFactors.filter((f) => f.status === "unverified");
  for (const staleFactor of stale) {
    await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });
  }

  const { data: enrolled, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Walkup ${new Date().toISOString().slice(0, 10)}`,
  });

  if (error || !enrolled) {
    return (
      <AuthShell step={1} title="Couldn't start two-step sign-in" subtitle={error?.message ?? "Try refreshing the page."}>
        <a href="/account/mfa" className="font-semibold text-ink underline underline-offset-2">Try again</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      step={1}
      title="Secure your account"
      subtitle={
        <>
          Walkup holds your association&rsquo;s financial records, so every account uses two-step sign-in. Scan this
          code with an authenticator app — Apple Passwords, Google Authenticator, 1Password or Authy — then enter the
          6-digit code it shows.
        </>
      }
      aside={{
        heading: "One extra step keeps the books safe.",
        body: "From now on, signing in is your password plus a code from your phone. It takes seconds, and it means a leaked password alone can't open your association's records.",
      }}
    >
      <MfaSetupForm factorId={enrolled.id} qrCode={enrolled.totp.qr_code} secret={enrolled.totp.secret} />
    </AuthShell>
  );
}
