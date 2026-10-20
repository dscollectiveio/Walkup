import { AuthShell } from "@/components/auth/auth-shell";
import { safeNext } from "@/lib/security/safe-next";
import { ConfirmSignInForm } from "./confirm-sign-in-form";

export const metadata = { title: "Confirm your sign-in | Walkup" };
export const dynamic = "force-dynamic";

/**
 * Asked for before roles or invites change (SECURITY_POLICY 4d). The proxy has
 * already required a two-step session to get here; this asks for a code again
 * so the change is tied to someone at the keyboard right now.
 */
export default async function ConfirmSignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Confirm your sign-in"
      subtitle="Changing who has access to your association needs a recent code from your authenticator app. Enter the current 6-digit code, then go back and try again."
      aside={{
        heading: "A quick check before access changes.",
        body: "Roles and invites decide who can see your books, so Walkup asks for a fresh code first.",
      }}
    >
      <ConfirmSignInForm next={safeNext(next, "/building")} />
    </AuthShell>
  );
}
