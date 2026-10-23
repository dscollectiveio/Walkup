"use client";

import { useState } from "react";

export interface DonutSegment {
  pct: number;
  color: string;
  /** Shown in the pop-out when the segment is hovered or focused. */
  title: string;
  detail: string;
}

/**
 * A ring chart: segments in order from twelve o'clock, with a figure in the middle. Hovering (or tabbing to) a
 * segment pops out its details above the ring. With no segments it is a grey ring.
 */
export function Donut({
  segments,
  center,
  sub,
  label,
}: {
  segments: DonutSegment[];
  center: string;
  sub: string;
  label: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const r = 32; // with the 14 wide ring, the outer edge stays where it was (32 + 7 = 39)
  const c = 2 * Math.PI * r;
  // Each segment's length and where it starts, worked out up front.
  const arcs = segments.reduce<(DonutSegment & { len: number; start: number })[]>((acc, seg) => {
    const start = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].len : 0;
    return [...acc, { ...seg, len: (c * Math.max(0, Math.min(100, seg.pct))) / 100, start }];
  }, []);
  const shown = active !== null ? arcs[active] : null;

  return (
    <div className="relative" onMouseLeave={() => setActive(null)}>
      <svg viewBox="0 0 88 88" className="h-24 w-24 overflow-visible" role="img" aria-label={label}>
        <circle cx="44" cy="44" r={r} fill="none" stroke="var(--color-fill)" strokeWidth="14" />
        {arcs.map((arc, i) =>
          arc.len > 0 ? (
            <circle
              key={i}
              cx="44"
              cy="44"
              r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth={active === i ? 17 : 14}
              strokeDasharray={`${arc.len} ${c - arc.len}`}
              strokeDashoffset={-arc.start}
              transform="rotate(-90 44 44)"
              tabIndex={0}
              aria-label={`${arc.title}: ${arc.detail}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="cursor-pointer outline-none motion-safe:transition-[stroke-width] motion-safe:duration-150"
            />
          ) : null,
        )}
        <text x="44" y="44" textAnchor="middle" className="figures pointer-events-none fill-ink text-[16px] font-bold">
          {center}
        </text>
        <text x="44" y="58" textAnchor="middle" className="pointer-events-none fill-mute text-[9px]">
          {sub}
        </text>
      </svg>
      {shown ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-max max-w-[14rem] -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-left text-[11px] text-paper shadow-lg"
        >
          <span className="flex items-center gap-1.5 font-semibold">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full border border-paper/40" style={{ background: shown.color }} />
            {shown.title}
          </span>
          <span className="figures mt-0.5 block text-ondark-mute">{shown.detail}</span>
        </div>
      ) : null}
    </div>
  );
}
