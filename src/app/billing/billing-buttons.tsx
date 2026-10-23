"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { btnPrimary, btnSecondary, choiceRow, errorClass } from "@/components/repairs/styles";
import { openPortal, requestRefund, setAutoRenew, startCheckout, upgradeToYearly, type BillingActionState } from "./actions";
import { REFUND_OFFER, REFUND_WINDOW_DAYS, type RefundKind } from "@/lib/billing/refund";

/** "Choose a plan": monthly or yearly, then Stripe's hosted checkout. */
export function ChoosePlanForm({ planName, month, year }: { planName: string; month: number; year: number }) {
  const [state, action, pending] = useActionState<BillingActionState | null, FormData>(startCheckout, null);
  return (
    <form action={action} className="space-y-3">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="mb-2 text-[13px] font-medium text-ink">{planName} plan</legend>
        <label className={choiceRow}>
          <input type="radio" name="interval" value="month" defaultChecked />
          <span>
            ${month} a month
          </span>
        </label>
        <label className={choiceRow}>
          <input type="radio" name="interval" value="year" />
          <span>
            ${year} a year <span className="text-mute">(2 months free)</span>
          </span>
        </label>
      </fieldset>
      {state?.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={btnPrimary}>
        {pending ? "Opening Stripe…" : "Choose a plan"}
      </button>
      <p className="text-[12px] text-mute">
        You enter payment details on Stripe&rsquo;s secure page. Walkup never sees your card or bank numbers.
      </p>
    </form>
  );
}

/** "Manage billing": Stripe's hosted portal for cards, invoices and cancelling. */
export function ManageBillingButton() {
  const [state, action, pending] = useActionState<BillingActionState | null>(openPortal, null);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className={btnSecondary}>
        {pending ? "Opening Stripe…" : "Manage billing"}
      </button>
      {state?.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
      <p className="text-[12px] text-mute">Update your card, see invoices or cancel, on Stripe&rsquo;s secure page.</p>
    </form>
  );
}

/**
 * "Switch to yearly": shows what it saves, asks once to confirm, and tells the
 * truth about the charge (the unused part of this month is credited).
 */
export function UpgradeToYearly({ planName, month, year, renewsOn }: { planName: string; month: number; year: number; renewsOn: string }) {
  const [state, action, pending] = useActionState<(BillingActionState & { ok?: boolean }) | null>(upgradeToYearly, null);
  const [confirming, setConfirming] = useState(false);
  const savings = month * 12 - year;
  if (state?.ok) {
    return (
      <div className="rounded-xl border border-good-line bg-good-tint p-5" role="status">
        <p className="text-[15px] font-semibold text-good-text">You&rsquo;re switched to yearly billing.</p>
        <p className="mt-1 text-[13px] text-good-text">
          Stripe is confirming it. This page shows your yearly plan within a minute, and you&rsquo;ll get a receipt by email.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-brass/60 bg-brass/10 p-5">
      <p className="text-[15px] font-semibold text-ink">
        Save ${savings} a year: switch to yearly
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-mute">
        Pay ${year} once a year for the {planName} plan instead of ${month} a month (${month * 12} over a year). That&rsquo;s 2 months free.
      </p>
      {confirming ? (
        <form action={action} className="mt-4 space-y-3">
          <p className="text-[13px] leading-relaxed text-ink">
            Switching charges ${year} now, minus a credit for the unused part of this month (your plan renews on {renewsOn}). Your
            yearly period starts today, and it renews each year until you cancel.
          </p>
          {state?.error ? (
            <p role="alert" className={errorClass}>
              {state.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Switching…" : `Confirm: switch to yearly`}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnSecondary}>
              Not now
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={`${btnPrimary} mt-4`}>
          Switch to yearly
        </button>
      )}
    </div>
  );
}

/**
 * The auto-renew switch: on says when the next charge is and that it renews by itself; off says when the plan ends.
 * Turning it off asks once, in words; turning it back on is one click. A board admin only (the caller decides).
 */
export function AutoRenewSwitch({ renewing, date, interval }: { renewing: boolean; date: string; interval: "month" | "year" | null }) {
  const [state, action, pending] = useActionState<(BillingActionState & { ok?: boolean }) | null, FormData>(setAutoRenew, null);
  const [confirming, setConfirming] = useState(false);
  // After a successful change the page refreshes with the new truth; until then show what was just asked for.
  const nowRenewing = state?.ok ? !renewing : renewing;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-ink">Auto-renew is {nowRenewing ? "on" : "off"}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-mute">
            {nowRenewing
              ? `Your plan renews by itself each ${interval === "year" ? "year" : "month"}. The next renewal is ${date}.`
              : `Your plan ends on ${date} and won't be charged again. Everything stays viewable and downloadable after that.`}
          </p>
        </div>
        {state?.ok ? (
          <p role="status" className="text-[13px] text-good-text">
            Saved. This page confirms it within a minute.
          </p>
        ) : nowRenewing ? (
          !confirming ? (
            <button type="button" onClick={() => setConfirming(true)} className={btnSecondary}>
              Turn off auto-renew
            </button>
          ) : null
        ) : (
          <form action={action}>
            <input type="hidden" name="renew" value="on" />
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Turn auto-renew back on"}
            </button>
          </form>
        )}
      </div>
      {nowRenewing && confirming && !state?.ok ? (
        <form action={action} className="space-y-3 rounded-lg border border-line bg-fill p-4">
          <input type="hidden" name="renew" value="off" />
          <p className="text-[13px] leading-relaxed text-ink">
            Your plan will end on {date}. You keep full use until then, nothing is charged again, and you can turn auto-renew back on any time before that day.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={pending} className={btnPrimary}>
              {pending ? "Saving…" : "Yes, turn it off"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className={btnSecondary}>
              Keep auto-renew on
            </button>
          </div>
        </form>
      ) : null}
      {state?.error ? (
        <p role="alert" className={errorClass}>
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Request a refund" for a yearly plan, inside the 14 days. It opens a pop-up that first makes an offer (2 free
 * months, then $15 a month for 4), and only a "No thanks" leads to the refund request itself. Either way the
 * request goes to support, who act on it by hand; Walkup never moves money.
 */
export function RefundRequest({ until }: { until: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"offer" | "refund" | "done">("offer");
  const [doneKind, setDoneKind] = useState<RefundKind>("refund");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (kind: RefundKind) =>
    start(async () => {
      setError(null);
      const r = await requestRefund(kind, kind === "refund" ? reason : "");
      if (r.error) return setError(r.error);
      setDoneKind(kind);
      setStep("done");
    });

  return (
    <div className="space-y-2">
      <button
        type="button"
        className={btnSecondary}
        onClick={() => {
          setStep("offer");
          setError(null);
          dialogRef.current?.showModal();
        }}
      >
        Request a refund
      </button>
      <p className="text-[12px] text-mute">
        A yearly charge can be refunded in full for {REFUND_WINDOW_DAYS} days after it is taken. You can ask until {until}.
      </p>
      <dialog
        ref={dialogRef}
        aria-label="Request a refund"
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[min(520px,94vw)] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50"
      >
        <header className="band bg-ink px-5 py-3">
          <h2 className="eyebrow text-paper">{step === "offer" ? "Before you go" : step === "refund" ? "Request a refund" : "Thank you"}</h2>
        </header>
        <div className="space-y-4 px-5 py-5">
          {step === "offer" ? (
            <>
              <div className="rounded-lg border border-brass/60 bg-brass/10 p-4">
                <p className="text-[15px] font-semibold text-ink">{REFUND_OFFER.headline}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink">{REFUND_OFFER.body}</p>
                <p className="mt-2 text-[12px] text-mute">{REFUND_OFFER.fine}</p>
              </div>
              {error ? (
                <p role="alert" className={errorClass}>
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => send("offer")} className={btnPrimary}>
                  {pending ? "Sending…" : REFUND_OFFER.take}
                </button>
                <button type="button" disabled={pending} onClick={() => setStep("refund")} className={btnSecondary}>
                  {REFUND_OFFER.decline}
                </button>
              </div>
            </>
          ) : step === "refund" ? (
            <>
              <p className="text-[13px] leading-relaxed text-ink">
                We&rsquo;ll refund your yearly charge in full. Tell us what went wrong if you like; it helps us fix it. Your plan ends once the refund is made, and
                everything stays viewable and downloadable.
              </p>
              <label className="block text-[12px] font-medium text-ink" htmlFor="refund-reason">
                What happened? <span className="font-normal text-mute">optional</span>
              </label>
              <textarea
                id="refund-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[16px] text-ink sm:text-[13px]"
              />
              {error ? (
                <p role="alert" className={errorClass}>
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending} onClick={() => send("refund")} className={btnPrimary}>
                  {pending ? "Sending…" : "Send my refund request"}
                </button>
                <button type="button" disabled={pending} onClick={() => setStep("offer")} className={btnSecondary}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-ink">
                {doneKind === "offer"
                  ? "Got it. We'll email you to confirm your 2 free months and the $15 a month after that."
                  : "Got it. We'll refund your yearly charge and email you when it is done."}
              </p>
              <button type="button" onClick={() => dialogRef.current?.close()} className={btnPrimary}>
                Close
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
