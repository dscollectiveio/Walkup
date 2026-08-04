"use client";

import { useActionState, useState } from "react";
import { setReserveTarget } from "@/app/home-actions";

/** Board_admin-only inline control — the action's RLS update is the gate. */
export function ReserveTargetForm({ currentTarget }: { currentTarget: number | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setReserveTarget, null);

  if (state?.ok && open) setOpen(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        {currentTarget ? "Change the target" : "Set a reserve target"}
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor="reserve_target" className="sr-only">
        Reserve target in dollars
      </label>
      <input
        id="reserve_target"
        name="target"
        type="number"
        min="0"
        step="100"
        defaultValue={currentTarget !== null ? String(currentTarget) : ""}
        placeholder="30000"
        className="figures w-32 rounded-lg border border-line-strong px-3 py-1.5 text-right text-[13px] text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[12px] text-mute underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      {state?.error ? <p className="w-full text-[12px] text-bad-text">{state.error}</p> : null}
    </form>
  );
}
