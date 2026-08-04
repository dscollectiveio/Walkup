export interface BarGroup {
  label: string; // short month label from a real date
  aCents: number; // first series (money in)
  bCents: number; // second series (money out)
  shortfall?: boolean; // render the second bar in Rust
  caption?: string | null; // names the cause of a shortfall
}

/**
 * Grouped monthly bars. Series colors come from the brand data-series ramp;
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
  const H = 190;
  const PAD_TOP = 12;
  const PAD_BOTTOM = groups.some((g) => g.caption) ? 44 : 28;

  const max = Math.max(...groups.flatMap((g) => [g.aCents, g.bCents]), 1);
  const groupWidth = W / groups.length;
  const barWidth = Math.min(26, groupWidth / 3);
  const chartH = H - PAD_TOP - PAD_BOTTOM;
  const scaled = (v: number) => Math.max(v > 0 ? 2 : 0, (v / max) * chartH);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={ariaLabel}>
        {groups.map((g, i) => {
          const cx = i * groupWidth + groupWidth / 2;
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
