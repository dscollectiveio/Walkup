import { ChevronRight, TriangleAlert } from "lucide-react";
import { formatMoney } from "@/lib/tax/form1120h";
import { ReserveTargetForm } from "./reserve-target-form";
import { Donut } from "./donut";
import type { SnapshotTile } from "@/lib/home/snapshot";

const TILE_TONE: Record<SnapshotTile["tone"], string> = {
  neutral: "border-warning-line bg-warning-tint hover:brightness-[0.98]",
  attention: "border-warning-line bg-warning-tint hover:brightness-[0.98]",
  good: "border-info-line bg-info-tint hover:brightness-[0.98]",
};
const TILE_TEXT: Record<SnapshotTile["tone"], string> = {
  neutral: "text-warning-text",
  attention: "text-warning-text",
  good: "text-info-text",
};

/**
 * "Where the association stands": the money picture in one card, with a
 * "Status Check" list of tiles right under the charts. The card is only as tall
 * as what is in it, and sets the height of the row; the to-do card beside it matches that height.
 */
export function Standing({
  totalCents,
  operatingCents,
  reserveCents,
  reserveTarget, // display-only: drives a meter, not a ledger figure
  canSetTarget,
  tiles = [],
  source = "books",
  booksGap = null,
}: {
  totalCents: number;
  operatingCents: number;
  reserveCents: number;
  reserveTarget: number | null;
  canSetTarget: boolean;
  /** "Status Check" tiles — real figures, or a nudge to set the thing up. */
  tiles?: SnapshotTile[];
  /** Where the balances come from: the bank (the source of truth), or the books when no bank is connected. */
  source?: "bank" | "books";
  /** Books cash minus bank cash, when they differ, and how many bank transactions are still waiting. */
  booksGap?: { cents: number; waiting: number } | null;
}) {
  const targetCents = reserveTarget ? Math.round(reserveTarget * 100) : null;
  // Between 0 and 1. Rounded down for the label, so 99.6% never reads as
  // "100% of the target" while money is still to go.
  const funded =
    targetCents && targetCents > 0 ? Math.max(0, Math.min(1, reserveCents / targetCents)) : null;
  const fundedPct = funded === null ? 0 : reserveCents >= (targetCents ?? 0) ? 100 : Math.floor(funded * 100);
  // What is said can pass 100% (a reserve over its target); the ring itself stops at full.
  const fundedLabelPct =
    funded === null || !targetCents ? 0 : Math.max(0, Math.floor((reserveCents / targetCents) * 100));
  const remainingCents = targetCents ? Math.max(0, targetCents - reserveCents) : 0;
  // Each fund's share of the total, from the same two figures shown above. Skipped when either is negative or nothing is held.
  const split =
    totalCents > 0 && operatingCents >= 0 && reserveCents >= 0
      ? (() => {
          const reserve = Math.round((reserveCents / totalCents) * 100);
          return { reserve, operating: 100 - reserve };
        })()
      : null;

  return (
    <section
      className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-paper"
    >
      <header className="flex min-h-[4rem] shrink-0 flex-col justify-center rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="eyebrow text-paper">Where the association stands</h2>
            <p className="mt-0.5 text-[12px] text-ondark-mute">
              {source === "bank" ? "Your bank's balance across all accounts" : "Balance across all accounts, from the books"}
            </p>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {booksGap && booksGap.cents !== 0 ? (
          <a
            href="/bank-feed"
            className="flex items-center gap-2 rounded-md border border-bad-line bg-bad-tint px-3 py-1.5 text-[12px] font-medium text-bad-text hover:brightness-[0.98]"
          >
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0 flex-1">
              Books are {formatMoney(Math.abs(booksGap.cents))} {booksGap.cents > 0 ? "above" : "below"} the bank.{" "}
              {booksGap.waiting > 0
                ? `${booksGap.waiting} to categorize.`
                : "Check the opening balance."}
            </span>
            <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
          </a>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <figure className="flex flex-col items-center text-center">
            <Donut
              label={
                split
                  ? `${split.operating}% of the money is day-to-day and ${split.reserve}% is reserve.`
                  : "No money held yet."
              }
              segments={
                split
                  ? [
                      { pct: split.operating, color: "var(--color-ink)", title: "Day-to-day", detail: `${formatMoney(operatingCents)} · ${split.operating}% of the money` },
                      { pct: split.reserve, color: "var(--color-moss)", title: "Reserve", detail: `${formatMoney(reserveCents)} · ${split.reserve}% of the money` },
                    ]
                  : []
              }
              center={split ? `${split.reserve}%` : "–"}
              sub="reserve"
            />
            <figcaption className="mt-2 w-full">
              <span className="mx-auto block w-full border-b border-line pb-1 text-[12px] font-semibold text-ink">Bank Account Balances</span>
              {split ? (
                <span className="mt-1 flex flex-col items-center gap-0.5 text-[11px] text-mute">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink" />
                    Day-to-day <span className="figures text-ink">{formatMoney(operatingCents)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-moss" />
                    Reserve <span className="figures text-ink">{formatMoney(reserveCents)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 border-t border-line pt-0.5 font-semibold text-ink">
                    {source === "bank" ? "Bank balance" : "Total balance"} <span className="figures">{formatMoney(totalCents)}</span>
                  </span>
                </span>
              ) : (
                <span className="mt-1 block text-[11px] text-mute">Nothing held yet</span>
              )}
            </figcaption>
          </figure>

          <figure className="flex flex-col items-center text-center">
            <Donut
              label={
                funded !== null
                  ? `The reserve is ${fundedLabelPct}% of its ${formatMoney(targetCents ?? 0)} target.`
                  : "No reserve target set."
              }
              segments={
                funded !== null
                  ? [
                      { pct: fundedPct, color: "var(--color-moss)", title: "Reserve held", detail: `${formatMoney(reserveCents)} · ${fundedLabelPct}% of the target` },
                      ...(remainingCents > 0
                        ? [{ pct: 100 - fundedPct, color: "var(--color-line-strong)", title: "Still to go", detail: `${formatMoney(remainingCents)} to reach ${formatMoney(targetCents ?? 0)}` }]
                        : []),
                    ]
                  : []
              }
              center={funded !== null ? `${fundedLabelPct}%` : "–"}
              sub="of target"
            />
            <figcaption className="mt-2 w-full">
              <span className="mx-auto block w-full border-b border-line pb-1 text-[12px] font-semibold text-ink">Reserve Fund</span>
              <span className="mt-1 block text-[11px] text-mute">
                {funded !== null ? (
                  <>
                    <span className="figures text-ink">{formatMoney(reserveCents)}</span> of{" "}
                    <span className="figures">{formatMoney(targetCents ?? 0)}</span>
                    <span className="block">{remainingCents > 0 ? `${formatMoney(remainingCents)} to go` : "Target met"}</span>
                  </>
                ) : (
                  "No target set"
                )}
              </span>
            </figcaption>
            {canSetTarget ? (
              <div className="mt-1.5 flex justify-center">
                <ReserveTargetForm currentTarget={reserveTarget} label={null} />
              </div>
            ) : null}
          </figure>
        </div>

        {tiles.length > 0 ? (
          <div className="flex flex-col border-t border-line pt-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">Status Check</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {tiles.map((tile) => (
                <li key={tile.key}>
                  <a
                    href={tile.href}
                    className={`flex min-h-[2rem] items-center justify-between gap-3 rounded-md border px-3 py-1 transition-colors ${TILE_TONE[tile.tone]}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink">{tile.label}</span>
                      {tile.value !== null ? <span className="block truncate text-[11px] text-mute">{tile.note}</span> : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {tile.value !== null ? (
                        <span className={`figures text-right text-[14px] font-bold ${TILE_TEXT[tile.tone]}`}>{tile.value}</span>
                      ) : (
                        <span className="text-right text-[11px] font-bold text-ink underline underline-offset-2">{tile.note}</span>
                      )}
                      <ChevronRight size={14} strokeWidth={2} aria-hidden="true" className="-mr-1 text-mute-soft" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

      </div>
    </section>
  );
}
