"use client";

import { useActionState, useState } from "react";
import { setFilingSettings } from "./form-actions";

/**
 * The Illinois Secretary of State corporation file number, shown beside the
 * annual report's "File online" link because the portal asks for it first.
 * Not a tax figure — a lookup key the board would otherwise hunt for every
 * year.
 */
export function SosFileNumber({ current, canWrite }: { current: string | null; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(setFilingSettings, null);

  // Close the field once a save lands (the server re-renders the number).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setEditing(false);
  }

  const shown = current ? (
    <>
      Illinois SOS file number: <span className="figures text-ink">{current}</span>
    </>
  ) : canWrite ? (
    "Add your file number. The portal asks for it."
  ) : (
    "No Illinois SOS file number on file yet. The portal asks for it."
  );

  if (!canWrite || !editing) {
    return (
      <p id="sos-file-number" className="text-[12px] text-mute">
        {shown}
        {canWrite ? (
          <>
            {" "}
            <button type="button" onClick={() => setEditing(true)} className="underline underline-offset-2 hover:text-ink">
              {current ? "Change" : "Add it"}
            </button>
          </>
        ) : null}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="il_sos_file_number" className="block text-[12px] font-medium text-ink">
          Illinois SOS file number
        </label>
        <input
          id="il_sos_file_number"
          name="il_sos_file_number"
          defaultValue={current ?? ""}
          placeholder="On your articles of incorporation"
          autoComplete="off"
          className="mt-1 w-56 rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[13px] text-ink"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="min-h-[36px] rounded-md bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-[12px] text-mute underline-offset-2 hover:underline">
        Cancel
      </button>
      {state?.error ? <p className="w-full text-[12px] text-bad-text">{state.error}</p> : null}
    </form>
  );
}
