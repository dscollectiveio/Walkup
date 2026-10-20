"use client";

import { useActionState, useState } from "react";
import { RecoveryCodesPanel } from "@/components/auth/recovery-codes-panel";
import { btnPrimary, errorClass, hintClass, inputClass, labelClass } from "@/components/repairs/styles";
import { regenerateRecoveryCodes } from "./recovery-actions";

export function RecoveryCodesCard({ remaining, total }: { remaining: number; total: number }) {
  const [state, action, pending] = useActionState(regenerateRecoveryCodes, null);
  const [dismissed, setDismissed] = useState(false);

  if (state && "codes" in state && !dismissed) {
    return <RecoveryCodesPanel codes={state.codes} doneLabel="Done" onDone={() => setDismissed(true)} />;
  }

  return (
    <div className="space-y-3">
      <p className="text-[14px] text-ink">
        {total === 0
          ? "You have no recovery codes yet."
          : remaining === 0
            ? "You have used all of your recovery codes."
            : `${remaining} of ${total} recovery codes left.`}
      </p>
      <p className="text-[13px] leading-relaxed text-mute">
        If you lose your authenticator app, a recovery code gets you back in. Each works once. Making new codes cancels
        the old ones, and they are shown only once.
      </p>
      <form action={action} className="max-w-xs space-y-3">
        <div>
          <label htmlFor="recovery-confirm-code" className={labelClass}>
            Code from your authenticator app
          </label>
          <input
            id="recovery-confirm-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            placeholder="123456"
            className={inputClass}
          />
          <p className={hintClass}>We ask so that someone using your signed-in browser cannot make codes.</p>
        </div>
        {state && "error" in state ? (
          <p role="alert" className={errorClass}>
            {state.error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Making codes…" : total === 0 ? "Make recovery codes" : "Make new recovery codes"}
        </button>
      </form>
    </div>
  );
}
