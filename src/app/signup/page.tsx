import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your account — Walkup" };

export default function SignupPage() {
  return (
    <AuthShell
      step={0}
      title="Create your account"
      subtitle="Free during early access. No card needed — you'll set up your building in the next two steps."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-ink underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
