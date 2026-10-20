"use client";

import { useActionState, useState, type ReactNode } from "react";
import { setReserveTarget } from "@/app/home-actions";

/**
 * The line above the reserve bar, with the board_admin-only control on it (the
 * action's RLS update is the gate): the label on the left, and on the right the
 * status text and the underlined "Change the target" button. Opening it puts the
 * form just under the line.
 */
export function ReserveTargetForm({
  currentTarget,
  label,
  status,
}: {
  currentTarget: number | null;
  label: ReactNode;
  status?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(setReserveTarget, null);

  if (state?.ok && open) setOpen(false);

  const line = (
    <div className="flex items-baseline justify-between gap-3">
      {label}
      <span className="flex shrink-0 items-baseline gap-3">
        {status}
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[12px] font-medium text-ink underline underline-offset-2 hover:text-ink-mid"
          >
            {currentTarget ? "Change the target" : "Set a reserve target"}
          </button>
        ) : null}
      </span>
    </div>
  );

  if (!open) return line;

  return (
    <>
    {line}
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
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
    </>
  );
}
