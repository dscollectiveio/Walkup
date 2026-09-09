import Link from "next/link";
import { Lockup } from "@/components/mark";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm py-16">
      <Lockup />
      <p className="mt-4 text-mute">Create your building&rsquo;s account.</p>

      <SignupForm />

      <p className="mt-4 text-[13px] text-mute">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
