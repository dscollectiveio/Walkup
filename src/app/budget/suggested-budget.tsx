"use client";

import { useState, useTransition } from "react";
import { applySuggestedBudget } from "./actions";
import { btnPrimary } from "@/components/repairs/styles";

const BUMPS = [0, 2, 3, 5] as const;

/**
 * A starting budget, offered two ways: last year's budget copied forward
 * (with an optional percent bump), or — when there was no budget — last
 * year's actual spending. Clearly labeled a suggestion, and it takes two
 * clicks to apply; nothing is filled in on the board's behalf.
 */
export function SuggestedBudget({
  associationId,
  fiscalYearId,
  fundId,
  priorLabel,
  source,
  lines,
}: {
  associationId: string;
  fiscalYearId: string;
  fundId: string;
  priorLabel: string;
  source: "budget" | "actuals";
  lines: { accountId: string; name: string; amountCents: number }[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [bump, setBump] = useState<(typeof BUMPS)[number]>(0);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  const adjusted = lines.map((l) => ({ ...l, amountCents: Math.round((l.amountCents * (100 + bump)) / 100) }));
  const total = adjusted.reduce((s, l) => s + l.amountCents, 0);

  return (
    <div className="rounded-lg border border-line bg-fill p-4">
      <p className="text-[13px] font-medium text-ink">
        {source === "budget" ? `Start from the ${priorLabel} budget` : `Start from what you spent in ${priorLabel}`}
      </p>
      <p className="mt-0.5 text-[12px] text-mute">
        {source === "budget"
          ? "Last year's plan, copied forward. Add a few percent for rising costs if you like, then adjust any line."
          : "These are last year's actual totals, not a recommendation. Adjust any line afterwards."}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-mute">Adjust everything by</span>
        <div className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {BUMPS.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBump(b)}
              aria-pressed={bump === b}
              className={`rounded-full px-2.5 py-1 font-medium ${bump === b ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
            >
              {b === 0 ? "none" : `+${b}%`}
            </button>
          ))}
        </div>
        <span className="figures ml-auto text-ink">{money(total)} a year</span>
      </div>

      <ul className="mt-3 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        {adjusted.map((l) => (
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
                    lines: adjusted.map((l) => ({ accountId: l.accountId, amount: l.amountCents / 100 })),
                  });
                  if (r.error) setError(r.error);
                })
              }
              className={btnPrimary}
            >
              {pending ? "Setting the budget…" : `Yes, use these ${lines.length} amounts`}
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
