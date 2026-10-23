"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnLink, btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { endEarlyAccess, extendTrial, grantComp, refreshFromStripe, revokeComp, schedulePriceChange, type AdminBillingState } from "./actions";

const KIND_LABELS: Record<string, string> = {
  early_access: "Early access",
  founding: "Founding offer (free first year)",
  friend: "Friend",
  pilot: "Pilot",
  nonprofit: "Nonprofit",
  other: "Other",
};

function Status({ state }: { state: AdminBillingState | null }) {
  if (state?.error) return <p role="alert" className={errorClass}>{state.error}</p>;
  if (state?.ok) return <p className="text-[13px] text-good-text">Saved.</p>;
  return null;
}

export function AdminBillingRowActions({
  associationId,
  name,
  compActive,
  compKind,
  subscriptionId,
}: {
  associationId: string;
  name: string;
  compActive: boolean;
  compKind: string | null;
  subscriptionId: string | null;
}) {
  const [open, setOpen] = useState<"comp" | "trial" | "early" | null>(null);
  const [earlyState, earlyAction, earlyPending] = useActionState(endEarlyAccess, null);
  const [compState, compAction, compPending] = useActionState(grantComp, null);
  const [endState, endAction, endPending] = useActionState(revokeComp, null);
  const [trialState, trialAction, trialPending] = useActionState(extendTrial, null);
  const [refreshState, refreshAction, refreshPending] = useActionState(refreshFromStripe, null);
  const key = associationId.slice(0, 8);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnLink} onClick={() => setOpen(open === "comp" ? null : "comp")}>
          {compActive ? "Change comp" : "Give complimentary access"}
        </button>
        <button type="button" className={btnLink} onClick={() => setOpen(open === "trial" ? null : "trial")}>
          Extend trial
        </button>
        {compActive && compKind === "early_access" ? (
          <button type="button" className={btnLink} onClick={() => setOpen(open === "early" ? null : "early")}>
            Set the end of early access
          </button>
        ) : null}
        {compActive ? (
          <form
            action={endAction}
            onSubmit={(e) => {
              const warn =
                compKind === "early_access" || compKind === "founding"
                  ? " The Terms promise advance notice before this ends, so use it only for a test building. For a real customer, set an end date instead."
                  : "";
              if (!window.confirm(`End complimentary access for ${name}? The history is kept.${warn}`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="association_id" value={associationId} />
            <button type="submit" disabled={endPending} className={btnDanger}>
              {endPending ? "Ending…" : "End comp"}
            </button>
          </form>
        ) : null}
        {subscriptionId ? (
          <form action={refreshAction}>
            <input type="hidden" name="association_id" value={associationId} />
            <input type="hidden" name="subscription_id" value={subscriptionId} />
            <button type="submit" disabled={refreshPending} className={btnSecondary}>
              {refreshPending ? "Refreshing…" : "Refresh from Stripe"}
            </button>
          </form>
        ) : null}
      </div>
      <Status state={endState} />
      <Status state={refreshState} />

      {open === "comp" ? (
        <form action={compAction} className="space-y-3 rounded-lg border border-line p-3">
          <input type="hidden" name="association_id" value={associationId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`ck-${key}`} className={labelClass}>Kind</label>
              <select id={`ck-${key}`} name="kind" defaultValue="friend" className={inputClass}>
                {Object.entries(KIND_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`cr-${key}`} className={labelClass}>Reason (only you see it)</label>
              <input id={`cr-${key}`} name="reason" required maxLength={300} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`ce-${key}`} className={labelClass}>Ends on (optional)</label>
              <input id={`ce-${key}`} name="expires_on" type="date" className={inputClass} />
            </div>
          </div>
          <p className="text-[12px] text-mute">
            Leave the end date blank for free until you end it. Early access can&rsquo;t end sooner than 90 days from today, and a founding
            offer needs the day its free year ends (at least 30 days away): the board admins are emailed about the date automatically.
            Any current comp is ended and kept in the history.
          </p>
          <Status state={compState} />
          <button type="submit" disabled={compPending} className={btnPrimary}>
            {compPending ? "Saving…" : "Save comp"}
          </button>
        </form>
      ) : null}

      {open === "early" ? (
        <form action={earlyAction} className="space-y-3 rounded-lg border border-line p-3">
          <input type="hidden" name="association_id" value={associationId} />
          <div className="max-w-[240px]">
            <label htmlFor={`ee-${key}`} className={labelClass}>Free early access ends on</label>
            <input id={`ee-${key}`} name="ends_on" type="date" required className={inputClass} />
          </div>
          <p className="text-[12px] text-mute">At least 90 days from today. {name}&rsquo;s board admins are emailed this date within a day, and it shows in Walkup.</p>
          <Status state={earlyState} />
          <button type="submit" disabled={earlyPending} className={btnPrimary}>
            {earlyPending ? "Saving…" : "Set the end date"}
          </button>
        </form>
      ) : null}

      {open === "trial" ? (
        <form action={trialAction} className="space-y-3 rounded-lg border border-line p-3">
          <input type="hidden" name="association_id" value={associationId} />
          <div className="max-w-[240px]">
            <label htmlFor={`tu-${key}`} className={labelClass}>Last day of the trial</label>
            <input id={`tu-${key}`} name="trial_until" type="date" required className={inputClass} />
          </div>
          <Status state={trialState} />
          <button type="submit" disabled={trialPending} className={btnPrimary}>
            {trialPending ? "Saving…" : "Save trial"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/** Schedules a price change for every building. The database insists on 30 days' notice. */
export function SchedulePriceChangeForm() {
  const [state, action, pending] = useActionState(schedulePriceChange, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="pc-date" className={labelClass}>New price starts</label>
          <input id="pc-date" name="effective_on" type="date" required className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pc-detail" className={labelClass}>What changes (shown to customers)</label>
          <textarea id="pc-detail" name="detail" required maxLength={600} rows={2} className={inputClass} />
        </div>
      </div>
      <p className="text-[12px] text-mute">
        At least 30 days from today. Every building&rsquo;s board admins are emailed within a day and see it in Walkup. Changing the price
        in Stripe is separate: do that on or after the start date.
      </p>
      <Status state={state} />
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Scheduling…" : "Schedule and notify"}
      </button>
    </form>
  );
}
