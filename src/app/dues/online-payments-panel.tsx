"use client";

import { useActionState, useState } from "react";
import { btnDanger, btnLink, btnPrimary, btnSecondary } from "@/components/repairs/styles";
import {
  refreshOnlinePaymentsStatus,
  startOnlinePaymentsSetup,
  turnOffOnlinePayments,
  type OnlinePaymentsState,
} from "./online-payments-actions";

export type OnlinePaymentsStatus = "off" | "pending" | "ready";

/** What came back from Stripe's page, from ?online= on the return trip. */
export const RETURN_NOTICE: Record<string, { tone: "good" | "bad"; text: string }> = {
  connected: { tone: "good", text: "Stripe is connected." },
  canceled: { tone: "bad", text: "Setup was canceled on Stripe's page. Nothing changed." },
  expired: { tone: "bad", text: "That setup link expired or belonged to another sign-in. Start again." },
  taken: { tone: "bad", text: "That Stripe account is already connected to another association." },
  mode: { tone: "bad", text: "That Stripe account is in the wrong mode (test vs live). Nothing changed." },
  error: { tone: "bad", text: "Something went wrong connecting Stripe. Nothing changed. Try again." },
};

const FEE_LINE = "The association pays Stripe's fee: 0.8% per payment, never more than $5. Owners pay exactly what they owe.";

function Message({ state }: { state: OnlinePaymentsState | null }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="mt-2 text-[12px] text-bad-text">{state.error}</p>;
  if (state.ok) return <p role="status" className="mt-2 text-[12px] text-good-text">{state.ok}</p>;
  return null;
}

export function OnlinePaymentsPanel({
  status,
  canManage,
  configProblem,
  returnNotice,
}: {
  status: OnlinePaymentsStatus;
  /** Board admin: may set up, re-check and turn off. Everyone else reads the status. */
  canManage: boolean;
  /** Set when Walkup itself isn't configured for Connect (no client id, no Stripe key). */
  configProblem: string | null;
  returnNotice: string | null;
}) {
  const [setupState, setup, settingUp] = useActionState(async () => startOnlinePaymentsSetup(), null);
  const [checkState, check, checking] = useActionState(async () => refreshOnlinePaymentsStatus(), null);
  const [offState, turnOff, turningOff] = useActionState(async () => turnOffOnlinePayments(), null);
  const [confirmOff, setConfirmOff] = useState(false);
  const notice = returnNotice ? RETURN_NOTICE[returnNotice] : null;

  return (
    <section id="online-payments" aria-labelledby="online-payments-title" className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="online-payments-title" className="text-[13px] font-semibold text-ink">
          Online payments
        </h3>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status === "ready" ? "bg-good-tint text-good-text" : status === "pending" ? "bg-warning-tint text-warning-text" : "bg-fill text-mute"
          }`}
        >
          {status === "ready" ? "On" : status === "pending" ? "Waiting on Stripe" : "Coming soon"}
        </span>
      </div>

      {notice ? (
        <p role="status" className={`mt-2 text-[12px] ${notice.tone === "good" ? "text-good-text" : "text-bad-text"}`}>
          {notice.text}
        </p>
      ) : null}

      {status === "off" ? (
        <>
          <p className="mt-1.5 max-w-prose text-[13px] text-ink">
            Soon owners will be able to pay dues by bank transfer right here. The money goes straight to the
            association&rsquo;s bank. Walkup never holds it.
          </p>
          {canManage ? (
            configProblem ? (
              <p className="mt-3 text-[12px] text-mute">{configProblem}</p>
            ) : (
              <form action={setup} className="mt-3">
                <button type="submit" disabled={settingUp} className={btnPrimary}>
                  {settingUp ? "Opening Stripe…" : "Set up online payments"}
                </button>
                <Message state={setupState} />
              </form>
            )
          ) : (
            <p className="mt-3 text-[12px] text-mute">A board admin can turn this on.</p>
          )}
        </>
      ) : null}

      {status === "pending" ? (
        <>
          <p className="mt-1.5 max-w-prose text-[13px] text-ink">
            Stripe is connected but needs a few more details before owners can pay. Finish them in the
            association&rsquo;s Stripe dashboard.
          </p>
          {canManage ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a href="https://dashboard.stripe.com/" target="_blank" rel="noopener noreferrer" className={btnPrimary}>
                Open Stripe
              </a>
              <form action={check}>
                <button type="submit" disabled={checking} className={btnSecondary}>
                  {checking ? "Checking…" : "Check again"}
                </button>
              </form>
            </div>
          ) : null}
          <Message state={checkState} />
        </>
      ) : null}

      {status === "ready" ? (
        <>
          <p className="mt-1.5 max-w-prose text-[13px] text-ink">
            Owners see a Pay button for their full balance. Bank transfers take about 4 business days, and a
            payment shows as pending until it clears.
          </p>
          <p className="mt-1 max-w-prose text-[12px] text-mute">
            {FEE_LINE} Each Stripe deposit is confirmed in the bank feed, which records the dues and the fee.
          </p>
        </>
      ) : null}

      {canManage && status !== "off" ? (
        <div className="mt-3">
          {confirmOff ? (
            <form action={turnOff} className="rounded-lg border border-bad-line bg-bad-tint/40 p-3">
              <p className="text-[13px] text-ink">
                Turn off online payments? Owners stop seeing the Pay button. Payments already started still finish.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" disabled={turningOff} className={btnDanger}>
                  {turningOff ? "Turning off…" : "Turn off"}
                </button>
                <button type="button" onClick={() => setConfirmOff(false)} className={btnSecondary}>
                  Keep it on
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setConfirmOff(true)} className={btnLink}>
              Turn off online payments
            </button>
          )}
        </div>
      ) : null}
      <Message state={offState} />
    </section>
  );
}
