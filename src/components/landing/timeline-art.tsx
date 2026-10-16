import { HardHat, Landmark, Wrench } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Small animated pictures for the How it works timeline, one per step, drawn
 * in code (no images). They sit on the side of the line opposite the card and
 * loop quietly while the step is on screen. The motion lives in globals.css
 * (.tl-*), and only runs when the person hasn't asked for reduced motion; the
 * still version is the finished picture. Decorative, so hidden from screen
 * readers: the card already says everything.
 */

const NAVY = "#1B2A41";
const GOLD = "#D9A441";

function Stage({ color, children }: { color: string; children: ReactNode }) {
  // Drawn at 270 x 190 and shown at 78%, so the pictures stay compact beside their cards.
  return (
    <div aria-hidden="true" className="relative mx-auto h-[148px] w-[211px]">
      <div className="absolute left-0 top-0 flex h-[190px] w-[270px] origin-top-left scale-[0.78] items-center justify-center">
        <div className="absolute inset-3 rounded-[28px]" style={{ background: color, opacity: 0.14 }} />
        <div className="absolute -right-1 -top-1 h-9 w-9 rounded-full" style={{ background: color, opacity: 0.35 }} />
        <div className="absolute -bottom-2 -left-2 h-6 w-6 rounded-md" style={{ background: GOLD, opacity: 0.5, transform: "rotate(12deg)" }} />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

/** 1. Set up your building: a building whose windows (units) light up one by one. */
function BuildingArt() {
  const windows = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => ({ row, col, delay: (row * 3 + col) * 0.28 })));
  return (
    <Stage color="#D9A441">
      <svg viewBox="0 0 150 150" width="150" height="150" className="tl-art">
        <rect x="28" y="22" width="94" height="112" rx="5" fill={NAVY} />
        <rect x="22" y="16" width="106" height="10" rx="3" fill="#2d4a7c" />
        {windows.map(({ row, col, delay }) => (
          <rect
            key={`${row}-${col}`}
            className="tl-window"
            style={{ animationDelay: `${delay}s` }}
            x={40 + col * 28}
            y={36 + row * 26}
            width="16"
            height="16"
            rx="2.5"
            fill={GOLD}
          />
        ))}
        <rect x="63" y="112" width="24" height="22" rx="3" fill="#F5EFE3" />
        <circle cx="123" cy="40" r="3" fill="#F5EFE3" opacity=".0" />
      </svg>
    </Stage>
  );
}

/** 2. Connect your bank: transactions arrive and get their categories. */
function BankArt() {
  const rows = [
    ["ComEd", "Utilities", "#2d4a7c"],
    ["Unit 3", "Dues", "#2f7a5c"],
    ["GreenScape", "Landscaping", "#a3432f"],
  ];
  return (
    <Stage color="#2d4a7c">
      <div className="w-[210px]">
        <div className="mb-2 flex items-center justify-center gap-2 text-[#1B2A41]">
          <Landmark size={22} strokeWidth={1.8} className="tl-bob" />
          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Bank feed</span>
        </div>
        <div className="space-y-1.5">
          {rows.map(([who, cat, c], i) => (
            <div key={who} className="flex items-center justify-between gap-2 rounded-md bg-white px-2.5 py-1.5 text-[11px] shadow-sm">
              <span className="font-medium text-[#1B2A41]">{who}</span>
              <span
                className="tl-pill rounded-full px-2 py-px text-[9.5px] font-semibold text-white"
                style={{ background: c, animationDelay: `${i * 0.55}s` }}
              >
                {cat}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}

/** 3. Set dues and the budget: bars grow against a budget line. */
function BudgetArt() {
  const bars = [
    { h: 46, c: "#2d4a7c" },
    { h: 70, c: "#D9A441" },
    { h: 56, c: "#2f7a5c" },
    { h: 88, c: "#a3432f" },
  ];
  return (
    <Stage color="#2f7a5c">
      <svg viewBox="0 0 170 130" width="190" height="146" className="tl-art">
        <line x1="14" y1="112" x2="160" y2="112" stroke={NAVY} strokeWidth="2" strokeLinecap="round" />
        {bars.map((b, i) => (
          <rect
            key={i}
            className="tl-bar"
            style={{ animationDelay: `${i * 0.25}s`, transformOrigin: `${28 + i * 34}px 112px` }}
            x={20 + i * 34}
            y={112 - b.h}
            width="22"
            height={b.h}
            rx="3"
            fill={b.c}
          />
        ))}
        <line x1="14" y1="48" x2="160" y2="48" stroke={NAVY} strokeWidth="1.5" strokeDasharray="5 5" opacity=".55" />
        <g className="tl-bob">
          <circle cx="146" cy="26" r="13" fill={GOLD} />
          <text x="146" y="31" textAnchor="middle" fontSize="15" fontWeight="700" fill={NAVY}>
            $
          </text>
        </g>
      </svg>
    </Stage>
  );
}

/** 4. Add insurance and tax info: a shield whose check mark draws itself, beside a form. */
function ShieldArt() {
  return (
    <Stage color="#a3432f">
      <svg viewBox="0 0 190 140" width="200" height="148" className="tl-art">
        <g className="tl-doc">
          <rect x="108" y="30" width="58" height="76" rx="6" fill="#fff" stroke={NAVY} strokeWidth="2" />
          <rect x="118" y="42" width="30" height="5" rx="2.5" fill={NAVY} opacity=".7" />
          <rect x="118" y="55" width="38" height="4" rx="2" fill={NAVY} opacity=".3" />
          <rect x="118" y="65" width="34" height="4" rx="2" fill={NAVY} opacity=".3" />
          <rect x="118" y="75" width="38" height="4" rx="2" fill={NAVY} opacity=".3" />
          <text x="137" y="98" textAnchor="middle" fontSize="9" fontWeight="700" fill="#a3432f">
            1120-H
          </text>
        </g>
        <path d="M60 16 L100 30 V68 C100 94 82 110 60 120 C38 110 20 94 20 68 V30 Z" fill={NAVY} />
        <path d="M60 24 L92 35 V68 C92 89 77 102 60 111 C43 102 28 89 28 68 V35 Z" fill="#2d4a7c" />
        <path className="tl-check" d="M42 68 L56 82 L80 54" fill="none" stroke={GOLD} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" />
      </svg>
    </Stage>
  );
}

/** 5. Add your existing contractors: a hard hat, a wrench, and a quote request going out. */
function ContractorArt() {
  return (
    <Stage color="#8fa3c4">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-end gap-4 text-[#1B2A41]">
          <HardHat size={64} strokeWidth={1.5} className="tl-bob" />
          <Wrench size={44} strokeWidth={1.6} className="tl-wrench text-[#2d4a7c]" />
        </div>
        <div className="tl-chip flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#1B2A41] shadow-sm">
          <span className="h-2 w-2 rounded-full bg-[#2f7a5c]" />
          Quote request sent
        </div>
      </div>
    </Stage>
  );
}

const ART = [BuildingArt, BankArt, BudgetArt, ShieldArt, ContractorArt];

export function TimelineArt({ index }: { index: number }) {
  const Art = ART[index];
  return Art ? <Art /> : null;
}
