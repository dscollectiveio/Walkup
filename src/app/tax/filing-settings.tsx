"use client";

import { useActionState, useState } from "react";
import { COPY_A_NOTE } from "@/lib/tax/copy";
import { setFilingSettings } from "./form-actions";

type Method = "paper" | "electronic" | null;

const METHODS: { value: "paper" | "electronic" | ""; label: string; current: Method }[] = [
  { value: "paper", label: "On paper", current: "paper" },
  { value: "electronic", label: "Electronically (IRIS)", current: "electronic" },
  { value: "", label: "Not sure yet", current: null },
];

const METHOD_WORDS: Record<"paper" | "electronic" | "null", string> = {
  paper: "on paper",
  electronic: "electronically, through IRIS",
  null: "not decided yet, Form 1096 reads “ask your CPA” until you say",
};

/**
 * "How do you file 1099s with the IRS?" — the one stored answer Form 1096
 * turns on (paper → needed, electronic → not needed, unanswered → ask your
 * CPA). Each button submits just its own value; the action carries the other
 * setting (the Illinois file number) through unchanged, since one RPC writes
 * both.
 */
export function FilingMethodChooser({ current, canWrite }: { current: Method; canWrite: boolean }) {
  const [state, action, pending] = useActionState(setFilingSettings, null);

  return (
    <div id="filing-method" className="rounded-xl border border-line bg-paper px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-ink">How do you file 1099s with the IRS?</h3>
          <p className="mt-0.5 text-[12px] text-mute">Currently: {METHOD_WORDS[current ?? "null"]}.</p>
        </div>
        {canWrite ? (
          <form action={action} className="flex flex-wrap gap-2">
            {METHODS.map((m) => {
              const selected = m.current === current;
              return (
                <button
                  key={m.label}
                  type="submit"
                  name="information_returns_filing"
                  value={m.value}
                  disabled={pending}
                  aria-pressed={selected}
                  className={`min-h-[36px] rounded-md border px-3 text-[12px] font-medium disabled:opacity-50 ${
                    selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-fill"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </form>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-mute">Form 1096 is only needed with paper 1099s. {COPY_A_NOTE}</p>
      {state?.error ? <p className="mt-2 text-[12px] text-bad-text">{state.error}</p> : null}
    </div>
  );
}

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
