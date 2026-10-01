import { formatMoney } from "@/lib/tax/form1120h";
import { buildBreakdown, type BreakdownSlice } from "./breakdown";

const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
];

const whole = (cents: number) => formatMoney(Math.round(cents / 100) * 100).replace(/\.00$/, "");

/**
 * "Where the money went", in depth: headline figures, a donut with the total
 * in the middle and small gaps between segments, and a ranked list showing
 * each category's dollars, share of spending, an inline bar, and its monthly
 * average. Server-safe SVG; slices link to the transactions behind them.
 */
export function SpendingBreakdown({
  slices,
  avgMonthlyCents,
  monthCount,
  sinceLabel,
  ariaLabel,
}: {
  slices: BreakdownSlice[];
  avgMonthlyCents: number;
  monthCount: number;
  sinceLabel: string;
  ariaLabel: string;
}) {
  const { rows, totalCents, biggest } = buildBreakdown(slices, { maxRows: 6, monthCount });
  if (rows.length === 0) return null;

  const R = 15.9155; // circumference 100, so dash lengths are percentages
  const GAP = rows.length > 1 ? 0.9 : 0;
  const starts: number[] = [];
  let acc = 25; // 12 o'clock
  for (const r of rows) {
    starts.push(acc - GAP / 2);
    acc -= r.pct;
  }
  const arcs = rows.map((r, i) => ({
    ...r,
    dash: Math.max(0.2, r.pct - GAP),
    offset: starts[i],
    color: SERIES[i % SERIES.length],
  }));

  return (
    <div className="space-y-3">
      {/* Headline figures */}
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-md border border-line bg-fill/50 px-2 py-1.5">
          <dt className="text-[10px] text-mute">Total spent</dt>
          <dd className="figures text-[14px] text-ink">{whole(totalCents)}</dd>
        </div>
        <div className="rounded-md border border-line bg-fill/50 px-2 py-1.5">
          <dt className="text-[10px] text-mute">Average a month</dt>
          <dd className="figures text-[14px] text-ink">{whole(avgMonthlyCents)}</dd>
        </div>
        <div className="rounded-md border border-line bg-fill/50 px-2 py-1.5">
          <dt className="text-[10px] text-mute">Biggest</dt>
          <dd className="truncate text-[14px] font-medium text-ink">
            {biggest ? `${biggest.label} · ${biggest.pctLabel}%` : "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-4">
        <svg viewBox="0 0 42 42" className="h-36 w-36 shrink-0" role="img" aria-label={ariaLabel}>
          <circle cx="21" cy="21" r={R - 3.2} fill="var(--color-fill)" fillOpacity="0.6" />
          {arcs.map((a) => {
            const circle = (
              <circle
                cx="21"
                cy="21"
                r={R}
                fill="transparent"
                stroke={a.color}
                strokeWidth="6.4"
                strokeDasharray={`${a.dash} ${100 - a.dash}`}
                strokeDashoffset={a.offset}
              >
                <title>{`${a.label}: ${formatMoney(a.valueCents)} (${a.pctLabel}%)`}</title>
              </circle>
            );
            return a.href ? (
              <a key={a.label} href={a.href} aria-label={`${a.label}: ${formatMoney(a.valueCents)}`}>
                {circle}
              </a>
            ) : (
              <g key={a.label}>{circle}</g>
            );
          })}
          <circle cx="21" cy="21" r={R + 3.5} fill="none" stroke="var(--color-line-strong)" strokeWidth="0.25" />
          <circle cx="21" cy="21" r={R - 3.5} fill="none" stroke="var(--color-line-strong)" strokeWidth="0.25" />
          <text x="21" y="20.6" textAnchor="middle" className="figures" fontSize="4.6" fill="var(--color-ink)">
            {whole(totalCents)}
          </text>
          <text x="21" y="25.2" textAnchor="middle" fontSize="2.3" fill="var(--color-mute)">
            spent {sinceLabel.replace(/^Since /, "since ")}
          </text>
        </svg>

        <ul className="min-w-[14rem] flex-1 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {arcs.map((a) => {
            const name = (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: a.color }} />
                <span className="truncate text-[12px] font-medium text-ink">{a.label}</span>
              </span>
            );
            return (
              <li key={a.label} className="px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  {a.href ? (
                    <a href={a.href} className="min-w-0 underline-offset-2 hover:underline">
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                  <span className="figures shrink-0 text-[12px] text-ink">
                    {whole(a.valueCents)}
                    <span className="ml-1.5 text-mute">{a.pctLabel}%</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, a.pct)}%`, backgroundColor: a.color }} />
                  </div>
                  {a.perMonthCents !== null ? (
                    <span className="w-16 shrink-0 text-right text-[10px] text-mute">{whole(a.perMonthCents)}/mo</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
