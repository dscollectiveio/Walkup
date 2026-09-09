"use client";

import { useActionState, useState } from "react";
import { addPerson } from "./actions";
import { PhoneInput } from "@/components/phone-input";

export function AddPersonForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addPerson, null);

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
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Add a person
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className="block text-[12px] font-medium text-ink">
            Full name
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="email" className="block text-[12px] font-medium text-ink">
            Email
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-[12px] font-medium text-ink">
            Phone
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <PhoneInput
            id="phone"
            name="phone"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="mailing_address" className="block text-[12px] font-medium text-ink">
            Mailing address
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="mailing_address"
            name="mailing_address"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
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
          {pending ? "Saving…" : "Add them"}
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
