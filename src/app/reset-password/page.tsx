import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a new password — Walkup" };

/**
 * Reached from a password-reset email (via /auth/confirm, which signs the
 * person in) and, for accounts with two-step sign-in, after their code —
 * proxy.ts sends them through the challenge and back here.
 */
export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/forgot-password");
  return (
    <AuthShell title="Choose a new password" subtitle={`For ${user.email ?? "your account"}.`}>
      <ResetPasswordForm />
    </AuthShell>
  );
}
