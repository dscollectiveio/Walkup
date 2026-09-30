"use client";

import { useActionState, useState } from "react";
import { addRecurringBill } from "./actions";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

export function AddBillForm({
  categories,
  contractors,
}: {
  categories: { id: string; name: string }[];
  contractors: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addRecurringBill, null);
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
        className="min-h-[44px] rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
      >
        Add a bill
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <p className="text-[12px] text-mute">
        A bill the association already pays — utilities, insurance, a contract. Walkup reminds you; it never pays anything.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bill-name" className="block text-[12px] font-medium text-ink">Name</label>
          <input id="bill-name" name="name" required placeholder="ComEd" className={inputClass} />
        </div>
        <div>
          <label htmlFor="bill-account" className="block text-[12px] font-medium text-ink">Category</label>
          <select id="bill-account" name="account_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bill-frequency" className="block text-[12px] font-medium text-ink">How often</label>
          <select id="bill-frequency" name="frequency" defaultValue="monthly" className={inputClass}>
            <option value="monthly">Every month</option>
            <option value="quarterly">Every 3 months</option>
            <option value="semiannual">Twice a year</option>
            <option value="annual">Once a year</option>
          </select>
        </div>
        <div>
          <label htmlFor="bill-next" className="block text-[12px] font-medium text-ink">Next due</label>
          <input id="bill-next" name="next_due_on" type="date" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="bill-amount" className="block text-[12px] font-medium text-ink">
            Usual amount <span className="font-normal text-mute-soft">optional</span>
          </label>
          <input id="bill-amount" name="typical_amount" type="number" min="0" step="0.01" className={`figures ${inputClass}`} />
        </div>
        {contractors.length > 0 ? (
          <div>
            <label htmlFor="bill-vendor" className="block text-[12px] font-medium text-ink">
              Contractor <span className="font-normal text-mute-soft">optional</span>
            </label>
            <select id="bill-vendor" name="vendor_id" defaultValue="" className={inputClass}>
              <option value="">None</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <label className="flex items-center gap-2 text-[12px] text-ink">
        <input type="checkbox" name="autopay_arranged" className="rounded border-line-strong" />
        Already on autopay with the provider
      </label>
      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save bill"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
