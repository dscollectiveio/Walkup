"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState, useState } from "react";
import { redeemRecoveryCode, verifyChallenge } from "./actions";

export function MfaChallengeForm({ factorId, next }: { factorId: string; next?: string }) {
  const [state, action, pending] = useActionState(verifyChallenge, null);
  const [recState, recAction, recPending] = useActionState(redeemRecoveryCode, null);
  const [recovering, setRecovering] = useState(false);

  if (recovering) {
    return (
      <form action={recAction} className="space-y-5">
        <p className="text-[13px] leading-relaxed text-mute">
          Enter one of the recovery codes you saved when you set up two-step sign-in. It works once. Your current
          authenticator is then removed, and you set up a new one and get a fresh set of codes.
        </p>
        <div>
          <label htmlFor="recoveryCode" className={authLabel}>
            Recovery code
          </label>
          <input
            id="recoveryCode"
            name="recoveryCode"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            autoFocus
            required
            className={`${authInput} text-center text-[18px] uppercase tracking-[0.2em]`}
            placeholder="ABCDE-12345"
            maxLength={16}
          />
        </div>

        {recState?.error ? <p className={authError}>{recState.error}</p> : null}

        <button type="submit" disabled={recPending} className={authButton}>
          {recPending ? "Checking…" : "Use recovery code"}
        </button>
        <button
          type="button"
          onClick={() => setRecovering(false)}
          className="inline-flex min-h-[44px] w-full items-center justify-center text-[14px] font-semibold text-ink underline underline-offset-2"
        >
          Back to the authenticator code
        </button>
      </form>
    );
  }

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
      <button
        type="button"
        onClick={() => setRecovering(true)}
        className="inline-flex min-h-[44px] w-full items-center justify-center text-[14px] font-semibold text-ink underline underline-offset-2"
      >
        Lost your authenticator? Use a recovery code
      </button>
    </form>
  );
}
