"use client";

import { useActionState, useRef, useEffect } from "react";
import { PasswordInput } from "@/components/auth/password-input";
import { btnPrimary, btnSecondary, errorClass, hintClass, inputClass, labelClass } from "@/components/repairs/styles";
import { MIN_PASSWORD } from "@/lib/security/password";
import { changePassword, signOutOtherDevices, type AccountResult } from "./actions";

function Status({ state }: { state: AccountResult }) {
  if (!state) return null;
  return "error" in state ? (
    <p role="alert" className={errorClass}>
      {state.error}
    </p>
  ) : (
    <p role="status" className="text-[13px] text-good-text">
      {state.message}
    </p>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear both fields once the change is saved, so nothing lingers on screen.
  useEffect(() => {
    if (state && "ok" in state) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="max-w-md space-y-4">
      <div>
        <label htmlFor="acct-password" className={labelClass}>
          New password
        </label>
        <PasswordInput
          id="acct-password"
          name="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          aria-describedby="acct-password-hint"
          className={inputClass}
        />
        <p id="acct-password-hint" className={hintClass}>
          At least {MIN_PASSWORD} characters. A few random words works well.
        </p>
      </div>
      <div>
        <label htmlFor="acct-password-confirm" className={labelClass}>
          Type it again
        </label>
        <PasswordInput
          id="acct-password-confirm"
          name="confirm_password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          className={inputClass}
        />
      </div>
      <Status state={state} />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export function SignOutOthersButton() {
  const [state, action, pending] = useActionState(signOutOtherDevices, null);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className={btnSecondary}>
        {pending ? "Signing out…" : "Sign out of other devices"}
      </button>
      <Status state={state} />
    </form>
  );
}
