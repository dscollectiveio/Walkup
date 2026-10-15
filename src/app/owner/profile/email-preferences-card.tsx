"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui";
import { setMyEmailPreferences, type PreferencesState } from "./email-preferences-actions";

const row = "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border border-line px-3.5 py-3 text-[14px] text-ink has-[:checked]:bg-fill";

export function EmailPreferencesCard({
  email,
  initial,
}: {
  email: string;
  initial: { dues_reminders: boolean; statements: boolean; announcements: boolean; unsubscribed_all: boolean };
}) {
  const [state, action, pending] = useActionState<PreferencesState, FormData>(setMyEmailPreferences, { status: "idle" });
  const [stopAll, setStopAll] = useState(initial.unsubscribed_all);

  return (
    <Card title="Email from your association">
      <form action={action} className="space-y-3">
        <p className="text-[13px] text-mute">
          Choose which emails your board can send you through Walkup. They go to <span className="break-all text-ink">{email}</span>.
        </p>
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
        {stopAll ? (
          <>
            {initial.dues_reminders ? <input type="hidden" name="dues_reminders" value="on" /> : null}
            {initial.statements ? <input type="hidden" name="statements" value="on" /> : null}
            {initial.announcements ? <input type="hidden" name="announcements" value="on" /> : null}
          </>
        ) : null}
        <label className={row}>
          <input type="checkbox" name="stop_all" checked={stopAll} onChange={(e) => setStopAll(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>Stop all email</span>
        </label>
        <p className="text-[12px] text-mute">Account emails like sign-in links are separate and always sent.</p>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <span aria-live="polite" className={`text-[13px] ${state.status === "error" ? "text-bad-text" : "text-good-text"}`}>
            {state.status === "saved" ? "Saved." : state.status === "error" ? state.message : ""}
          </span>
        </div>
      </form>
    </Card>
  );
}
