"use client";

import { useActionState, useState } from "react";
import { recordPayment } from "./actions";
import { MoneyInput } from "@/components/money-input";
import { btnPrimary } from "@/components/repairs/styles";

export function PaymentForm({
  units,
}: {
  units: { id: string; label: string; owed: number }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPayment, null);

  if (state?.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={btnPrimary}
      >
        Record a payment
      </button>
    );
  }

  return (
    <form action={action} className="w-full basis-full space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="unit_id" className="block text-[12px] font-medium text-ink">
            Which unit paid?
          </label>
          <select
            id="unit_id"
            name="unit_id"
            required
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="" disabled>
              Choose…
            </option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}: owes {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(u.owed)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="amount" className="block text-[12px] font-medium text-ink">
            Amount received
          </label>
          <MoneyInput
            id="amount"
            name="amount"
            required
            placeholder="$0"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>

        <div>
          <label htmlFor="received_on" className="block text-[12px] font-medium text-ink">
            Date received
          </label>
          <input
            id="received_on"
            name="received_on"
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>

        <div>
          <label htmlFor="method" className="block text-[12px] font-medium text-ink">
            How
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <select
            id="method"
            name="method"
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="">Not sure</option>
            <option value="check">Check</option>
            <option value="ach">Bank transfer (ACH or Zelle)</option>
            <option value="cash">Cash</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="reference" className="block text-[12px] font-medium text-ink">
          Reference
          <span className="ml-1 font-normal text-mute-soft">optional: check number, confirmation code</span>
        </label>
        <input
          id="reference"
          name="reference"
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
          className={btnPrimary}
        >
          {pending ? "Saving…" : "Record it"}
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
