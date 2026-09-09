import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Lockup } from "@/components/mark";
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
      <div className="mx-auto max-w-sm py-16">
        <Lockup />
        <h1 className="mt-4 text-[20px] font-semibold text-ink">
          Couldn&rsquo;t start MFA setup
        </h1>
        <p className="mt-2 text-mute">{error?.message ?? "Try refreshing the page."}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <h1 className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
        Set up two-factor authentication
      </h1>
      <p className="mt-2 text-mute">
        Walkup requires an authenticator app for every sign-in. Scan this code
        with one — Apple&rsquo;s Passwords app, Google Authenticator,
        1Password, etc. — then enter the 6-digit code it shows.
      </p>

      <MfaSetupForm
        factorId={enrolled.id}
        qrCode={enrolled.totp.qr_code}
        secret={enrolled.totp.secret}
      />
    </div>
  );
}
