"use client";

import { useState, useTransition } from "react";
import { applySuggestedBudget } from "./actions";

/**
 * Last year's actual spending, offered as a starting budget. Clearly labeled
 * a suggestion, and it takes two clicks to apply — nothing is filled in on
 * the board's behalf.
 */
export function SuggestedBudget({
  associationId,
  fiscalYearId,
  fundId,
  priorLabel,
  lines,
}: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  priorLabel: string;
  lines: { accountId: string; name: string; amountCents: number }[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

  return (
    <div className="rounded-lg border border-line bg-fill p-4">
      <p className="text-[13px] font-medium text-ink">Suggestion: start from what you spent in {priorLabel}</p>
      <p className="mt-0.5 text-[12px] text-mute">
        These are last year&rsquo;s actual totals, not a recommendation. Adjust any line afterwards.
      </p>
      <ul className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        {lines.map((l) => (
          <li key={l.accountId} className="flex justify-between gap-3">
            <span className="text-mute">{l.name}</span>
            <span className="figures text-ink">{money(l.amountCents)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await applySuggestedBudget({
                    associationId,
                    fiscalYearId,
                    fundId,
                    lines: lines.map((l) => ({ accountId: l.accountId, amount: l.amountCents / 100 })),
                  });
                  if (r.error) setError(r.error);
                })
              }
              className="min-h-[44px] rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid disabled:opacity-50"
            >
              {pending ? "Setting the budget…" : "Yes, use these amounts"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[44px] rounded-md border border-line-strong px-4 py-2 text-[13px] text-ink hover:bg-fill"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="min-h-[44px] rounded-md border border-line-strong bg-paper px-4 py-2 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Use these as this year&rsquo;s budget
          </button>
        )}
        {error ? <span className="w-full text-[12px] text-bad-text">{error}</span> : null}
      </div>
    </div>
  );
}
