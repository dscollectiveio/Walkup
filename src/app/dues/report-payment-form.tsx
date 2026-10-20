"use client";

import { useActionState, useState } from "react";
import { reportOutsidePayment } from "./actions";
import { btnPrimary } from "@/components/repairs/styles";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "I paid another way." Creates a report the treasurer sees next to the
 * bank feed; nothing moves and nothing posts until they confirm the deposit.
 */
export function ReportPaymentForm({
  units,
  defaultAmount,
}: {
  units: { id: string; label: string }[];
  defaultAmount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(reportOutsidePayment, null);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state?.ok) setOpen(false);
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={btnPrimary}
        >
          I paid another way
        </button>
        {state?.ok ? (
          <span className="text-[12px] text-good-text">Thanks. The board will match it when the deposit lands.</span>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-fill/40 p-4">
      <p className="text-[13px] text-ink">
        Tell the board what you sent. They&rsquo;ll match it to the deposit when it shows up at the bank.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {units.length === 1 ? (
          <input type="hidden" name="unit_id" value={units[0].id} />
        ) : (
          <div>
            <label htmlFor="rp-unit" className="block text-[12px] font-medium text-ink">
              Unit
            </label>
            <select id="rp-unit" name="unit_id" required defaultValue={units[0]?.id ?? ""} className={inputClass}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="rp-amount" className="block text-[12px] font-medium text-ink">
            Amount
          </label>
          <input
            id="rp-amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={defaultAmount && defaultAmount > 0 ? defaultAmount.toFixed(2) : ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="rp-date" className="block text-[12px] font-medium text-ink">
            Date you paid
          </label>
          <input id="rp-date" name="paid_on" type="date" required defaultValue={todayIso()} max={todayIso()} className={inputClass} />
        </div>
        <div>
          <label htmlFor="rp-method" className="block text-[12px] font-medium text-ink">
            How
          </label>
          <select id="rp-method" name="method" required defaultValue="zelle" className={inputClass}>
            <option value="zelle">Zelle</option>
            <option value="bank_transfer">Bank transfer / bill pay</option>
            <option value="check">Check</option>
            <option value="cash">Cash</option>
            <option value="other">Another way</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="rp-note" className="block text-[12px] font-medium text-ink">
            Anything that helps match it <span className="font-normal text-mute">(optional)</span>
          </label>
          <input id="rp-note" name="note" placeholder="Sent from my Chase account, memo “Unit 2 dues Oct”" className={inputClass} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className={btnPrimary}
        >
          {pending ? "Sending…" : "Tell the board"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
        >
          Cancel
        </button>
        {state?.error ? <span className="text-[12px] text-bad-text">{state.error}</span> : null}
      </div>
    </form>
  );
}
