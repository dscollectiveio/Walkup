"use client";

import { useState } from "react";
import { money } from "@/components/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const FUNDS: Record<string, { label: string; dues: number[]; spent: number[] }> = {
  operating: { label: "Operating", dues: [2400, 2400, 2400, 2400, 2400, 2400], spent: [1850, 2210, 1640, 2980, 1720, 2050] },
  reserve: { label: "Reserve", dues: [600, 600, 600, 600, 600, 600], spent: [0, 0, 1200, 0, 0, 350] },
};

/** Sample figures only: a bar per month for dues in and bills paid, switchable by fund. */
export function FundChart() {
  const [fund, setFund] = useState("operating");
  const [picked, setPicked] = useState<number | null>(null);
  const { dues, spent } = FUNDS[fund];
  const top = Math.max(...dues, ...spent);
  const net = dues.reduce((a, b) => a + b, 0) - spent.reduce((a, b) => a + b, 0);

  return (
    <div>
      <div role="group" aria-label="Fund" className="mb-4 inline-flex rounded-md border border-line p-0.5">
        {Object.keys(FUNDS).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={fund === k}
            onClick={() => { setFund(k); setPicked(null); }}
            className={`min-h-[36px] rounded px-3 text-[13px] font-bold ${fund === k ? "bg-ink text-paper" : "text-mute hover:text-ink"}`}
          >
            {FUNDS[k].label}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 360 160" role="img" aria-label={`${FUNDS[fund].label} dues in and bills paid, January to June`} className="w-full max-w-xl">
        {MONTHS.map((m, i) => {
          const x = 12 + i * 58;
          const h = (v: number) => (v / top) * 110;
          return (
            <g key={m} onClick={() => setPicked(i)} className="cursor-pointer">
              <rect x={x - 6} y={0} width={56} height={150} fill="transparent" />
              <rect x={x} y={125 - h(dues[i])} width={20} height={h(dues[i])} rx={2} className="fill-good-text" opacity={picked === null || picked === i ? 1 : 0.35} />
              <rect x={x + 22} y={125 - h(spent[i])} width={20} height={h(spent[i])} rx={2} className="fill-brass" opacity={picked === null || picked === i ? 1 : 0.35} />
              <text x={x + 21} y={146} textAnchor="middle" fontSize={11} className="fill-mute">{m}</text>
            </g>
          );
        })}
      </svg>
      <p className="mt-1 flex gap-4 text-[12px] text-mute">
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-good-text" />Dues in</span>
        <span><span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-sm bg-brass" />Bills paid</span>
      </p>
      <p className="mt-3 min-h-[40px] text-[13px]" aria-live="polite">
        {picked === null
          ? <>Tap a month. Six months so far: <span className="figures">{money(net)}</span> left over.</>
          : <>{MONTHS[picked]}: <span className="figures">{money(dues[picked])}</span> in, <span className="figures">{money(spent[picked])}</span> paid out.</>}
      </p>
    </div>
  );
}
