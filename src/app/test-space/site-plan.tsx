"use client";

import { useState } from "react";
import { money } from "@/components/ui";

const UNITS = [
  { id: "1A", x: 20, y: 20, owner: "Rivera", share: "25.000000", dues: 600, paid: true },
  { id: "1B", x: 150, y: 20, owner: "Okafor", share: "25.000000", dues: 600, paid: true },
  { id: "2A", x: 20, y: 105, owner: "Lindqvist", share: "25.000000", dues: 600, paid: false },
  { id: "2B", x: 150, y: 105, owner: "Chen", share: "25.000000", dues: 600, paid: true },
];

/** Sample site plan: four units drawn as a floor plan, tap one to see its share and dues. */
export function SitePlan() {
  const [id, setId] = useState("2A");
  const u = UNITS.find((x) => x.id === id)!;

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
      <svg viewBox="0 0 280 190" role="group" aria-label="Site plan of four units" className="w-full">
        <rect x={6} y={6} width={268} height={178} rx={6} className="fill-none stroke-line-strong" strokeDasharray="4 4" />
        {UNITS.map((s) => (
          <g key={s.id}>
            <rect
              x={s.x} y={s.y} width={110} height={75} rx={4}
              tabIndex={0} role="button" aria-label={`Unit ${s.id}${s.paid ? "" : ", dues unpaid"}`} aria-pressed={id === s.id}
              onClick={() => setId(s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setId(s.id); } }}
              className={`cursor-pointer ${id === s.id ? "fill-ink stroke-brass" : "fill-bone stroke-line-strong"}`}
              strokeWidth={id === s.id ? 3 : 1.5}
            />
            <text x={s.x + 55} y={s.y + 42} textAnchor="middle" fontSize={16} fontWeight={700} pointerEvents="none" className={id === s.id ? "fill-paper" : "fill-ink"}>{s.id}</text>
            <circle cx={s.x + 98} cy={s.y + 12} r={5} pointerEvents="none" className={s.paid ? "fill-good-text" : "fill-rust"} />
          </g>
        ))}
        <rect x={125} y={96} width={30} height={8} rx={2} className="fill-brass" />
      </svg>
      <dl className="grid content-start gap-3 text-[13px]" aria-live="polite">
        <div><dt className="text-[11px] text-mute">Unit</dt><dd className="text-xl font-bold">{u.id}, {u.owner}</dd></div>
        <div><dt className="text-[11px] text-mute">Ownership share</dt><dd className="figures">{u.share}%</dd></div>
        <div><dt className="text-[11px] text-mute">Monthly dues</dt><dd className="figures">{money(u.dues)}</dd></div>
        <div><dt className="text-[11px] text-mute">This month</dt><dd className={u.paid ? "text-good-text font-bold" : "text-bad-text font-bold"}>{u.paid ? "Paid" : "Not paid yet"}</dd></div>
      </dl>
    </div>
  );
}
