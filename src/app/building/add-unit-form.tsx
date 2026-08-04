"use client";

import { useActionState, useState } from "react";
import { addUnit } from "./actions";

export function AddUnitForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addUnit, null);

  // Close only on a *new* successful submission, not merely because `state`
  // is still truthy from the last time this form was open (useActionState's
  // state outlives the toggle — comparing against the previous value here,
  // during render, is the React-recommended way to react to that without
  // an effect).
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
        Add a unit
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="label" className="block text-[12px] font-medium text-ink">
            Label
          </label>
          <input
            id="label"
            name="label"
            required
            placeholder="Unit 4"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="sort_order" className="block text-[12px] font-medium text-ink">
            Sort order
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            step="1"
            placeholder="0"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="square_footage" className="block text-[12px] font-medium text-ink">
            Square footage
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="square_footage"
            name="square_footage"
            type="number"
            min="1"
            step="1"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="bedroom_count" className="block text-[12px] font-medium text-ink">
            Bedrooms
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="bedroom_count"
            name="bedroom_count"
            type="number"
            min="0"
            step="1"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="full_bathrooms" className="block text-[12px] font-medium text-ink">
            Full bathrooms
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="full_bathrooms"
            name="full_bathrooms"
            type="number"
            min="0"
            step="1"
            className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
          />
        </div>
        <div>
          <label htmlFor="half_bathrooms" className="block text-[12px] font-medium text-ink">
            Half bathrooms
            <span className="ml-1 font-normal text-mute-soft">optional</span>
          </label>
          <input
            id="half_bathrooms"
            name="half_bathrooms"
            type="number"
            min="0"
            step="1"
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
          {pending ? "Saving…" : "Add it"}
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
