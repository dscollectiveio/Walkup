import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { pricingWords } from "@/lib/billing/launch";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Create your account | Walkup" };

export default function SignupPage() {
  return (
    <AuthShell
      step={0}
      title="Create your account"
      subtitle={pricingWords().signupSubtitle}
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="inline-flex min-h-[44px] items-center font-semibold text-ink underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
