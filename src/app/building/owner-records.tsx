"use client";

import { useState, useTransition } from "react";
import { deleteUnitOwner } from "./actions";

/** One ownership record for a unit: a current or past owner and the dates. */
export interface OwnershipRecord {
  rowId: string;
  name: string;
  from: string;
  /** The last day they were in the unit, or null while they still are. */
  to: string | null;
}

/**
 * Who has owned each unit and when, newest first. A board admin can delete a
 * record that was entered by mistake. To record that someone moved out, use
 * Edit on the unit and take them off it.
 */
export function OwnerRecordsHistory({
  units,
  canDelete,
}: {
  units: { id: string; label: string; records: OwnershipRecord[] }[];
  canDelete: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const withRecords = units.filter((u) => u.records.length > 0);
  if (withRecords.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="text-[12px] font-bold text-ink">Owner records</h4>
      <p className="mt-0.5 text-[11px] text-mute-soft">
        Who has owned each unit and when.
        {canDelete ? " Delete is for a record entered by mistake. To record that someone moved out, use Edit on the unit and take them off it." : ""}
      </p>
      <div className="mt-2 space-y-3">
        {withRecords.map((u) => (
          <div key={u.id}>
            <div className="text-[11px] font-medium uppercase tracking-wide text-mute">{u.label}</div>
            <ul className="divide-y divide-line">
              {u.records.map((r) => (
                <li key={r.rowId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5 text-[12px]">
                  <span className="text-ink">
                    {r.name} <span className="text-mute">· {r.from} to {r.to ?? "now"}</span>
                  </span>
                  {canDelete ? (
                    confirming === r.rowId ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-mute">Deletes the record as if it never happened.</span>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              setError(null);
                              const result = await deleteUnitOwner(r.rowId, u.id);
                              if ("error" in result && result.error) setError(result.error);
                              else setConfirming(null);
                            })
                          }
                          className="rounded-md border border-bad-line bg-bad-tint px-2.5 py-1 text-[11px] font-medium text-bad-text"
                        >
                          {pending ? "Deleting…" : "Confirm delete"}
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="text-[11px] text-mute underline-offset-2 hover:underline">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirming(r.rowId)} className="text-[11px] text-bad-text underline-offset-2 hover:underline">
                        Delete
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {error ? <p className="mt-2 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
