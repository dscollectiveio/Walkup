import { formatMoney } from "@/lib/tax/form1120h";
import { axisMoney, niceAxis } from "./axis";

export interface LinePoint {
  label: string; // short month label from a real date, e.g. "Jan"
  valueCents: number;
}

/**
 * Balance-over-time line with a flat area fill, a labeled end point, and
 * axes: a dollar scale on the left with light gridlines, and month ticks on
 * the baseline. Hand-rolled SVG — three small charts don't justify a
 * dependency, and the numbers come pre-converted to cents so no float
 * arithmetic happens here (DECISIONS #20).
 */
export function LineChart({
  points,
  ariaLabel,
  title,
  xTitle,
  yTitle,
}: {
  points: LinePoint[];
  ariaLabel: string;
  /** A heading above the plot, and a title for each axis. */
  title?: string;
  xTitle?: string;
  yTitle?: string;
}) {
  if (points.length === 0) return null;

  const W = 560;
  const H = 252;
  const PAD_LEFT = 62;
  const PAD_RIGHT = 8;
  const END_LABEL = 14; // a little room to the right of the last point
  const PAD_TOP = 26;
  const PAD_BOTTOM = 44;

  const values = points.map((p) => p.valueCents);
  const axis = niceAxis(Math.min(...values, 0), Math.max(...values, 1));
  const span = axis.hi - axis.lo || 1;

  const plotRight = W - PAD_RIGHT;
  const baseY = H - PAD_BOTTOM;
  const x = (i: number) =>
    points.length === 1
      ? PAD_LEFT + (plotRight - PAD_LEFT) / 2
      : PAD_LEFT + 10 + (i * (plotRight - PAD_LEFT - 10 - END_LABEL)) / (points.length - 1);
  const y = (v: number) => PAD_TOP + (1 - (v - axis.lo) / span) * (baseY - PAD_TOP);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.valueCents)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1)},${y(Math.max(axis.lo, 0))} L${x(0)},${y(Math.max(axis.lo, 0))} Z`;

  const last = points[points.length - 1];
  const labelEvery = points.length > 8 ? 2 : 1;

  return (
    <div>
    {title ? <h4 className="mb-1 text-[13px] font-semibold text-ink">{title}</h4> : null}
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
      {/* Gridlines and the dollar scale */}
      {axis.ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_LEFT}
            x2={plotRight}
            y1={y(t)}
            y2={y(t)}
            stroke={t === 0 ? "var(--color-line-strong)" : "var(--color-line)"}
            strokeWidth="1"
            strokeDasharray={t === 0 ? undefined : "3 3"}
          />
          <text x={PAD_LEFT - 6} y={y(t) + 3} fontSize="9" fill="var(--color-mute)" textAnchor="end">
            {axisMoney(t)}
          </text>
        </g>
      ))}
      {/* Axes */}
      <line x1={PAD_LEFT} x2={PAD_LEFT} y1={PAD_TOP} y2={baseY} stroke="var(--color-line-strong)" strokeWidth="1" />
      <line x1={PAD_LEFT} x2={plotRight} y1={baseY} y2={baseY} stroke="var(--color-line-strong)" strokeWidth="1" />

      <path d={areaPath} fill="var(--color-series-1)" fillOpacity="0.1" />
      <path d={linePath} fill="none" stroke="var(--color-series-1)" strokeWidth="2" />
      <circle cx={x(points.length - 1)} cy={y(last.valueCents)} r="3.5" fill="var(--color-series-1)" />
      <text
        x={x(points.length - 1)}
        y={y(last.valueCents) - 10}
        textAnchor="end"
        fontSize="12"
        fontWeight="600"
        fill="var(--color-ink)"
        style={{ fontFamily: "var(--font-sans)", fontVariantNumeric: "tabular-nums" }}
      >
        {formatMoney(last.valueCents)}
      </text>

      {/* Month ticks and labels */}
      {points.map((p, i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={baseY} y2={baseY + 4} stroke="var(--color-line-strong)" strokeWidth="1" />
          {i % labelEvery === 0 ? (
            <text x={x(i)} y={baseY + 17} fontSize="10" fill="var(--color-mute)" textAnchor="middle">
              {p.label}
            </text>
          ) : null}
        </g>
      ))}
      {yTitle ? (
        <text
          transform={`translate(11 ${(PAD_TOP + baseY) / 2}) rotate(-90)`}
          fontSize="10"
          fontWeight="600"
          fill="var(--color-mute)"
          textAnchor="middle"
        >
          {yTitle}
        </text>
      ) : null}
      {xTitle ? (
        <text x={(PAD_LEFT + plotRight) / 2} y={H - 4} fontSize="10" fontWeight="600" fill="var(--color-mute)" textAnchor="middle">
          {xTitle}
        </text>
      ) : null}
    </svg>
    </div>
  );
}
