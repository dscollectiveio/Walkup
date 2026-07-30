"use client";

import { useActionState } from "react";
import { addComment, setTicketStatus } from "../actions";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "Being worked on" },
  { value: "waiting_on_contractor", label: "Waiting on contractor" },
  { value: "resolved", label: "Fixed" },
  { value: "closed", label: "Closed" },
];

export function TicketControls({
  ticketId,
  status,
}: {
  ticketId: string;
  status: string;
}) {
  const [noteState, noteAction, notePending] = useActionState(addComment, null);
  const [statusState, statusAction, statusPending] = useActionState(setTicketStatus, null);

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <form action={noteAction} className="space-y-2">
        <label htmlFor="body" className="block text-sm font-medium">
          Add a note
        </label>
        <input type="hidden" name="ticket_id" value={ticketId} />
        <textarea
          id="body"
          name="body"
          rows={3}
          placeholder="Called the plumber, coming Thursday…"
          className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
        />
        {noteState?.error ? (
          <p className="text-sm text-red-800">{noteState.error}</p>
        ) : null}
        <button
          type="submit"
          disabled={notePending}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {notePending ? "Saving…" : "Add note"}
        </button>
      </form>

      {/* Board only. An owner posting a note is fine; an owner closing a
          problem someone else reported is not — the update policy refuses it,
          and this control simply reflects that. */}
      <form action={statusAction} className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4">
        <input type="hidden" name="ticket_id" value={ticketId} />
        <div>
          <label htmlFor="status" className="block text-sm font-medium">
            Change status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="mt-1 rounded border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={statusPending}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50 disabled:opacity-50"
        >
          {statusPending ? "Saving…" : "Update"}
        </button>
        {statusState?.error ? (
          <p className="text-sm text-red-800">{statusState.error}</p>
        ) : null}
      </form>
    </div>
  );
}
