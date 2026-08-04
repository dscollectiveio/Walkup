"use client";

import { useActionState, useState } from "react";
import { changeUnitOwner, endUnitOwnership } from "./actions";

export interface CurrentOwner {
  rowId: string;
  personId: string;
  personName: string;
  effectiveFrom: string;
}

function EndOwnershipForm({
  rowId,
  unitId,
  onDone,
}: {
  rowId: string;
  unitId: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(endUnitOwnership, null);
  if (state?.ok) onDone();

  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="row_id" value={rowId} />
      <input type="hidden" name="unit_id" value={unitId} />
      <label htmlFor={`end-${rowId}`} className="text-[11px] text-mute">
        Ends on
      </label>
      <input
        id={`end-${rowId}`}
        name="effective_to"
        type="date"
        required
        className="rounded-lg border border-line-strong px-2 py-1 text-[12px] text-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
      >
        {pending ? "Saving…" : "Confirm"}
      </button>
      {state?.error ? <p className="w-full text-[11px] text-bad-text">{state.error}</p> : null}
    </form>
  );
}

function AssignOwnerForm({
  unitId,
  persons,
  onDone,
}: {
  unitId: string;
  persons: { id: string; full_name: string }[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(changeUnitOwner, null);
  if (state?.ok) onDone();

  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="unit_id" value={unitId} />
      <div>
        <label htmlFor={`owner-${unitId}`} className="block text-[11px] text-mute">
          Person
        </label>
        <select
          id={`owner-${unitId}`}
          name="person_id"
          required
          defaultValue=""
          className="rounded-lg border border-line-strong bg-paper px-2 py-1 text-[12px] text-ink"
        >
          <option value="" disabled>
            Choose…
          </option>
          {persons.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`from-${unitId}`} className="block text-[11px] text-mute">
          From
        </label>
        <input
          id={`from-${unitId}`}
          name="effective_from"
          type="date"
          required
          className="rounded-lg border border-line-strong px-2 py-1 text-[12px] text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Assign"}
      </button>
      {state?.error ? <p className="w-full text-[11px] text-bad-text">{state.error}</p> : null}
      {state && "warning" in state && state.warning ? (
        <p className="w-full text-[11px] text-warning-text">{state.warning}</p>
      ) : null}
    </form>
  );
}

export function OwnershipRow({
  unitId,
  unitLabel,
  owners,
  persons,
  canEdit,
}: {
  unitId: string;
  unitLabel: string;
  owners: CurrentOwner[];
  persons: { id: string; full_name: string }[];
  canEdit: boolean;
}) {
  const [endingRow, setEndingRow] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-ink">{unitLabel}</span>
        {canEdit && !assigning ? (
          <button
            type="button"
            onClick={() => setAssigning(true)}
            className="text-[12px] text-mute underline-offset-2 hover:underline"
          >
            {owners.length > 0 ? "Add another owner" : "Assign an owner"}
          </button>
        ) : null}
      </div>

      {owners.length === 0 ? (
        <p className="mt-1 text-[12px] text-mute-soft">No current owner on file.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {owners.map((o) => (
            <li key={o.rowId} className="text-[12px] text-mute">
              <span className="text-ink">{o.personName}</span> — since {o.effectiveFrom}
              {canEdit ? (
                endingRow === o.rowId ? (
                  <EndOwnershipForm
                    rowId={o.rowId}
                    unitId={unitId}
                    onDone={() => setEndingRow(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEndingRow(o.rowId)}
                    className="ml-2 text-[11px] text-mute-soft underline-offset-2 hover:underline"
                  >
                    End
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {assigning ? (
        <div>
          <AssignOwnerForm unitId={unitId} persons={persons} onDone={() => setAssigning(false)} />
          <button
            type="button"
            onClick={() => setAssigning(false)}
            className="mt-1 text-[11px] text-mute underline-offset-2 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </li>
  );
}
