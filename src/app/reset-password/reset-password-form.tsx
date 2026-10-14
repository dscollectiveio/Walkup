"use client";

import { useActionState } from "react";
import { authButton, authError, authInput, authLabel } from "@/components/auth/auth-shell";
import { updatePassword } from "../login/actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <form action={action} className="space-y-5">
      <div>
        <label htmlFor="password" className={authLabel}>
          New password
        </label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required autoFocus className={authInput} />
        <p className="mt-1.5 text-[12px] text-mute">At least 12 characters. A few random words works well.</p>
      </div>
      <div>
        <label htmlFor="confirm_password" className={authLabel}>
          Confirm new password
        </label>
        <input id="confirm_password" name="confirm_password" type="password" autoComplete="new-password" minLength={12} required className={authInput} />
      </div>
      {state?.error ? <p className={authError}>{state.error}</p> : null}
      <button type="submit" disabled={pending} className={authButton}>
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
