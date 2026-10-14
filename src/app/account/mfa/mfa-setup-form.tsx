"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState } from "react";
import { verifyEnrollment } from "./actions";

export function MfaSetupForm({
  factorId,
  qrCode,
  secret,
}: {
  factorId: string;
  qrCode: string;
  secret: string;
}) {
  const [state, action, pending] = useActionState(verifyEnrollment, null);

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="rounded-2xl border border-line bg-paper p-4 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- qrCode is a data: URI, not a route-able asset */}
          <img src={qrCode} alt="MFA setup QR code" className="h-48 w-48" />
        </div>
      </div>
      <p className="text-center text-[12px] text-mute-soft">
        Can&rsquo;t scan? Enter this key manually:{" "}
        <span className="figures break-all">{secret}</span>
      </p>

      <form action={action} className="space-y-4">
        <input type="hidden" name="factorId" value={factorId} />
        <div>
          <label htmlFor="code" className={authLabel}>
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className={`${authInput} text-center text-[20px] tracking-[0.4em]`}
            placeholder="123456"
            maxLength={6}
            autoFocus
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
          {pending ? "Verifying…" : "Verify and continue"}
        </button>
      </form>
    </div>
  );
}
