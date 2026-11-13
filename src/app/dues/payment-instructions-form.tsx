"use client";

import { useActionState, useEffect, useState } from "react";
import { updateDuesPaymentInstructions } from "./actions";
import { BankNameField } from "./bank-name-field";
import { EDIT_PAYMENT_EVENT } from "./edit-payment-event";
import { btnPrimary } from "@/components/repairs/styles";

export interface DuesPaymentInstructions {
  dues_payee_name: string | null;
  dues_bank_name: string | null;
  dues_account_number: string | null;
  dues_routing_number: string | null;
  dues_zelle_handle: string | null;
  dues_zelle_phone: string | null;
  dues_zelle_name: string | null;
  dues_payment_notes: string | null;
  dues_mailing_address: string | null;
}

export function PaymentInstructionsForm({
  instructions,
  legalName,
}: {
  instructions: DuesPaymentInstructions;
  /** The association's stored legal name: the payee name until the board changes it. */
  legalName: string;
}) {
  const [open, setOpen] = useState(false);
  // Controlled, so a refused save keeps what was typed.
  const [v, setV] = useState({
    dues_payee_name: instructions.dues_payee_name ?? legalName,
    dues_bank_name: instructions.dues_bank_name ?? "",
    dues_routing_number: instructions.dues_routing_number ?? "",
    dues_account_number: instructions.dues_account_number ?? "",
    dues_zelle_handle: instructions.dues_zelle_handle ?? "",
    dues_zelle_phone: instructions.dues_zelle_phone ?? "",
    dues_zelle_name: instructions.dues_zelle_name ?? "",
  });
  // The button lives in the card header (EditPaymentDetailsButton) and asks this form to open.
  useEffect(() => {
    const onEdit = () => setOpen(true);
    window.addEventListener(EDIT_PAYMENT_EVENT, onEdit);
    return () => window.removeEventListener(EDIT_PAYMENT_EVENT, onEdit);
  }, []);
  const set = (k: keyof typeof v) => (x: string) => setV((p) => ({ ...p, [k]: x }));
  const [state, action, pending] = useActionState(updateDuesPaymentInstructions, null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  const fieldError = (f: string) => (state && "error" in state && state.error && state.field === f ? state.error : null);

  if (!open) return null;

  return (
    <form action={action} className="space-y-5 rounded-xl border border-line bg-paper p-5">
      <p className="text-[12px] text-mute">Fill in at least one way for owners to pay. Leave a group empty if you don&rsquo;t use it.</p>

      <div role="group" aria-labelledby="how-bank" className="space-y-3">
        <h3 id="how-bank" className="flex items-center gap-2 text-[13px] font-semibold text-ink"><BankIcon />Bank transfer or bill pay</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dues_payee_name" label="Payee name" note="for bill pay" value={v.dues_payee_name} onChange={set("dues_payee_name")} error={fieldError("dues_payee_name")} />
          <BankNameField id="dues_bank_name" value={v.dues_bank_name} onChange={set("dues_bank_name")} />
          <Field id="dues_routing_number" label="Routing number" note="9 digits" value={v.dues_routing_number} onChange={set("dues_routing_number")} figures inputMode="numeric" error={fieldError("dues_routing_number")} />
          <Field id="dues_account_number" label="Account number" value={v.dues_account_number} onChange={set("dues_account_number")} figures inputMode="numeric" error={fieldError("dues_account_number")} />
        </div>
      </div>

      <div role="group" aria-labelledby="how-zelle" className="space-y-3 border-t border-line pt-5">
        <h3 id="how-zelle" className="flex items-center gap-2 text-[13px] font-semibold text-ink"><ZelleIcon />Zelle</h3>
        <p className="text-[12px] text-mute">Add the email or the mobile number your Zelle account is enrolled with. One is enough.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="dues_zelle_handle" label="Zelle email" value={v.dues_zelle_handle} onChange={set("dues_zelle_handle")} inputMode="email" error={fieldError("dues_zelle_handle")} />
          <Field id="dues_zelle_phone" label="Zelle mobile number" value={v.dues_zelle_phone} onChange={set("dues_zelle_phone")} inputMode="tel" error={fieldError("dues_zelle_phone")} />
        </div>
        <Field id="dues_zelle_name" label="Name shown in Zelle" note="optional, so owners can confirm the recipient" value={v.dues_zelle_name} onChange={set("dues_zelle_name")} />
      </div>

      <div role="group" aria-labelledby="how-checks" className="space-y-3 border-t border-line pt-5">
        <h3 id="how-checks" className="flex items-center gap-2 text-[13px] font-semibold text-ink"><CheckIcon />Checks</h3>
        <div>
          <label htmlFor="dues_mailing_address" className="block text-[12px] font-medium text-ink">
            Mailing address
          </label>
          <textarea
            id="dues_mailing_address"
            name="dues_mailing_address"
            rows={2}
            defaultValue={instructions.dues_mailing_address ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[16px] text-ink min-h-[44px] sm:min-h-0 sm:text-[13px]"
          />
        </div>
      </div>

      <div className="border-t border-line pt-5">
        <label htmlFor="dues_payment_notes" className="block text-[12px] font-medium text-ink">
          Notes for owners
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <textarea
          id="dues_payment_notes"
          name="dues_payment_notes"
          rows={2}
          placeholder="e.g. Dues are due by the 5th."
          defaultValue={instructions.dues_payment_notes ?? ""}
          className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[16px] text-ink min-h-[44px] sm:min-h-0 sm:text-[13px]"
        />
        <p className="mt-1 text-[12px] text-mute">Each owner&rsquo;s instructions also say &ldquo;Put &lsquo;Unit #&rsquo; in the memo,&rdquo; with their own unit filled in.</p>
      </div>

      {state?.error && (!state.field || state.field === "form") ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill sm:min-h-0"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  note,
  value,
  onChange,
  figures,
  inputMode,
  error,
}: {
  id: string;
  label: string;
  note?: string;
  value: string;
  onChange: (v: string) => void;
  figures?: boolean;
  inputMode?: "numeric" | "email" | "tel";
  error?: string | null;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-medium text-ink">
        {label}
        {note ? <span className="ml-1 font-normal text-mute-soft">{note}</span> : null}
      </label>
      <input
        id={id}
        name={id}
        inputMode={inputMode}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${figures ? "figures " : ""}mt-1 w-full rounded-lg border px-3 py-2 text-[16px] text-ink min-h-[44px] sm:min-h-0 sm:text-[13px] ${error ? "border-bad" : "border-line-strong"}`}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-[12px] text-bad-text">
          <span className="font-semibold">Error: </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const ICON = "h-5 w-5 shrink-0";

function BankIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${ICON} text-ink`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" />
      <path d="M3 20h18" />
    </svg>
  );
}

/** A purple "Z" badge in Zelle's color, drawn here; nothing is loaded from Zelle. */
function ZelleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={ICON}>
      <rect width="24" height="24" rx="5" fill="#6d1ed4" />
      <path d="M7 7h10v2.2L10.3 15.4H17V17H7v-2.2L13.7 8.6H7z" fill="#fff" />
      <path d="M11.2 5.5h1.6v13h-1.6z" fill="#fff" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`${ICON} text-ink`} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <path d="M5.5 10h6M5.5 13h3" />
      <path d="M14 15.5c1-1.6 1.6-2.4 2.2-2.4.6 0 .4 1.4 1.1 1.4.5 0 .9-.5 1.2-.9" />
    </svg>
  );
}
