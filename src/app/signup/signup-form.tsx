"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import Link from "next/link";
import { useActionState } from "react";
import { signUp } from "../login/actions";
import { ResendLink } from "@/components/auth/resend-link";
import { PasswordInput } from "@/components/auth/password-input";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUp, null);

  if (state?.checkEmail) {
    return (
      <div className="rounded-xl border border-good-line bg-good-tint px-5 py-5 text-good-text">
        <p className="text-[16px] font-semibold">Check your email</p>
        <p className="mt-1.5 text-[14px] leading-relaxed">
          If <strong>{state.email}</strong> isn&rsquo;t already registered, a confirmation link is on its way. Open it on
          this device and you&rsquo;ll come straight back here to finish setting up. Already have an account?{" "}
          <Link href="/login" className="font-semibold underline underline-offset-2">Sign in</Link>.
        </p>
        <p className="mt-3 text-[13px] text-good-text/90">
          Nothing after a few minutes? Check spam, or <ResendLink email={state.email} />
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="email" className={authLabel}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={authInput}
        />
      </div>

      <div>
        <label htmlFor="password" className={authLabel}>
          Password
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={12}
          className={authInput}
        />
        <p className="mt-1.5 text-[12px] text-mute">At least 12 characters. A few random words works well.</p>
      </div>

      <div>
        <label htmlFor="confirm_password" className={authLabel}>
          Confirm password
        </label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          minLength={12}
          className={authInput}
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id="privacy_consent"
          name="privacy_consent"
          type="checkbox"
          required
          className="mt-0.5 h-4 w-4 rounded border-line-strong accent-ink"
        />
        <label htmlFor="privacy_consent" className="text-[13px] text-mute">
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="text-ink underline-offset-2 hover:underline">
            Terms of Service
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank" className="text-ink underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          .
        </label>
      </div>

      {state?.error ? (
        <p className={authError}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={authButton}
      >
        {pending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
