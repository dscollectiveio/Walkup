"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { btnPrimary } from "@/components/repairs/styles";
import { confirmStripePayout } from "./stripe-payout-actions";
import type { StripePayoutView } from "@/lib/payments/payouts-load";

/**
 * Online dues waiting to reach the books (DECISIONS #57). One click posts a
 * payout's deposit: the dues per unit and Stripe's fee, in one entry.
 */
export function StripePayoutsCard({ payouts, canPost }: { payouts: StripePayoutView[]; canPost: boolean }) {
  return (
    <Card navy title="Online dues to confirm" hint="Stripe pays online dues into the bank in batches. Confirm each deposit once it shows up below.">
      <ul className="divide-y divide-line">
        {payouts.map((p) => (
          <PayoutLine key={p.payoutId} p={p} canPost={canPost} />
        ))}
      </ul>
    </Card>
  );
}

function PayoutLine({ p, canPost }: { p: StripePayoutView; canPost: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok?: true; error?: string } | null>(null);
  const done = result?.ok === true;

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink">{p.text}</p>
        <p className="mt-0.5 text-[12px] text-mute">{p.detail}</p>
        <p className="mt-0.5 text-[12px] text-mute">
          {p.deposit
            ? `Matches the ${p.deposit.amountLabel} deposit on ${p.deposit.postedOnLabel}. It's held here, not in the list below.`
            : (p.waitingLabel ?? "Waiting for the deposit to show up in the bank feed.")}
        </p>
        {result?.error ? (
          <p role="alert" className="mt-1 text-[12px] text-bad-text">
            {result.error}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="mt-1 text-[12px] text-good-text">
            Posted. Each unit is credited and the fee is in Bank &amp; Merchant Fees.
          </p>
        ) : null}
      </div>
      {canPost && p.deposit && p.ready && !done ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await confirmStripePayout(p.deposit!.id, p.payoutId)))}
          className={`${btnPrimary} shrink-0`}
        >
          {pending ? "Posting…" : "Confirm Stripe payout"}
        </button>
      ) : null}
      {canPost && p.deposit && !p.ready ? (
        <p className="shrink-0 text-[12px] text-mute sm:max-w-[220px]">
          Stripe hasn&rsquo;t reported every fee yet, or the payout includes more than dues. Check Stripe, then post it by hand if needed.
        </p>
      ) : null}
    </li>
  );
}
