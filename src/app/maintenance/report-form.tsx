"use client";

import { useActionState, useState } from "react";
import { createTicket } from "./actions";

/**
 * Collapsed by default. The common case on this page is reading, not writing,
 * and a permanently open form pushes the list of actual problems below the
 * fold.
 */
export function ReportForm({
  units,
}: {
  units: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTicket, null);

  if (state?.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
      >
        Report a problem
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div>
        <label htmlFor="title" className="block text-[12px] font-medium text-ink">
          What&rsquo;s wrong?
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="Water stain on the hallway ceiling"
          className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-[12px] font-medium text-ink">
          Any detail that would help
          <span className="ml-1 font-normal text-mute-soft">optional</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="When you first noticed it, whether it's getting worse, anything you've already tried."
          className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="unit_id" className="block text-[12px] font-medium text-ink">
            Where is it?
          </label>
          <select
            id="unit_id"
            name="unit_id"
            defaultValue="common"
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="common">Shared area — hallway, roof, boiler, outside</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                Inside {u.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="priority" className="block text-[12px] font-medium text-ink">
            How urgent?
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue="normal"
            className="mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
          >
            <option value="low">Can wait</option>
            <option value="normal">Should be looked at</option>
            <option value="urgent">Needs attention now</option>
          </select>
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
          {pending ? "Saving…" : "Report it"}
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
