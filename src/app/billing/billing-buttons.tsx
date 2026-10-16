"use client";

import { useActionState } from "react";
import { btnPrimary, btnSecondary, choiceRow, errorClass } from "@/components/repairs/styles";
import { openPortal, startCheckout, type BillingActionState } from "./actions";

/** "Choose a plan": monthly or yearly, then Stripe's hosted checkout. */
export function ChoosePlanForm({ planName, month, year }: { planName: string; month: number; year: number }) {
  const [state, action, pending] = useActionState<BillingActionState | null, FormData>(startCheckout, null);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">{planName} plan</legend>
        <label className={choiceRow}>
          <input type="radio" name="interval" value="month" defaultChecked />
          <span>
            ${month} a month
          </span>
        </label>
        <label className={choiceRow}>
          <input type="radio" name="interval" value="year" />
          <span>
            ${year} a year <span className="text-mute">(2 months free)</span>
          </span>
        </label>
      </fieldset>
      {state?.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Opening Stripe…" : "Choose a plan"}
      </button>
      <p className="text-[12px] text-mute">
        You enter payment details on Stripe&rsquo;s secure page. Walkup never sees your card or bank numbers.
      </p>
    </form>
  );
}

/** "Manage billing": Stripe's hosted portal for cards, invoices and cancelling. */
export function ManageBillingButton() {
  const [state, action, pending] = useActionState<BillingActionState | null>(openPortal, null);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className={btnSecondary}>
        {pending ? "Opening Stripe…" : "Manage billing"}
      </button>
      {state?.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
      <p className="text-[12px] text-mute">Update your card, see invoices or cancel, on Stripe&rsquo;s secure page.</p>
    </form>
  );
}
