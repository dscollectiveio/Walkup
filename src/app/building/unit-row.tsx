"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteUnit, updateUnit } from "./actions";

export interface UnitRecord {
  id: string;
  label: string;
  sort_order: number;
  square_footage: number | null;
  bedroom_count: number | null;
  full_bathrooms: number | null;
  half_bathrooms: number | null;
}

function specsLine(u: UnitRecord): string {
  const parts: string[] = [];
  if (u.square_footage) parts.push(`${u.square_footage} sq ft`);
  if (u.bedroom_count !== null) parts.push(`${u.bedroom_count} bed${u.bedroom_count === 1 ? "" : "s"}`);
  if (u.full_bathrooms !== null || u.half_bathrooms !== null) {
    const full = u.full_bathrooms ?? 0;
    const half = u.half_bathrooms ?? 0;
    parts.push(`${full}${half > 0 ? `.5` : ""} bath${full === 1 && half === 0 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No specs on file";
}

export function UnitRow({
  unit,
  canEdit,
  canDelete,
}: {
  unit: UnitRecord;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(updateUnit, null);
  const [deletePending, startDelete] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Close only on a *new* successful submission — see add-unit-form.tsx.
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setEditing(false);
  }

  if (editing) {
    return (
      <li className="py-3">
        <form action={action} className="space-y-3">
          <input type="hidden" name="unit_id" value={unit.id} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`label-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Label
              </label>
              <input
                id={`label-${unit.id}`}
                name="label"
                required
                defaultValue={unit.label}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`sort-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Sort order
              </label>
              <input
                id={`sort-${unit.id}`}
                name="sort_order"
                type="number"
                step="1"
                defaultValue={unit.sort_order}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`sqft-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Sq ft
              </label>
              <input
                id={`sqft-${unit.id}`}
                name="square_footage"
                type="number"
                min="1"
                step="1"
                defaultValue={unit.square_footage ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`bed-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Bedrooms
              </label>
              <input
                id={`bed-${unit.id}`}
                name="bedroom_count"
                type="number"
                min="0"
                step="1"
                defaultValue={unit.bedroom_count ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`full-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Full baths
              </label>
              <input
                id={`full-${unit.id}`}
                name="full_bathrooms"
                type="number"
                min="0"
                step="1"
                defaultValue={unit.full_bathrooms ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
            <div>
              <label htmlFor={`half-${unit.id}`} className="block text-[12px] font-medium text-ink">
                Half baths
              </label>
              <input
                id={`half-${unit.id}`}
                name="half_bathrooms"
                type="number"
                min="0"
                step="1"
                defaultValue={unit.half_bathrooms ?? ""}
                className="mt-1 w-full rounded-lg border border-line-strong px-3 py-2 text-[13px] text-ink"
              />
            </div>
          </div>
          {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <span className="text-[13px] font-medium text-ink">{unit.label}</span>
        <span className="ml-2 text-[12px] text-mute">{specsLine(unit)}</span>
      </div>
      {canEdit || canDelete ? (
        <div className="flex shrink-0 items-center gap-3">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[12px] text-mute underline-offset-2 hover:underline"
            >
              Edit
            </button>
          ) : null}
          {canDelete ? (
            confirming ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={deletePending}
                  onClick={() =>
                    startDelete(async () => {
                      setDeleteError(null);
                      const result = await deleteUnit(unit.id);
                      if (result.error) setDeleteError(result.error);
                      else setConfirming(false);
                    })
                  }
                  className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text hover:bg-bad-tint/80"
                >
                  {deletePending ? "Deleting…" : "Confirm delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[12px] text-mute underline-offset-2 hover:underline"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-[12px] text-bad-text underline-offset-2 hover:underline"
              >
                Delete
              </button>
            )
          ) : null}
        </div>
      ) : null}
      {deleteError ? (
        <p className="w-full text-[11px] text-bad-text">{deleteError}</p>
      ) : null}
    </li>
  );
}
