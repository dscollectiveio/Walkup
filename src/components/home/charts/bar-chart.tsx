import { axisMoney, niceAxis } from "./axis";

export interface BarGroup {
  label: string; // short month label from a real date
  aCents: number; // first series (money in)
  bCents: number; // second series (money out)
  shortfall?: boolean; // render the second bar in Rust
  caption?: string | null; // names the cause of a shortfall
}

/**
 * Grouped monthly bars with a dollar scale, light gridlines and axis lines.
 * Series colors come from the brand data-series ramp;
 * a shortfall month's outflow bar switches to Rust and gets a caption, so
 * color is never the only carrier (the caption and figures say it in words).
 */
export function BarChart({
  groups,
  seriesALabel,
  seriesBLabel,
  ariaLabel,
}: {
  groups: BarGroup[];
  seriesALabel: string;
  seriesBLabel: string;
  ariaLabel: string;
}) {
  if (groups.length === 0) return null;

  const W = 560;
  const H = 200;
  const PAD_LEFT = 46;
  const PAD_RIGHT = 8;
  const PAD_TOP = 12;
  const PAD_BOTTOM = groups.some((g) => g.caption) ? 44 : 28;

  const axis = niceAxis(0, Math.max(...groups.flatMap((g) => [g.aCents, g.bCents]), 1));
  const plotW = W - PAD_LEFT - PAD_RIGHT;
  const groupWidth = plotW / groups.length;
  const barWidth = Math.min(26, groupWidth / 3);
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const baseY = PAD_TOP + chartH;
  const yOf = (v: number) => PAD_TOP + (1 - v / (axis.hi || 1)) * chartH;
  const scaled = (v: number) => Math.max(v > 0 ? 2 : 0, (v / (axis.hi || 1)) * chartH);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {axis.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_LEFT}
              x2={W - PAD_RIGHT}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke={t === 0 ? "var(--color-line-strong)" : "var(--color-line)"}
              strokeWidth="1"
              strokeDasharray={t === 0 ? undefined : "3 3"}
            />
            <text x={PAD_LEFT - 6} y={yOf(t) + 3} fontSize="9" fill="var(--color-mute)" textAnchor="end">
              {axisMoney(t)}
            </text>
          </g>
        ))}
        <line x1={PAD_LEFT} x2={PAD_LEFT} y1={PAD_TOP} y2={baseY} stroke="var(--color-line-strong)" strokeWidth="1" />
        {groups.map((g, i) => {
          const cx = PAD_LEFT + i * groupWidth + groupWidth / 2;
          const aH = scaled(g.aCents);
          const bH = scaled(g.bCents);
          return (
            <g key={g.label + i}>
              <rect
                x={cx - barWidth - 2}
                y={PAD_TOP + chartH - aH}
                width={barWidth}
                height={aH}
                rx="2"
                fill="var(--color-series-1)"
              />
              <rect
                x={cx + 2}
                y={PAD_TOP + chartH - bH}
                width={barWidth}
                height={bH}
                rx="2"
                fill={g.shortfall ? "var(--color-rust)" : "var(--color-series-2)"}
              />
              <text x={cx} y={PAD_TOP + chartH + 14} fontSize="10" fill="var(--color-mute)" textAnchor="middle">
                {g.label}
              </text>
              {g.caption ? (
                <text x={cx} y={PAD_TOP + chartH + 28} fontSize="9" fill="var(--color-bad-text)" textAnchor="middle">
                  {g.caption}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mute">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-series-1" /> {seriesALabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-series-2" /> {seriesBLabel}
        </span>
        {groups.some((g) => g.shortfall) ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-2 w-2 rounded-sm bg-rust" /> spent more than came in
          </span>
        ) : null}
      </div>
    </div>
  );
}
