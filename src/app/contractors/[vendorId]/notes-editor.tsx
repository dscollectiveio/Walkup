"use client";

import { useState, useTransition } from "react";
import { updateVendorNotes } from "../vendor-actions";

export function NotesEditor({ vendorId, notes, canEdit }: { vendorId: string; notes: string | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <div className="space-y-2">
        <p className="whitespace-pre-wrap text-[13px] text-ink">{notes || <span className="text-mute">No notes yet.</span>}</p>
        {canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className="text-[12px] text-mute underline underline-offset-2">
            Edit notes
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`notes-${vendorId}`} className="sr-only">Notes</label>
      <textarea
        id={`notes-${vendorId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink"
      />
      {error ? <p className="text-[12px] text-bad-text">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await updateVendorNotes(vendorId, value);
              if (r.error) setError(r.error);
              else setEditing(false);
            })
          }
          className="min-h-[40px] rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save notes"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(notes ?? "");
            setEditing(false);
          }}
          className="min-h-[40px] rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
