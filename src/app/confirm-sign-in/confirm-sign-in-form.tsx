"use client";

import { useActionState } from "react";
import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { confirmSignIn } from "./actions";

export function ConfirmSignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(confirmSignIn, null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="code" className={authLabel}>
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          className={`${authInput} text-center text-[20px] tracking-[0.4em]`}
          placeholder="123456"
          maxLength={6}
        />
      </div>
      {state?.error ? <p className={authError}>{state.error}</p> : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Checking…" : "Confirm"}
      </button>
    </form>
  );
}
