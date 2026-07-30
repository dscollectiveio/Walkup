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
        className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
      >
        Report a problem
      </button>
    );
  }

  return (
    <form action={action} className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div>
        <label htmlFor="title" className="block text-sm font-medium">
          What&rsquo;s wrong?
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="Water stain on the hallway ceiling"
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          Any detail that would help
          <span className="ml-1 font-normal text-stone-400">optional</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          placeholder="When you first noticed it, whether it's getting worse, anything you've already tried."
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="unit_id" className="block text-sm font-medium">
            Where is it?
          </label>
          <select
            id="unit_id"
            name="unit_id"
            defaultValue="common"
            className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
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
          <label htmlFor="priority" className="block text-sm font-medium">
            How urgent?
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue="normal"
            className="mt-1 w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="low">Can wait</option>
            <option value="normal">Should be looked at</option>
            <option value="urgent">Needs attention now</option>
          </select>
        </div>
      </div>

      {state?.error ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Report it"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
