"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateMyProfile } from "../actions";
import { btnPrimary, errorClass, hintClass, inputClass, labelClass, textareaClass } from "@/components/repairs/styles";

/** Phone and mailing address: the two things an owner may change. Name and email are the board's record. */
export function ProfileForm({ phone, mailingAddress }: { phone: string; mailingAddress: string }) {
  const [state, action, pending] = useActionState(updateMyProfile, null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const fieldErrors = state && "fieldErrors" in state ? state.fieldErrors : undefined;

  // Move focus to the first field with a problem.
  useEffect(() => {
    if (fieldErrors?.phone) phoneRef.current?.focus();
    else if (fieldErrors?.mailingAddress) addressRef.current?.focus();
  }, [fieldErrors]);

  return (
    <form action={action} className="space-y-4" noValidate>
      {state && "error" in state ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
      <div>
        <label htmlFor="pf-phone" className={labelClass}>
          Phone
        </label>
        <input
          ref={phoneRef}
          id="pf-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={phone}
          maxLength={60}
          aria-invalid={fieldErrors?.phone ? true : undefined}
          aria-describedby={fieldErrors?.phone ? "pf-phone-error" : "pf-phone-hint"}
          className={inputClass}
        />
        <p id="pf-phone-hint" className={hintClass}>
          Optional. The board may call or text about urgent building problems.
        </p>
        {fieldErrors?.phone ? (
          <p id="pf-phone-error" className={errorClass}>
            {fieldErrors.phone}
          </p>
        ) : null}
      </div>
      <div>
        <label htmlFor="pf-address" className={labelClass}>
          Mailing address
        </label>
        <textarea
          ref={addressRef}
          id="pf-address"
          name="mailing_address"
          rows={3}
          autoComplete="street-address"
          defaultValue={mailingAddress}
          aria-invalid={fieldErrors?.mailingAddress ? true : undefined}
          aria-describedby={fieldErrors?.mailingAddress ? "pf-address-error" : "pf-address-hint"}
          className={textareaClass}
        />
        <p id="pf-address-hint" className={hintClass}>
          Optional. Where the board sends paper notices if you don&rsquo;t live in the unit.
        </p>
        {fieldErrors?.mailingAddress ? (
          <p id="pf-address-error" className={errorClass}>
            {fieldErrors.mailingAddress}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving..." : "Save"}
        </button>
        <span role="status" className="text-[13px] text-good-text">
          {state && "ok" in state ? "Saved." : ""}
        </span>
      </div>
    </form>
  );
}
