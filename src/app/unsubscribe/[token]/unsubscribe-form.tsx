"use client";

import { useActionState, useState } from "react";
import { saveEmailChoices, type SaveState } from "../actions";
import { NOTE_ACCOUNT_EMAILS, type Choices } from "@/lib/email-outbox/unsubscribe";

const row = "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-line px-3.5 py-3 text-[14px] text-ink has-[:checked]:bg-fill";

export function UnsubscribeForm({ token, associationName, initial }: { token: string; associationName: string; initial: Choices }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveEmailChoices, { status: "idle" });
  const [stopAll, setStopAll] = useState(initial.stop_all);

  return (
    <form action={action} className="mt-5 space-y-3">
      <input type="hidden" name="token" value={token} />
      <fieldset className="space-y-3" disabled={stopAll}>
        <legend className="sr-only">Kinds of email</legend>
        <label className={row}>
          <input type="checkbox" name="dues_reminders" defaultChecked={initial.dues_reminders} className="mt-0.5 h-4 w-4" />
          <span>Dues reminders and late fee notices</span>
        </label>
        <label className={row}>
          <input type="checkbox" name="statements" defaultChecked={initial.statements} className="mt-0.5 h-4 w-4" />
          <span>Statements</span>
        </label>
        <label className={row}>
          <input type="checkbox" name="announcements" defaultChecked={initial.announcements} className="mt-0.5 h-4 w-4" />
          <span>Announcements</span>
        </label>
      </fieldset>
      <label className={row}>
        <input
          type="checkbox"
          name="stop_all"
          checked={stopAll}
          onChange={(e) => setStopAll(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>Stop all email from {associationName}</span>
      </label>
      {/* A disabled fieldset is not submitted, so keep the three choices when "stop all" is on. */}
      {stopAll ? (
        <>
          {initial.dues_reminders ? <input type="hidden" name="dues_reminders" value="on" /> : null}
          {initial.statements ? <input type="hidden" name="statements" value="on" /> : null}
          {initial.announcements ? <input type="hidden" name="announcements" value="on" /> : null}
        </>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-[48px] w-full items-center justify-center rounded-lg bg-[#1B2A41] px-4 text-[15px] font-semibold text-white hover:bg-[#283B5A] disabled:opacity-60"
      >
        {pending ? "Saving..." : "Save"}
      </button>
      <div aria-live="polite" className="min-h-[1.25rem] text-[13px]">
        {state.status === "saved" ? <p className="text-good-text">{state.message}</p> : null}
        {state.status === "error" ? <p className="text-bad-text">{state.message}</p> : null}
      </div>
      <p className="text-[12px] text-mute">{NOTE_ACCOUNT_EMAILS}</p>
    </form>
  );
}
