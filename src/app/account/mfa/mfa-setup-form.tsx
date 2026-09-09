"use client";

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
    <div className="mt-8 space-y-6">
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
          <label htmlFor="code" className="block text-[12px] font-medium text-ink">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-center text-[16px] tracking-[0.3em] text-ink"
          />
        </div>

        {state?.error ? (
          <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-ink px-3 py-2 text-[13px] font-medium text-paper transition hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify and finish"}
        </button>
      </form>
    </div>
  );
}
