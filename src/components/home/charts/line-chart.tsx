import { formatMoney } from "@/lib/tax/form1120h";

export interface LinePoint {
  label: string; // short month label from a real date, e.g. "Jan"
  valueCents: number;
}

/**
 * Balance-over-time line with a flat area fill and a labeled end point.
 * Hand-rolled SVG — three small charts don't justify a dependency, and the
 * numbers come pre-converted to cents so no float arithmetic happens here
 * (DECISIONS #20).
 */
export function LineChart({
  points,
  ariaLabel,
}: {
  points: LinePoint[];
  ariaLabel: string;
}) {
  if (points.length === 0) return null;

  const W = 560;
  const H = 170;
  const PAD_X = 8;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 26;

  const values = points.map((p) => p.valueCents);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;

  const x = (i: number) =>
    points.length === 1
      ? W / 2
      : PAD_X + (i * (W - PAD_X * 2 - 90)) / (points.length - 1);
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.valueCents)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1)},${H - PAD_BOTTOM} L${x(0)},${H - PAD_BOTTOM} Z`;

  const last = points[points.length - 1];
  const labelEvery = points.length > 8 ? 2 : 1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
      <path d={areaPath} fill="var(--color-series-1)" fillOpacity="0.1" />
      <path d={linePath} fill="none" stroke="var(--color-series-1)" strokeWidth="2" />
      <circle cx={x(points.length - 1)} cy={y(last.valueCents)} r="3.5" fill="var(--color-series-1)" />
      <text
        x={x(points.length - 1) + 8}
        y={y(last.valueCents) + 4}
        fontSize="12"
        fontWeight="600"
        fill="var(--color-ink)"
        style={{ fontFamily: "var(--font-serif)", fontVariantNumeric: "tabular-nums" }}
      >
        {formatMoney(last.valueCents)}
      </text>
      {points.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={x(i)} y={H - 8} fontSize="10" fill="var(--color-mute)" textAnchor="middle">
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}
