import { yearProgress } from "@/lib/dues/year";

const fmt = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

/**
 * The calendar year's dues for one unit as four quarters. The money paid fills
 * the bar from Q1 on, so full means the year is covered. Shown inside "Edit
 * dues plan" and follows the yearly amount as it is typed.
 */
export function DuesYearBar({
  year,
  annualCents,
  paidCents,
  pendingCents,
  todayKey,
  rolledOverCents = 0,
}: {
  year: string;
  annualCents: number;
  /** Paid so far this year, including any deposit labeled dues but not yet posted. */
  paidCents: number;
  /** The part of paidCents that is labeled dues for this unit but not yet posted to the books. */
  pendingCents: number;
  todayKey: string;
  /** Extra dues that rolled over to Additional Agreed Assessments, when the unit has one. */
  rolledOverCents?: number;
}) {
  if (annualCents <= 0) {
    return (
      <div className="w-full rounded-md border border-dashed border-line-strong px-3 py-2 text-[12px] text-mute">
        Enter a yearly amount to see {year}&rsquo;s four quarters fill as dues are paid.
      </div>
    );
  }
  const p = yearProgress(annualCents, paidCents, todayKey);
  const summary =
    p.aheadCents > 0 && rolledOverCents > 0
      ? `The year is covered, and ${fmt(rolledOverCents)} extra rolled over to Additional Agreed Assessments`
      : p.aheadCents > 0
      ? `${fmt(p.aheadCents)} paid beyond the year`
      : p.remainingCents === 0
        ? "The year is covered"
        : `${fmt(p.remainingCents)} still to pay`;

  return (
    <div
      className="w-full"
      role="group"
      aria-label={`${year} dues: ${fmt(p.paidCents)} paid of ${fmt(p.annualCents)}. ${summary}.`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[12px]">
        <span className="font-semibold text-ink">{year} dues</span>
        <span className="figures text-ink">
          {fmt(p.paidCents)} <span className="text-mute">paid of {fmt(p.annualCents)}</span>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1" aria-hidden="true">
        {p.quarters.map((q) => (
          <div
            key={q.label}
            className={`h-3 overflow-hidden rounded-full bg-line ${q.current ? "ring-2 ring-brass/60 ring-offset-1 ring-offset-paper" : ""}`}
          >
            <div className="h-full rounded-full bg-good transition-[width] duration-500 ease-out" style={{ width: `${q.pct}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-4 gap-1 text-[11px]" aria-hidden="true">
        {p.quarters.map((q) => (
          <div key={q.label} className={q.current ? "font-semibold text-ink" : "text-mute"}>
            <div>
              {q.label}
              {q.current ? " · now" : ""}
            </div>
            <div className="figures">
              {fmt(q.filledCents)} <span className="text-mute-soft">/ {fmt(q.targetCents)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className={`mt-1.5 text-[12px] ${p.behind ? "text-warning-text" : "text-mute"}`}>
        {summary}
        {p.behind ? ", and earlier quarters aren't fully paid" : ""}.
      </p>
      {pendingCents > 0 ? (
        <p className="mt-0.5 text-[11px] text-mute-soft">
          Includes {fmt(pendingCents)} from deposits labeled dues for this unit that aren&rsquo;t posted to the books yet.
        </p>
      ) : null}
    </div>
  );
}
