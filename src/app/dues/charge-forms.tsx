"use client";

import { useActionState, useState } from "react";
import { addOneOffCharge, saveLateFeeRule } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const btnGhost = btnSecondary;

/** The late-fee rule in one sentence: off by default, nothing fires until it's set. */
export function LateFeeRuleForm({
  amount,
  graceDays,
}: {
  amount: number | null;
  graceDays: number | null;
}) {
  const enabledNow = amount !== null && graceDays !== null;
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(enabledNow);
  const [state, action, pending] = useActionState(saveLateFeeRule, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
        <p className="text-ink">
          {enabledNow ? (
            <>
              Late fee: <span className="figures">${amount}</span> once a payment is more than {graceDays} day
              {graceDays === 1 ? "" : "s"} late. Proposed here; you confirm each one.
            </>
          ) : (
            <>
              <span className="font-medium">No late fees.</span>{" "}
              <span className="text-mute">Set a rule and this page will propose them. Nothing is added without your click.</span>
            </>
          )}
        </p>
        <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
          {enabledNow ? "Change" : "Set a late-fee rule"}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" name="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Charge a late fee when dues are paid late
      </label>
      {enabled ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="lf-amount" className="block text-[12px] font-medium text-ink">
              Fee amount
            </label>
            <MoneyInput id="lf-amount" name="amount" defaultValue={amount} placeholder="$25" className={inputClass} />
          </div>
          <div>
            <label htmlFor="lf-grace" className="block text-[12px] font-medium text-ink">
              Days after the due date before it applies
            </label>
            <input id="lf-grace" name="grace_days" type="number" min="0" step="1" defaultValue={graceDays ?? 15} className={inputClass} />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
        {state?.error ? <span className="text-[12px] text-bad-text">{state.error}</span> : null}
      </div>
    </form>
  );
}

/** A one-off charge to one unit — a key, a repair the owner caused, a fine the bylaws allow. */
export function OneOffChargeForm({ units }: { units: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addOneOffCharge, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnGhost}>
        Charge one unit for something
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="oo-unit" className="block text-[12px] font-medium text-ink">
            Unit
          </label>
          <select id="oo-unit" name="unit_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose…
            </option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="oo-amount" className="block text-[12px] font-medium text-ink">
            Amount
          </label>
          <MoneyInput id="oo-amount" name="amount" required placeholder="$100" className={inputClass} />
        </div>
        <div>
          <label htmlFor="oo-reason" className="block text-[12px] font-medium text-ink">
            What it&rsquo;s for
          </label>
          <input id="oo-reason" name="reason" required placeholder="Replacement mailbox key" className={inputClass} />
        </div>
      </div>
      <p className="text-[12px] text-mute">
        Goes on the unit&rsquo;s statement today, with this reason. Owners see it as something they owe.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Adding…" : "Add the charge"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnGhost}>
          Cancel
        </button>
        {state?.error ? <span className="text-[12px] text-bad-text">{state.error}</span> : null}
      </div>
    </form>
  );
}
