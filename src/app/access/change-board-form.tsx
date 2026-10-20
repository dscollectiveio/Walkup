"use client";

import { useActionState, useState, useTransition } from "react";
import { btnPrimary } from "@/components/repairs/styles";
import { changeBoardPosition, endBoardPosition } from "./actions";

export const POSITION_OPTIONS = [
  { value: "president", label: "President" },
  { value: "vice_president", label: "Vice President" },
  { value: "secretary", label: "Secretary" },
  { value: "treasurer", label: "Treasurer" },
  { value: "director", label: "Director" },
];

const field = "mt-1 block min-h-[40px] w-full rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[13px]";

/** Change of board: pick the office and the person, set the term, and the previous holder steps down. */
export function ChangeBoardForm({ people, defaultTermEnd }: { people: { id: string; name: string }[]; defaultTermEnd: string }) {
  const [state, action, pending] = useActionState(changeBoardPosition, null);
  const [open, setOpen] = useState(false);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state && "ok" in state) setOpen(false);
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnPrimary}>
        Change of board
      </button>
    );
  }
  return (
    <form action={action} className="space-y-4 rounded-xl border border-line bg-paper p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="cb-position" className="block text-[12px] font-medium text-ink">
            Position
          </label>
          <select id="cb-position" name="position" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose…
            </option>
            {POSITION_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cb-person" className="block text-[12px] font-medium text-ink">
            Who takes it
          </label>
          <select id="cb-person" name="person_id" required defaultValue="" className={field}>
            <option value="" disabled>
              Choose…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cb-term" className="block text-[12px] font-medium text-ink">
            Term ends
          </label>
          <input id="cb-term" name="term_end" type="date" defaultValue={defaultTermEnd} className={field} />
        </div>
      </div>
      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" name="end_old_access" className="mt-0.5" />
        <span>
          End the previous holder&rsquo;s board access too
          <span className="block text-[12px] text-mute">Leave this off if they stay on the board. A board admin role is changed on the roster.</span>
        </span>
      </label>
      <p className="text-[12px] text-mute">
        Whoever takes a position who is not on the board yet becomes a board member. The Treasurer also handles the bank feed&rsquo;s categorizing and posting;
        the Secretary also approves announcement emails.
      </p>
      {state && "error" in state ? (
        <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Make the change"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function StepDownButton({ positionId, name, position }: { positionId: string; name: string; position: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`${name} steps down as ${position}? The position will be empty until you fill it.`)) return;
          start(async () => {
            setError(null);
            const r = await endBoardPosition(positionId);
            if (r.error) setError(r.error);
          });
        }}
        className="text-[12px] font-medium text-bad-text underline underline-offset-2 hover:no-underline disabled:opacity-50"
      >
        {pending ? "Saving…" : "Step down"}
      </button>
      {error ? <span className="text-[11px] text-bad-text">{error}</span> : null}
    </span>
  );
}
