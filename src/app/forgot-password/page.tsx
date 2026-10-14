import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata = { title: "Reset your password — Walkup" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-ink underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
