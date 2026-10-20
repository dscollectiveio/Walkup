"use client";

import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";
import { verifyEnrollment } from "./actions";

export function MfaSetupForm({
  factorId,
  qrCode,
  secret,
  completed = false,
}: {
  factorId: string;
  qrCode: string;
  secret: string;
  /**
   * Verifying sets auth cookies, which makes Next render this page again, and
   * by then the factor is verified. The page keeps this same component in
   * place (instead of redirecting) so the recovery codes it is showing are not
   * thrown away; with no action result to show, it just offers to continue.
   */
  completed?: boolean;
}) {
  const [state, action, pending] = useActionState(verifyEnrollment, null);

  const router = useRouter();
  const goHome = () => {
    router.push("/");
    router.refresh();
  };

  if (state && "done" in state) {
    return state.codes ? (
      <div className="space-y-4">
        <p className="text-[14px] text-ink">Two-step sign-in is on. Save your recovery codes before you continue.</p>
        <RecoveryCodesPanel codes={state.codes} doneLabel="Continue to Walkup" onDone={goHome} />
      </div>
    ) : (
      <div className="space-y-4">
        <p className="text-[14px] text-ink">Two-step sign-in is on.</p>
        <p className={authError}>
          {state.codesError ?? "We couldn't make your recovery codes."} You can make them any time under Account, Sign-in
          and security.
        </p>
        <button type="button" onClick={goHome} className={authButton}>
          Continue to Walkup
        </button>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="space-y-4">
        <p className="text-[14px] text-ink">Two-step sign-in is on.</p>
        <button type="button" onClick={goHome} className={authButton}>
          Continue to Walkup
        </button>
      </div>
    );
  }

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

        {state && "error" in state ? (
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
