"use client";

import { useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/tax/form1120h";

export interface SpendSlice {
  id: string;
  label: string;
  valueCents: number;
  href: string;
  /** How this category stands against its plan for the period, if it has one. */
  status: "on_track" | "watch" | "over" | "none";
}

const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--color-series-${n})`);
/** Categories drawn on their own; everything smaller is folded into "Other". */
const MAX_SLICES = 8;
const R = 15.9; // middle of the ring; slices run from R − 3.1 to R + 3.1

const whole = (cents: number) => formatMoney(Math.round(cents / 100) * 100).replace(/\.00$/, "");
const STATUS_TAG = {
  over: { text: "over plan", cls: "bg-bad-tint text-bad-text" },
  watch: { text: "near plan", cls: "bg-warning-tint text-warning-text" },
} as const;

/**
 * "Where the money went": a donut you can hover, and the categories ranked
 * biggest first beside it. Hovering either side lights up the other, and the
 * middle of the donut shows what you're pointing at. Every category links to
 * its transactions on the bank feed. The eight largest get their own slice;
 * the rest share "Other", which opens to list them.
 */
export function WhereItWent({
  slices,
  totalCents,
  monthCount,
  periodLabel,
  comparison,
}: {
  slices: SpendSlice[];
  totalCents: number;
  monthCount: number;
  /** "this month" / "the last 12 months" / "fiscal year 2026" */
  periodLabel: string;
  comparison: string | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = [...slices].filter((s) => s.valueCents > 0).sort((a, b) => b.valueCents - a.valueCents);
  const own = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES - 1) : sorted;
  const tail = sorted.length > MAX_SLICES ? sorted.slice(MAX_SLICES - 1) : [];
  const otherCents = tail.reduce((s, t) => s + t.valueCents, 0);

  type Arc = { label: string; valueCents: number; href: string | null; status: SpendSlice["status"]; pct: number; color: string; a0: number; a1: number; isOther: boolean };
  const items: Omit<Arc, "pct" | "color" | "a0" | "a1">[] = [
    ...own.map((s) => ({ label: s.label, valueCents: s.valueCents, href: s.href as string | null, status: s.status, isOther: false })),
    ...(tail.length > 0 ? [{ label: "Other", valueCents: otherCents, href: null, status: "none" as const, isOther: true }] : []),
  ];
  // Each slice is a real wedge (an annular sector path), so the browser's
  // hit-testing is exact: a hover lands on the slice under the pointer, not
  // on whichever shape happens to be drawn last. Angles run clockwise from
  // 12 o'clock, as a fraction of the whole turn.
  const GAP = items.length > 1 ? 0.012 : 0; // fraction of a turn left between slices
  let acc = 0;
  const arcs: Arc[] = items.map((it, i) => {
    const pct = (it.valueCents / totalCents) * 100;
    const start = acc;
    acc += pct / 100;
    return {
      ...it,
      pct,
      color: it.isOther ? "var(--color-line-strong)" : SERIES[i % SERIES.length],
      a0: start + GAP / 2,
      // At least a sliver, and never a full turn (an arc back to its own start draws nothing).
      a1: Math.min(start + 0.9995, Math.max(start + GAP / 2 + 0.002, acc - GAP / 2)),
    };
  });

  const pt = (r: number, t: number) => ({ x: 21 + r * Math.sin(t * 2 * Math.PI), y: 21 - r * Math.cos(t * 2 * Math.PI) });
  const wedge = (a0: number, a1: number, ro: number, ri: number) => {
    const o0 = pt(ro, a0), o1 = pt(ro, a1), i0 = pt(ri, a0), i1 = pt(ri, a1);
    const big = a1 - a0 > 0.5 ? 1 : 0;
    return `M${o0.x},${o0.y} A${ro},${ro} 0 ${big} 1 ${o1.x},${o1.y} L${i1.x},${i1.y} A${ri},${ri} 0 ${big} 0 ${i0.x},${i0.y} Z`;
  };

  const focus = active !== null ? arcs[active] : null;
  const pctOf = (cents: number) => Math.round((cents / totalCents) * 100);
  const avgMonthly = Math.round(totalCents / Math.max(1, monthCount));

  // The callout for the active slice sits outside the ring, on a leader line
  // from the middle of the slice, so the chart itself stays uncovered.
  const callout = (() => {
    if (active === null) return null;
    const theta = ((arcs[active].a0 + arcs[active].a1) / 2) * 2 * Math.PI; // clockwise from 12 o'clock
    const sx = Math.sin(theta);
    const cy = -Math.cos(theta);
    const right = sx >= 0;
    const from = { x: 21 + (R + 4) * sx, y: 21 + (R + 4) * cy };
    const elbow = { x: 21 + (R + 8) * sx, y: 21 + (R + 8) * cy };
    const end = { x: elbow.x + (right ? 3 : -3), y: elbow.y };
    return { from, elbow, end, right, anchor: (right ? "start" : "end") as "start" | "end", tx: end.x + (right ? 1 : -1) };
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[21rem_1fr] lg:items-center lg:gap-8">
      {/* The donut, with room either side for the callout. */}
      <div className="flex flex-col items-center">
        <p className="mb-3 text-center">
          <span className="figures block text-[26px] leading-none text-ink">{whole(totalCents)}</span>
          <span className="mt-1 block text-[12px] text-mute">spent {periodLabel}</span>
        </p>
        <svg
          viewBox="-16 -5 74 52"
          className="h-auto w-full max-w-[21rem]"
          role="img"
          aria-label={`Spending by category for ${periodLabel}: ${whole(totalCents)} in total.`}
          onMouseLeave={() => setActive(null)}
        >
          <circle cx="21" cy="21" r={R - 3.6} fill="var(--color-fill)" fillOpacity="0.5" />
          {arcs.map((a, i) => (
            <path
              key={a.label}
              d={wedge(a.a0, a.a1, active === i ? R + 3.8 : R + 3.1, active === i ? R - 3.8 : R - 3.1)}
              fill={a.color}
              opacity={active === null || active === i ? 1 : 0.3}
              className="cursor-pointer transition-opacity duration-150"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive((cur) => (cur === i ? null : i))}
            >
              <title>{`${a.label}: ${formatMoney(a.valueCents)} (${pctOf(a.valueCents)}%)`}</title>
            </path>
          ))}

          {focus && callout ? (
            <g className="pointer-events-none">
              <polyline
                points={`${callout.from.x},${callout.from.y} ${callout.elbow.x},${callout.elbow.y} ${callout.end.x},${callout.end.y}`}
                fill="none"
                stroke={focus.color}
                strokeWidth="0.45"
                strokeLinejoin="round"
              />
              <circle cx={callout.from.x} cy={callout.from.y} r="0.7" fill={focus.color} />
              <text x={callout.tx} y={callout.end.y - 1.2} textAnchor={callout.anchor} fontSize="2.6" fontWeight="600" fill="var(--color-ink)">
                {focus.label.length > 22 ? `${focus.label.slice(0, 21)}…` : focus.label}
              </text>
              <text x={callout.tx} y={callout.end.y + 2.2} textAnchor={callout.anchor} className="figures" fontSize="2.6" fill="var(--color-ink)">
                {whole(focus.valueCents)}
                <tspan fill="var(--color-mute)"> · {pctOf(focus.valueCents)}%</tspan>
              </text>
            </g>
          ) : null}
        </svg>
        <p className="mt-3 text-center text-[12px] text-mute">
          {monthCount > 1 ? (
            <>
              Averages <span className="figures text-ink">{whole(avgMonthly)}</span> a month over {monthCount} months
            </>
          ) : (
            <>Hover a slice or a row to see it.</>
          )}
        </p>
        {comparison ? <p className="mt-0.5 text-center text-[12px] text-mute">{comparison}</p> : null}
      </div>

      {/* Biggest first. */}
      <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line" onMouseLeave={() => setActive(null)}>
        {arcs.map((a, i) => {
          const tag = a.status === "over" || a.status === "watch" ? STATUS_TAG[a.status] : null;
          const body = (
            <>
              <div className="flex items-center gap-3">
                <span className="figures w-4 shrink-0 text-right text-[11px] text-mute-soft">{i + 1}</span>
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: a.color }} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{a.label}</span>
                {tag ? (
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tag.cls}`}>{tag.text}</span>
                ) : null}
                <span className="figures shrink-0 text-[13px] text-ink">{whole(a.valueCents)}</span>
                <span className="figures w-9 shrink-0 text-right text-[12px] text-mute">{pctOf(a.valueCents)}%</span>
              </div>
              <div className="ml-[2.1rem] mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${Math.max(1.5, (a.valueCents / arcs[0].valueCents) * 100)}%`, backgroundColor: a.color }}
                  />
                </div>
                {monthCount > 1 ? (
                  <span className="w-16 shrink-0 text-right text-[10px] text-mute">{whole(Math.round(a.valueCents / monthCount))}/mo</span>
                ) : null}
              </div>
            </>
          );
          const rowCls = `block px-3 py-2.5 transition-colors ${active === i ? "bg-fill/70" : "hover:bg-fill/40"}`;
          return (
            <li key={a.label} onMouseEnter={() => setActive(i)}>
              {a.href ? (
                <Link href={a.href} className={rowCls} title="See these transactions on the bank feed">
                  {body}
                </Link>
              ) : (
                <div className={rowCls}>
                  {body}
                  <button
                    type="button"
                    onClick={() => setShowAll((v) => !v)}
                    aria-expanded={showAll}
                    className="ml-[2.1rem] mt-1.5 text-[11px] font-medium text-mute underline-offset-2 hover:text-ink hover:underline"
                  >
                    {showAll ? "Hide" : `Show ${tail.length} smaller categor${tail.length === 1 ? "y" : "ies"}`}
                  </button>
                  {showAll ? (
                    <ul className="ml-[2.1rem] mt-2 divide-y divide-line/60 border-t border-line/60">
                      {tail.map((t) => (
                        <li key={t.id}>
                          <Link href={t.href} className="flex items-baseline justify-between gap-3 py-1.5 text-[12px] hover:underline">
                            <span className="truncate text-ink">{t.label}</span>
                            <span className="figures shrink-0 text-ink">
                              {whole(t.valueCents)}
                              <span className="ml-1.5 text-mute">{pctOf(t.valueCents)}%</span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
