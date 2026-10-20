"use client";

import { useState, useTransition } from "react";
import { removeAttorneyShare, shareWithAttorney } from "./attorney-share-actions";
import { btnSecondary } from "@/components/repairs/styles";

const WHOLE_BUILDING = "building";

/** The shares one attorney has, with a way to add a unit (or the whole building) and take one away. */
export function AttorneyShareControls({
  personId,
  units,
  shares,
}: {
  personId: string;
  units: { id: string; label: string }[];
  shares: { id: string; unitId: string | null; label: string }[];
}) {
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sharedUnits = new Set(shares.map((s) => s.unitId ?? WHOLE_BUILDING));
  const options = [{ id: WHOLE_BUILDING, label: "Whole building (documents that belong to no unit)" }, ...units.map((u) => ({ id: u.id, label: u.label }))].filter(
    (o) => !sharedUnits.has(o.id),
  );

  function add() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const r = await shareWithAttorney(personId, choice === WHOLE_BUILDING ? null : choice);
      if ("error" in r) setError(r.error);
      else setChoice("");
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const r = await removeAttorneyShare(id);
      if ("error" in r) setError(r.error);
    });
  }

  return (
    <div className="space-y-2">
      {shares.length === 0 ? (
        <p className="text-[13px] text-mute">Nothing shared yet, so they can open nothing but what every owner can.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {shares.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-fill px-3 py-1 text-[12px] text-ink">
              <span>{s.label}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(s.id)}
                aria-label={`Stop sharing ${s.label}`}
                className="inline-flex min-h-[28px] min-w-[28px] items-center justify-center rounded-full text-mute hover:text-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`share-${personId}`}>
            What to share
          </label>
          <select
            id={`share-${personId}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink sm:max-w-[320px]"
          >
            <option value="">Choose a unit to share…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button type="button" disabled={pending || !choice} onClick={add} className={btnSecondary}>
            {pending ? "Saving…" : "Share"}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-bad-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
