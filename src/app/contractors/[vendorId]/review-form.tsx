"use client";

import { useActionState, useState } from "react";
import { addReview } from "../vendor-actions";

export function ReviewForm({ vendorId, tickets }: { vendorId: string; tickets: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addReview, null);
  // Closing unmounts the form, so a reopened one always starts blank.
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
        Add a review
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line p-4">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <fieldset>
        <legend className="text-[12px] font-medium text-ink">Rating</legend>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className="inline-flex min-h-[40px] min-w-[40px] cursor-pointer items-center justify-center rounded-md border border-line-strong text-[13px] text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
            >
              <input type="radio" name="rating" value={n} required className="sr-only" />
              {n}★
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`review-body-${vendorId}`} className="block text-[12px] font-medium text-ink">
          What happened <span className="font-normal text-mute-soft">optional</span>
        </label>
        <textarea
          id={`review-body-${vendorId}`}
          name="body"
          rows={3}
          className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
        />
      </div>
      {tickets.length > 0 ? (
        <div>
          <label htmlFor={`review-ticket-${vendorId}`} className="block text-[12px] font-medium text-ink">
            About a repair <span className="font-normal text-mute-soft">optional</span>
          </label>
          <select
            id={`review-ticket-${vendorId}`}
            name="ticket_id"
            defaultValue=""
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="">None</option>
            {tickets.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
      ) : null}
      {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save review"}
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
