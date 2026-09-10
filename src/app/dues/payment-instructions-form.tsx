"use client";

import { useActionState, useState } from "react";
import { updateDuesPaymentInstructions } from "./actions";

export interface DuesPaymentInstructions {
  dues_payee_name: string | null;
  dues_bank_name: string | null;
  dues_account_number: string | null;
  dues_routing_number: string | null;
  dues_zelle_handle: string | null;
  dues_payment_notes: string | null;
}

export function PaymentInstructionsForm({
  instructions,
}: {
  instructions: DuesPaymentInstructions;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(updateDuesPaymentInstructions, null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
      >
        Edit payment details
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dues_payee_name" className="block text-[12px] font-medium text-ink">
            Payee name
            <span className="ml-1 font-normal text-mute-soft">for bill pay</span>
          </label>
          <input
            id="dues_payee_name"
            name="dues_payee_name"
            placeholder="2158 N Damen Ave HOA"
            defaultValue={instructions.dues_payee_name ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="dues_bank_name" className="block text-[12px] font-medium text-ink">
            Bank name
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="dues_bank_name"
            name="dues_bank_name"
            defaultValue={instructions.dues_bank_name ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="dues_account_number" className="block text-[12px] font-medium text-ink">
            Account number
          </label>
          <input
            id="dues_account_number"
            name="dues_account_number"
            defaultValue={instructions.dues_account_number ?? ""}
            className="figures mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="dues_routing_number" className="block text-[12px] font-medium text-ink">
            Routing number
          </label>
          <input
            id="dues_routing_number"
            name="dues_routing_number"
            defaultValue={instructions.dues_routing_number ?? ""}
            className="figures mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="dues_zelle_handle" className="block text-[12px] font-medium text-ink">
            Zelle handle
            <span className="ml-1 font-normal text-mute-soft">optional — email or phone</span>
          </label>
          <input
            id="dues_zelle_handle"
            name="dues_zelle_handle"
            defaultValue={instructions.dues_zelle_handle ?? ""}
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
      </div>

      <div>
        <label htmlFor="dues_payment_notes" className="block text-[12px] font-medium text-ink">
          Notes for owners
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <textarea
          id="dues_payment_notes"
          name="dues_payment_notes"
          rows={2}
          placeholder="e.g. Bill pay only — we don't accept Zelle over $500."
          defaultValue={instructions.dues_payment_notes ?? ""}
          className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
        />
      </div>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
