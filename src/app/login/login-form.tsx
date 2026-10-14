"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "./actions";
import { ResendLink } from "@/components/auth/resend-link";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);

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
        <div className="flex items-baseline justify-between">
          <label htmlFor="password" className={authLabel}>
            Password
          </label>
          <Link href="/forgot-password" className="text-[13px] font-medium text-mute underline-offset-2 hover:text-ink hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={authInput}
        />
      </div>

      {state?.error ? (
        <p className={authError}>
          {state.error}
          {"unconfirmedEmail" in state && state.unconfirmedEmail ? (
            <>
              {" "}
              <ResendLink email={state.unconfirmedEmail} />
            </>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className={authButton}
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
