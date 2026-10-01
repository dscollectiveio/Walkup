import { formatMoney } from "@/lib/tax/form1120h";

export interface DonutSlice {
  label: string;
  valueCents: number;
  /** Where clicking the slice or its legend row goes, e.g. filtered transactions. */
  href?: string;
}

const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
];

/**
 * Spending donut with its legend. Beyond `maxSlices` categories — or any
 * category under `minShare` of the total — the tail is grouped into "Other"
 * rather than extending the ramp; six is where the brand's data-series
 * palette deliberately stops.
 */
export function DonutChart({
  slices,
  ariaLabel,
  maxSlices = 5,
  minShare = 0,
  centerLabel,
  showPercent = false,
}: {
  slices: DonutSlice[];
  ariaLabel: string;
  maxSlices?: number;
  minShare?: number;
  /** Text in the middle of the ring (e.g. the total). */
  centerLabel?: string;
  showPercent?: boolean;
}) {
  const sorted = [...slices].filter((s) => s.valueCents > 0).sort((a, b) => b.valueCents - a.valueCents);
  const grandTotal = sorted.reduce((s, x) => s + x.valueCents, 0);
  if (grandTotal <= 0) return null;

  const shown: DonutSlice[] = [];
  const tail: DonutSlice[] = [];
  for (const s of sorted) {
    if (shown.length < maxSlices && s.valueCents / grandTotal >= minShare) shown.push(s);
    else tail.push(s);
  }
  if (tail.length > 0) {
    shown.push({ label: "Other", valueCents: tail.reduce((s, t) => s + t.valueCents, 0) });
  }

  const R = 15.9155; // circumference 100 for percentage dasharray

  // Precompute each slice's start offset (12 o'clock is offset 25).
  const arcs = shown.map((s) => ({ ...s, pct: (s.valueCents / grandTotal) * 100, offset: 0 }));
  let acc = 25;
  for (const arc of arcs) {
    arc.offset = acc;
    acc -= arc.pct;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0" role="img" aria-label={ariaLabel}>
        {arcs.map((s, i) => {
          const circle = (
            <circle
              cx="21"
              cy="21"
              r={R}
              fill="transparent"
              stroke={SERIES[i % SERIES.length]}
              strokeWidth="6"
              strokeDasharray={`${s.pct} ${100 - s.pct}`}
              strokeDashoffset={s.offset}
            />
          );
          return s.href ? (
            <a key={s.label} href={s.href} aria-label={`${s.label}: ${formatMoney(s.valueCents)}`}>
              {circle}
            </a>
          ) : (
            <g key={s.label}>{circle}</g>
          );
        })}
        {/* Light outline around the ring */}
        <circle cx="21" cy="21" r={R + 3.2} fill="none" stroke="var(--color-line-strong)" strokeWidth="0.3" />
        <circle cx="21" cy="21" r={R - 3.2} fill="none" stroke="var(--color-line-strong)" strokeWidth="0.3" />
        {centerLabel ? (
          <text x="21" y="22.4" textAnchor="middle" className="figures" fontSize="4.2" fill="var(--color-ink)">
            {centerLabel}
          </text>
        ) : null}
      </svg>
      <ul className="min-w-0 flex-1 divide-y divide-line rounded-lg border border-line px-2.5">
        {arcs.map((s, i) => {
          const label = (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-mute">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              <span className="truncate">{s.label}</span>
            </span>
          );
          return (
            <li key={s.label} className="flex items-baseline justify-between gap-3 py-1.5 text-[12px]">
              {s.href ? (
                <a href={s.href} className="min-w-0 underline-offset-2 hover:underline">
                  {label}
                </a>
              ) : (
                label
              )}
              <span className="figures shrink-0 text-ink">
                {formatMoney(s.valueCents)}
                {showPercent ? <span className="ml-1.5 text-mute">{Math.round(s.pct)}%</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
