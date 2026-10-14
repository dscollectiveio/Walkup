"use client";

import { useActionState } from "react";
import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { requestPasswordReset } from "../login/actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);

  if (state && "ok" in state) {
    return (
      <div className="rounded-xl border border-good-line bg-good-tint px-5 py-5 text-good-text">
        <p className="text-[16px] font-semibold">Check your email</p>
        <p className="mt-1.5 text-[14px] leading-relaxed">
          If <strong>{state.email}</strong> has a Walkup account, a reset link is on its way. Open it in this browser.
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
        <input id="email" name="email" type="email" autoComplete="email" required autoFocus className={authInput} />
      </div>
      {state?.error ? <p className={authError}>{state.error}</p> : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
