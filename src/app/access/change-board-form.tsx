"use client";

import { useActionState, useState, useTransition } from "react";
import { btnPrimary } from "@/components/repairs/styles";
import { changeBoardPosition, endBoardPosition } from "./actions";

const field = "mt-1 block min-h-[40px] w-full rounded-lg border border-line-strong bg-paper px-3 text-[16px] text-ink sm:text-[13px]";

export interface OfficeLineProps {
  /** president, vice_president, secretary, treasurer or director. */
  position: string;
  label: string;
  /** The person holding it now, if anyone. */
  holder: { positionId: string; personId: string; name: string; termEnd: string | null } | null;
  people: { id: string; name: string }[];
  defaultTermEnd: string;
  /** Days until the term ends, when it is soon or past. */
  endsInDays: number | null;
  /** Only a board admin edits the board. */
  canEdit: boolean;
  /** A director row with nobody in it is a quiet "Add a director" line, not a vacancy. */
  addLabel?: string;
}

/**
 * One office on the board, as a line you can edit in place: who holds it and when the term ends, with Edit (or
 * Assign when it is vacant) opening the same change right there, and Step down. Changing the person is the
 * "change of board": the previous holder steps down from the office, and can lose board access too.
 */
export function OfficeLine({ position, label, holder, people, defaultTermEnd, endsInDays, canEdit, addLabel }: OfficeLineProps) {
  const [state, action, pending] = useActionState(changeBoardPosition, null);
  const [open, setOpen] = useState(false);
  const [prev, setPrev] = useState(state);
  if (state !== prev) {
    setPrev(state);
    if (state && "ok" in state) setOpen(false);
  }
  const soon = endsInDays !== null && endsInDays <= 30;
  const id = `${position}-${holder?.positionId ?? "new"}`;

  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-mute">{label}</p>
          <p className="text-[14px] text-ink">{holder ? holder.name : <span className="text-mute">{addLabel ?? "Vacant"}</span>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-mute">
          {holder?.termEnd ? (
            <span className={soon ? "font-medium text-warning-text" : ""}>
              Term ends {holder.termEnd}
              {soon ? (endsInDays !== null && endsInDays >= 0 ? ` (${endsInDays} days)` : " (ended)") : ""}
            </span>
          ) : null}
          {canEdit && !open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="font-medium text-ink underline underline-offset-2 hover:no-underline"
            >
              {holder ? "Edit" : (addLabel ? "Add" : "Assign")}
            </button>
          ) : null}
          {canEdit && holder ? <StepDownButton positionId={holder.positionId} name={holder.name} position={label} /> : null}
        </div>
      </div>
      {open ? (
        <form action={action} className="mt-3 space-y-3 rounded-lg border border-line bg-fill p-4">
          <input type="hidden" name="position" value={position} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-person`} className="block text-[12px] font-medium text-ink">
                {holder ? "Who holds it" : "Who takes it"}
              </label>
              <select id={`${id}-person`} name="person_id" required defaultValue={holder?.personId ?? ""} className={field}>
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
              <label htmlFor={`${id}-term`} className="block text-[12px] font-medium text-ink">
                Term ends
              </label>
              <input id={`${id}-term`} name="term_end" type="date" defaultValue={holder?.termEnd ?? defaultTermEnd} className={field} />
            </div>
          </div>
          {holder && position !== "director" ? (
            <label className="flex items-start gap-2 text-[13px] text-ink">
              <input type="checkbox" name="end_old_access" className="mt-0.5" />
              <span>
                If you pick someone else, end {holder.name}&rsquo;s board access too
                <span className="block text-[12px] text-mute">Leave this off if they stay on the board. A board admin role is changed on Building &amp; Owners.</span>
              </span>
            </label>
          ) : null}
          <p className="text-[12px] text-mute">
            Someone who isn&rsquo;t on the board yet becomes a board member. The Treasurer also handles the bank feed&rsquo;s categorizing and posting; the
            Secretary also approves announcement emails.
          </p>
          {state && "error" in state ? (
            <p className="border-l-[3px] border-bad bg-bad-tint px-3 py-2 text-[13px] text-bad-text">{state.error}</p>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill">
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
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
