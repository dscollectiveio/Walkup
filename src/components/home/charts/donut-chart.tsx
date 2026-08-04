import { formatMoney } from "@/lib/tax/form1120h";

export interface DonutSlice {
  label: string;
  valueCents: number;
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
 * Spending donut with its legend. Beyond six categories the tail is grouped
 * into "Other" rather than extending the ramp — six is where the brand's
 * data-series palette deliberately stops.
 */
export function DonutChart({ slices, ariaLabel }: { slices: DonutSlice[]; ariaLabel: string }) {
  const sorted = [...slices].sort((a, b) => b.valueCents - a.valueCents);
  const shown = sorted.slice(0, 5);
  const tail = sorted.slice(5);
  if (tail.length > 0) {
    shown.push({
      label: "Other",
      valueCents: tail.reduce((s, t) => s + t.valueCents, 0),
    });
  }

  const total = shown.reduce((s, x) => s + x.valueCents, 0);
  if (total <= 0) return null;

  const R = 15.9155; // circumference 100 for percentage dasharray

  // Precompute each slice's start offset (12 o'clock is offset 25).
  const arcs = shown.map((s) => ({ ...s, pct: (s.valueCents / total) * 100, offset: 0 }));
  let acc = 25;
  for (const arc of arcs) {
    arc.offset = acc;
    acc -= arc.pct;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 42 42" className="h-32 w-32 shrink-0" role="img" aria-label={ariaLabel}>
        {arcs.map((s, i) => (
          <circle
            key={s.label}
            cx="21"
            cy="21"
            r={R}
            fill="transparent"
            stroke={SERIES[i % SERIES.length]}
            strokeWidth="6"
            strokeDasharray={`${s.pct} ${100 - s.pct}`}
            strokeDashoffset={s.offset}
          />
        ))}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {shown.map((s, i) => (
          <li key={s.label} className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-mute">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: SERIES[i % SERIES.length] }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="figures shrink-0 text-ink">{formatMoney(s.valueCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
