"use client";

import { useState, useTransition } from "react";
import { confirmField, editField, leaveFieldBlank, resolveProposed } from "../../form-actions";

export interface FieldView {
  id: string;
  label: string;
  pdfFieldName: string;
  citation: string | null;
  value: string | null;
  confidence: "high" | "review" | "blank";
  sourceLine: string;
  sourceHref: string | null;
  proposedValue: string | null;
  confirmed: boolean;
  leaveBlank: boolean;
}

const btn = "min-h-[36px] rounded-md border border-line-strong bg-paper px-3 text-[12px] font-medium text-ink hover:bg-fill disabled:opacity-50";

export function FieldRow({ field, canEdit, locked }: { field: FieldView; canEdit: boolean; locked: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field.value ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else setEditing(false);
    });

  const tint =
    field.proposedValue !== null || (field.confidence === "review" && !field.confirmed)
      ? "bg-warning-tint"
      : field.value === null && !field.leaveBlank
        ? "bg-fill"
        : "";

  return (
    <li className={`-mx-3 rounded-lg px-3 py-3 ${tint}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-ink">{field.label}</div>
          <div className="mt-0.5 text-[11px] text-mute-soft">
            {field.citation ? `${field.citation} · ` : ""}
            <span className="font-mono">{field.pdfFieldName}</span>
          </div>
          <div className="mt-1 text-[12px] text-mute">
            {field.sourceHref ? (
              <a href={field.sourceHref} className="underline underline-offset-2">{field.sourceLine}</a>
            ) : (
              field.sourceLine
            )}
          </div>
        </div>
        <div className="text-right">
          {editing ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`v-${field.id}`}>{field.label}</label>
              <input
                id={`v-${field.id}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="figures min-h-[36px] w-40 rounded-lg border border-line-strong bg-paper px-2 text-[13px] text-ink"
              />
              <button type="button" disabled={pending} onClick={() => run(() => editField(field.id, value))} className={btn}>
                Save
              </button>
            </div>
          ) : (
            <div className="figures text-[15px] text-ink">
              {field.value ?? <span className="text-[12px] text-mute">{field.leaveBlank ? "Left blank" : "Blank"}</span>}
            </div>
          )}
          {field.confirmed && !editing ? <div className="text-[11px] text-good-text">Confirmed</div> : null}
        </div>
      </div>

      {field.proposedValue !== null ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-warning-text">
          Your records now say {field.proposedValue}, you entered {field.value ?? "nothing"}.
          {canEdit && !locked ? (
            <>
              <button type="button" disabled={pending} onClick={() => run(() => resolveProposed(field.id, "records"))} className={btn}>
                Use the records
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => resolveProposed(field.id, "mine"))} className={btn}>
                Keep mine
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {field.value === null && !field.leaveBlank && !editing ? (
        <p className="mt-2 text-[12px] text-mute">We couldn&rsquo;t find this in your records. Enter it or leave it blank.</p>
      ) : null}

      {canEdit && !locked && !editing ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {field.value !== null && !field.confirmed && field.proposedValue === null ? (
            <button type="button" disabled={pending} onClick={() => run(() => confirmField(field.id))} className={btn}>
              Confirm
            </button>
          ) : null}
          <button type="button" onClick={() => setEditing(true)} className={btn}>
            {field.value === null ? "Enter" : "Edit"}
          </button>
          {field.value === null && !field.leaveBlank ? (
            <button type="button" disabled={pending} onClick={() => run(() => leaveFieldBlank(field.id))} className={btn}>
              Leave blank
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-[12px] text-bad-text">{error}</p> : null}
    </li>
  );
}
