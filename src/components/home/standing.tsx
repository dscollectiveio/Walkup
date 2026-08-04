import { formatMoney } from "@/lib/tax/form1120h";
import { Jargon } from "@/components/ui";
import { ReserveTargetForm } from "./reserve-target-form";

/**
 * "Where the association stands" — the money picture in one card. The
 * trial-balance strip never shows a green state it can't verify: matched is
 * good-tint with the figure, anything else is bad-tint and says so.
 */
export function Standing({
  totalCents,
  operatingCents,
  reserveCents,
  reserveTarget, // display-only: drives a meter, not a ledger figure
  booksBalanced,
  tbTotalCents,
  canSetTarget,
}: {
  totalCents: number;
  operatingCents: number;
  reserveCents: number;
  reserveTarget: number | null;
  booksBalanced: boolean;
  tbTotalCents: number;
  canSetTarget: boolean;
}) {
  const targetCents = reserveTarget ? Math.round(reserveTarget * 100) : null;
  const funded =
    targetCents && targetCents > 0 ? Math.min(1, reserveCents / targetCents) : null;
  const remainingCents = targetCents ? Math.max(0, targetCents - reserveCents) : 0;

  return (
    <section className="rounded-xl border border-line bg-paper">
      <header className="border-b border-line px-5 py-4">
        <h2 className="font-semibold tracking-tight text-ink">Where the association stands</h2>
      </header>

      <div className="px-5 py-4">
        <div className="figures text-[26px] text-ink">{formatMoney(totalCents)}</div>
        <p className="text-[12px] text-mute">across all accounts</p>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="figures text-[16px] text-ink">{formatMoney(operatingCents)}</div>
            <p className="text-[11px] text-mute">day-to-day · bills and running costs</p>
          </div>
          <div>
            <div className="figures text-[16px] text-ink">{formatMoney(reserveCents)}</div>
            <p className="text-[11px] text-mute">reserve · set aside for big repairs</p>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {funded !== null ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-medium text-ink">
                  Reserve is {Math.round(funded * 100)}% of the target
                </span>
                <span className="figures text-[12px] text-mute">
                  {remainingCents > 0 ? `${formatMoney(remainingCents)} to go` : "target met"}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-fill">
                <div
                  className="h-full rounded-full bg-moss"
                  style={{ width: `${Math.round(funded * 100)}%` }}
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

        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-[12px] ${
            booksBalanced
              ? "border-good-line bg-good-tint text-good-text"
              : "border-bad-line bg-bad-tint text-bad-text"
          }`}
        >
          {booksBalanced ? (
            <Jargon term="trial balance">
              The books balance — {formatMoney(tbTotalCents)} on each side
            </Jargon>
          ) : (
            "The two sides of the books do not match. Check the ledger before trusting any figure on this page."
          )}
        </div>
      </div>
    </section>
  );
}
