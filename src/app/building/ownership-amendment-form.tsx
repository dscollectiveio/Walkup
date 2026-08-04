"use client";

import { useActionState, useMemo, useState } from "react";
import { recordOwnershipAmendment } from "./actions";

export function OwnershipAmendmentForm({
  units,
  currentPercentages,
}: {
  units: { id: string; label: string }[];
  currentPercentages: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordOwnershipAmendment, null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(units.map((u) => [u.id, String(currentPercentages[u.id] ?? "")])),
  );

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setOpen(false);
  }

  const total = useMemo(
    () => Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0),
    [values],
  );
  const atHundred = Math.abs(total - 100) < 0.0001;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Record an ownership change
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="effective_from" className="block text-[12px] font-medium text-ink">
            Effective from
          </label>
          <input
            id="effective_from"
            name="effective_from"
            type="date"
            required
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="recorded_document_ref" className="block text-[12px] font-medium text-ink">
            Recorded document
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="recorded_document_ref"
            name="recorded_document_ref"
            placeholder="deed reference, amendment number"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="block text-[12px] font-medium text-ink">
          Reason
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <input
          id="reason"
          name="reason"
          placeholder="unit 3 sale, amendment recorded 2026-08-01"
          className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div className="space-y-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-medium text-ink">Percentage per unit</span>
          <span
            className={`figures text-[13px] ${atHundred ? "text-good-text" : "text-bad-text"}`}
          >
            {total.toFixed(4)}%
          </span>
        </div>
        {units.map((u) => (
          <div key={u.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`pct-${u.id}`} className="text-[13px] text-ink">
              {u.label}
            </label>
            <div className="flex items-center gap-1">
              <input
                id={`pct-${u.id}`}
                name={`percentage_${u.id}`}
                type="number"
                min="0"
                max="100"
                step="0.000001"
                required
                value={values[u.id]}
                onChange={(e) => setValues((v) => ({ ...v, [u.id]: e.target.value }))}
                className="figures w-28 rounded-lg border border-line-strong px-2 py-1 text-right text-[13px] text-ink"
              />
              <span className="text-[12px] text-mute">%</span>
            </div>
          </div>
        ))}
        {!atHundred ? (
          <p className="text-[11px] text-mute-soft">Percentages must add up to exactly 100 to save.</p>
        ) : null}
      </div>

      {state?.error ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending || !atHundred}
          className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
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
