import { TriangleAlert } from "lucide-react";
import { formatMoney } from "@/lib/tax/form1120h";
import { ReserveTargetForm } from "./reserve-target-form";
import type { SnapshotTile } from "@/lib/home/snapshot";

const TILE_TONE: Record<SnapshotTile["tone"], string> = {
  neutral: "border-line bg-paper hover:bg-fill",
  attention: "border-warning-line bg-warning-tint hover:brightness-[0.98]",
  good: "border-good-line bg-good-tint hover:brightness-[0.98]",
};
const TILE_TEXT: Record<SnapshotTile["tone"], string> = {
  neutral: "text-ink",
  attention: "text-warning-text",
  good: "text-good-text",
};

/**
 * "Where the association stands" — the money picture in one card, with a
 * "Right now" strip of four tiles underneath that stretch to fill whatever
 * height the row gives it.
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
  /** "Right now" tiles — real figures, or a nudge to set the thing up. */
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
      className={`flex flex-col rounded-xl border border-line bg-paper `}
    >
      <header className="flex min-h-[4rem] flex-col justify-center rounded-t-[7px] band bg-ink px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="eyebrow text-paper">Where the association stands</h2>
            <p className="mt-0.5 text-[12px] text-ondark-mute">
              {source === "bank" ? "Your bank's balance across all accounts" : "Balance across all accounts, from the books"}
            </p>
          </div>
          <div className="figures text-[24px] leading-none text-paper">{formatMoney(totalCents)}</div>
        </div>
      </header>

      <div className="flex flex-1 flex-col justify-between gap-2.5 px-5 py-2.5">
        {booksGap && booksGap.cents !== 0 ? (
          <a
            href="/bank-feed"
            className="flex items-start gap-3 rounded-lg border border-bad bg-bad-tint px-4 py-3 text-bad-text hover:brightness-[0.98]"
          >
            <TriangleAlert size={22} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="block">
              <span className="block text-[15px] font-bold leading-snug">
                Your books are {formatMoney(Math.abs(booksGap.cents))} {booksGap.cents > 0 ? "above" : "below"} the bank.
              </span>
              <span className="mt-1 block text-[13px] font-medium leading-snug">
                {booksGap.waiting > 0
                  ? `${booksGap.waiting} transaction${booksGap.waiting === 1 ? " is" : "s are"} still waiting for a category, so your financial statements are not final. Categorize them in the Bank Feed to close the gap →`
                  : "Check the opening balance and any entries made outside the Bank Feed →"}
              </span>
            </span>
          </a>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] font-semibold text-ink">Day-to-day</p>
            <div className="figures mt-0.5 text-[22px] leading-tight text-ink">{formatMoney(operatingCents)}</div>
            <p className="text-[11px] text-mute">bills and running costs</p>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-ink">Reserve</p>
            <div className="figures mt-0.5 text-[22px] leading-tight text-ink">{formatMoney(reserveCents)}</div>
            <p className="text-[11px] text-mute">set aside for big repairs</p>
          </div>
        </div>

        {split ? (
          <div>
            <div className="flex items-baseline justify-between text-[11px] text-mute">
              <span>How the money is split</span>
              <span className="figures">
                {split.operating}% day-to-day · {split.reserve}% reserve
              </span>
            </div>
            <div
              role="img"
              aria-label={`${split.operating}% of the money is day-to-day and ${split.reserve}% is reserve.`}
              className="mt-1.5 flex h-2.5 overflow-hidden rounded-full bg-fill"
            >
              <div className="h-full bg-ink" style={{ width: `${split.operating}%` }} />
              <div className="h-full bg-moss" style={{ width: `${split.reserve}%` }} />
            </div>
          </div>
        ) : null}

        <div className="border-t border-line pt-3">
          {funded !== null ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-ink">
                  Reserve is {fundedPct}% of the target
                </span>
                <span className="figures text-[12px] text-mute">
                  {remainingCents > 0 ? `${formatMoney(remainingCents)} to go` : "target met"}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-fill">
                <div
                  className="h-full rounded-full bg-moss"
                  style={{ width: `${fundedPct}%` }}
                />
              </div>
            </>
          ) : (
            <p className="text-[12px] text-mute">No reserve target set.</p>
          )}
          {canSetTarget ? (
            <div className="mt-2">
              <ReserveTargetForm currentTarget={reserveTarget} />
            </div>
          ) : null}
        </div>



        {tiles.length > 0 ? (
          <div className="flex flex-col">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">Right now</h3>
            <ul className="mt-1 flex flex-col gap-1">
              {tiles.map((tile) => (
                <li key={tile.key}>
                  <a
                    href={tile.href}
                    className={`flex min-h-[2.25rem] items-center justify-between gap-3 rounded-md border px-3 py-1 transition-colors ${TILE_TONE[tile.tone]}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium text-ink">{tile.label}</span>
                      {tile.value !== null ? <span className="block truncate text-[11px] text-mute">{tile.note}</span> : null}
                    </span>
                    {tile.value !== null ? (
                      <span className={`figures shrink-0 text-right text-[14px] font-bold ${TILE_TEXT[tile.tone]}`}>{tile.value}</span>
                    ) : (
                      <span className="shrink-0 text-right text-[11px] font-bold text-ink underline underline-offset-2">
                        {tile.note} →
                      </span>
                    )}
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
