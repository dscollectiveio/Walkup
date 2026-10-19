"use client";

import { useState, useTransition } from "react";
import { deleteOwnershipAmendment } from "./actions";

export interface AmendmentHistoryEntry {
  id: string;
  effectiveFrom: string;
  reason: string | null;
  lines: { unitLabel: string; percentage: number }[];
}

/**
 * Every recorded change to the ownership shares, newest first. A board admin
 * can delete one (a change entered by mistake): the units' shares then go back
 * to the previous recorded split.
 */
export function AmendmentHistory({ amendments, canDelete = false }: { amendments: AmendmentHistoryEntry[]; canDelete?: boolean }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (amendments.length === 0) {
    return <p className="text-[12px] text-mute-soft">No ownership amendments recorded yet.</p>;
  }

  return (
    <div>
      <ul className="space-y-3">
        {amendments.map((a, i) => (
          <li key={a.id} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[12px] font-medium text-ink">
                Effective {a.effectiveFrom}
                {i === 0 ? <span className="ml-2 rounded-full bg-brass/20 px-2 py-0.5 text-[10px] font-semibold text-ink">Current</span> : null}
              </span>
              <span className="flex flex-wrap items-center gap-3">
                {a.reason ? <span className="text-[11px] text-mute">{a.reason}</span> : null}
                {canDelete ? (
                  confirming === a.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-mute">
                        {amendments.length === 1
                          ? "Removes the only recorded split, so units will show no share."
                          : i === 0
                            ? "The shares go back to the previous split."
                            : "Removes it from the history."}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            setError(null);
                            const r = await deleteOwnershipAmendment(a.id);
                            if ("error" in r) setError(r.error);
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
                    <button type="button" onClick={() => setConfirming(a.id)} className="text-[11px] text-bad-text underline-offset-2 hover:underline">
                      Delete
                    </button>
                  )
                ) : null}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
              {a.lines.map((l) => (
                <span key={l.unitLabel}>
                  {l.unitLabel} <span className="figures text-ink">{l.percentage}%</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-[11px] text-bad-text">{error}</p> : null}
    </div>
  );
}
