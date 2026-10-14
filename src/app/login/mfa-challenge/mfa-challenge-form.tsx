"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState } from "react";
import { verifyChallenge } from "./actions";

export function MfaChallengeForm({ factorId, next }: { factorId: string; next?: string }) {
  const [state, action, pending] = useActionState(verifyChallenge, null);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="factorId" value={factorId} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
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
        {pending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
