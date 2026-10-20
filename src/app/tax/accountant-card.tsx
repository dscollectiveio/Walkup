"use client";

import { useActionState, useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { btnPrimary, btnSecondary } from "@/components/repairs/styles";
import { clearAccountant, setAccountant } from "./form-actions";

const inputClass = "mt-1 w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[13px] text-ink";
const primary = btnPrimary;
const secondary = btnSecondary;

/**
 * Who the drafts are addressed to. A contact, not an access grant: the
 * accountant is a persons row (DECISIONS #30) the board names here, and the
 * time-boxed "read the books" grant stays on the Building page. Every email
 * is a mailto: draft the person opens — Walkup sends nothing.
 */
export function AccountantCard({
  accountant,
  canWrite,
  headsUpHref,
}: {
  accountant: { fullName: string; firm: string | null; email: string | null } | null;
  canWrite: boolean;
  /** The heads-up draft, built by the page; null until an accountant is on file. */
  headsUpHref: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(setAccountant, null);
  const [removePending, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Close the form once a save lands (the server re-renders the contact).
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.ok) setEditing(false);
  }

  const showForm = canWrite && (editing || !accountant);

  return (
    <Card navy
      title="Your accountant"
      hint="Walkup drafts the emails and you send them from your own email app, so their replies come back to you."
    >
      {accountant && !editing ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-[13px]">
            <div className="font-medium text-ink">{accountant.fullName}</div>
            <div className="text-mute">
              {[accountant.firm, accountant.email].filter(Boolean).join(" · ") || "No email on file"}
            </div>
            <a href="/building" className="mt-1 inline-block text-[12px] text-mute underline-offset-2 hover:underline">
              Give them read access to the books →
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {headsUpHref ? (
              <a href={headsUpHref} className={primary}>
                Email a heads-up about this tax season
              </a>
            ) : null}
            {canWrite ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className={secondary}>
                  Change
                </button>
                <button
                  type="button"
                  disabled={removePending}
                  onClick={() =>
                    startRemove(async () => {
                      setRemoveError(null);
                      const r = await clearAccountant();
                      if (r.error) setRemoveError(r.error);
                    })
                  }
                  className="text-[12px] text-mute underline-offset-2 hover:underline disabled:opacity-50"
                >
                  {removePending ? "Removing…" : "Remove"}
                </button>
              </>
            ) : null}
          </div>
          {headsUpHref ? (
            <p className="w-full text-[11px] text-mute">Opens a draft in your email app. Nothing is sent until you send it.</p>
          ) : null}
          {removeError ? <p className="w-full text-[12px] text-bad-text">{removeError}</p> : null}
        </div>
      ) : null}

      {!accountant && !canWrite ? <p className="text-[13px] text-mute">No accountant on file yet. A board member can add one here.</p> : null}

      {showForm ? (
        <form action={action} className="space-y-3">
          {!accountant ? (
            <p className="text-[13px] text-mute">
              Add your accountant so the drafts are addressed to them. If you don&rsquo;t have one, the drafts still open
              with no recipient.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="accountant_full_name" className="block text-[12px] font-medium text-ink">
                Name
              </label>
              <input
                id="accountant_full_name"
                name="full_name"
                required
                defaultValue={accountant?.fullName ?? ""}
                className={inputClass}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="accountant_firm" className="block text-[12px] font-medium text-ink">
                Firm <span className="font-normal text-mute-soft">optional</span>
              </label>
              <input id="accountant_firm" name="firm" defaultValue={accountant?.firm ?? ""} className={inputClass} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="accountant_email" className="block text-[12px] font-medium text-ink">
                Email
              </label>
              <input
                id="accountant_email"
                name="email"
                type="email"
                required
                defaultValue={accountant?.email ?? ""}
                className={inputClass}
                autoComplete="off"
              />
            </div>
          </div>
          {state?.error ? <p className="text-[12px] text-bad-text">{state.error}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className={primary}>
              {pending ? "Saving…" : accountant ? "Save" : "Add your accountant"}
            </button>
            {accountant ? (
              <button type="button" onClick={() => setEditing(false)} className={secondary}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </Card>
  );
}
