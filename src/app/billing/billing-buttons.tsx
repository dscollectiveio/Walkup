"use client";

import { useActionState, useState } from "react";
import { btnPrimary, btnSecondary, choiceRow, errorClass } from "@/components/repairs/styles";
import { openPortal, startCheckout, upgradeToYearly, type BillingActionState } from "./actions";

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

/**
 * "Switch to yearly": shows what it saves, asks once to confirm, and tells the
 * truth about the charge (the unused part of this month is credited).
 */
export function UpgradeToYearly({ planName, month, year, renewsOn }: { planName: string; month: number; year: number; renewsOn: string }) {
  const [state, action, pending] = useActionState<(BillingActionState & { ok?: boolean }) | null>(upgradeToYearly, null);
  const [confirming, setConfirming] = useState(false);
  const savings = month * 12 - year;
  if (state?.ok) {
    return (
      <div className="rounded-xl border border-good-line bg-good-tint p-5" role="status">
        <p className="text-[15px] font-semibold text-good-text">You&rsquo;re switched to yearly billing.</p>
        <p className="mt-1 text-[13px] text-good-text">
          Stripe is confirming it. This page shows your yearly plan within a minute, and you&rsquo;ll get a receipt by email.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#D9A441]/60 bg-[#D9A441]/10 p-5">
      <p className="text-[15px] font-semibold text-ink">
        Save ${savings} a year: switch to yearly
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-mute">
        Pay ${year} once a year for the {planName} plan instead of ${month} a month (${month * 12} over a year). That&rsquo;s 2 months free.
      </p>
      {confirming ? (
        <form action={action} className="mt-4 space-y-3">
          <p className="text-[13px] leading-relaxed text-ink">
            Switching charges ${year} now, minus a credit for the unused part of this month (your plan renews on {renewsOn}). Your
            yearly period starts today, and it renews each year until you cancel.
          </p>
          {state?.error ? (
            <p role="alert" className={errorClass}>
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Switching…" : `Confirm: switch to yearly`}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnSecondary}>
              Not now
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${btnPrimary} mt-4`}>
          Switch to yearly
        </button>
      )}
    </div>
  );
}
