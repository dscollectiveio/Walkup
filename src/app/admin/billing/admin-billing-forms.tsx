"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnLink, btnPrimary, btnSecondary, errorClass, inputClass, labelClass } from "@/components/repairs/styles";
import { extendTrial, grantComp, refreshFromStripe, revokeComp, type AdminBillingState } from "./actions";

const KIND_LABELS: Record<string, string> = {
  early_access: "Early access",
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
  subscriptionId,
}: {
  associationId: string;
  name: string;
  compActive: boolean;
  subscriptionId: string | null;
}) {
  const [open, setOpen] = useState<"comp" | "trial" | null>(null);
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
        {compActive ? (
          <form
            action={endAction}
            onSubmit={(e) => {
              if (!window.confirm(`End complimentary access for ${name}? The history is kept.`)) e.preventDefault();
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
          <p className="text-[12px] text-mute">Leave the end date blank for free until you end it. Any current comp is ended and kept in the history.</p>
          <Status state={compState} />
          <button type="submit" disabled={compPending} className={btnPrimary}>
            {compPending ? "Saving…" : "Save comp"}
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
