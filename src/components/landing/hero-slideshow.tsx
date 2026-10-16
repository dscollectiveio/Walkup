"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The landing hero's right side: small, clearly labelled examples of Walkup's
 * screens, most important feature first. Illustrative figures only. Advances
 * on its own every few seconds with a soft crossfade; hovering or focusing it
 * holds the current slide, and the pause button stops it. Under reduced
 * motion it still advances, but only fades (no movement).
 */

const ADVANCE_MS = 6000;

// Fixed colors on purpose: the example card is a light screenshot on the navy
// hero in both themes, like a photo of the product.
const NAVY = "#1B2A41";
const MUTE = "text-[#5B6475]";
const LINE = "border-[#E3DED3]";

type Slide = { key: string; screen: string; caption: string; body: React.ReactNode };

function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const cls = {
    good: "bg-[#e8f3ec] text-[#1f6b45]",
    warn: "bg-[#f8efdb] text-[#8a5f22]",
    bad: "bg-[#f7ebe6] text-[#7a2519]",
    info: "bg-[#eaeff7] text-[#1d3560]",
  }[tone];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-[#e8f3ec] px-3 py-2 text-[12px] text-[#1f6b45]">{children}</div>;
}

const SLIDES: Slide[] = [
  {
    key: "books",
    screen: "Bank feed",
    caption: "Every transaction arrives sorted, with the reason for each suggestion.",
    body: (
      <div className="space-y-3">
        <ul className={`divide-y divide-[#EFE8DA] rounded-lg border ${LINE}`}>
          {[
            ["ComEd", "Utilities", "-$212.40", "filed this way 11 times"],
            ["Unit 3 Zelle", "Dues, Unit 3", "+$475.00", "matches Unit 3's dues"],
            ["GreenScape LLC", "Landscaping", "-$390.00", "filed this way 6 times"],
            ["Chase fee", "Bank fees", "-$15.00", "filed this way 9 times"],
          ].map(([who, cat, amt, why]) => (
            <li key={who} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{who}</span>
                <span className={`block truncate text-[10px] ${MUTE}`}>{why}</span>
              </span>
              <Pill tone="info">{cat}</Pill>
              <span className="w-[4.5rem] shrink-0 text-right text-[12px] font-semibold tabular-nums">{amt}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <span className={`text-[11px] ${MUTE}`}>4 suggestions ready</span>
          <span className="rounded-md px-3 py-1.5 text-[11px] font-semibold text-white" style={{ background: NAVY }}>
            Post all 4
          </span>
        </div>
      </div>
    ),
  },
  {
    key: "dues",
    screen: "HOA dues",
    caption: "See who has paid and who is behind, with a friendly reminder drafted for you.",
    body: (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Collected", "$1,900"],
            ["Outstanding", "$475"],
            ["Units current", "3 of 4"],
          ].map(([k, v]) => (
            <div key={k} className={`rounded-lg border ${LINE} px-3 py-2`}>
              <p className={`text-[10px] ${MUTE}`}>{k}</p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>
        <ul className={`divide-y divide-[#EFE8DA] rounded-lg border ${LINE}`}>
          {(
            [
              ["Unit 1", "Paid Oct 1", "good", "Up to date"],
              ["Unit 2", "Paid Oct 3", "good", "Up to date"],
              ["Unit 3", "$475 owed", "bad", "Behind"],
              ["Unit 4", "Paid Oct 2", "good", "Up to date"],
            ] as const
          ).map(([unit, note, tone, label]) => (
            <li key={unit} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="text-[12px] font-medium">{unit}</span>
              <span className={`flex-1 text-[11px] ${MUTE}`}>{note}</span>
              <Pill tone={tone}>{label}</Pill>
            </li>
          ))}
        </ul>
        <div className="rounded-lg bg-[#f8efdb] px-3 py-2 text-[12px] text-[#8a5f22]">
          Reminder to Unit 3 drafted. Nothing sends until you approve it.
        </div>
      </div>
    ),
  },
  {
    key: "budget",
    screen: "Budget",
    caption: "One sentence tells you if you're on plan. Biggest spending first.",
    body: (
      <div className="space-y-3">
        <Note>You&rsquo;re on plan: $2,140 under budget with 9 months gone.</Note>
        <ul className="space-y-2.5">
          {[
            ["Insurance", 4180, 3960, "#2d4a7c"],
            ["Landscaping and snow", 3600, 3150, "#d9a441"],
            ["Utilities", 2400, 1790, "#2f7a5c"],
            ["Repairs", 2000, 1240, "#a3432f"],
          ].map(([name, plan, spent, color]) => (
            <li key={name as string}>
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="font-medium">{name}</span>
                <span className={`tabular-nums ${MUTE}`}>
                  ${(spent as number).toLocaleString("en-US")} of ${(plan as number).toLocaleString("en-US")}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[#ece5d6]">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.min(100, Math.round(((spent as number) / (plan as number)) * 100))}%`,
                    background: color as string,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    key: "statements",
    screen: "Financial statements",
    caption: "Profit and loss for any period, ready to bring to the board meeting.",
    body: (
      <div className={`rounded-lg border ${LINE}`}>
        <div className={`flex items-center justify-between border-b ${LINE} px-3 py-2`}>
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#62677a]">Q3 profit and loss</span>
          <span className="rounded-md border border-[#cdc6b6] px-2 py-0.5 text-[10px] font-semibold">PDF</span>
        </div>
        <dl className="divide-y divide-[#EFE8DA] text-[12px]">
          {[
            ["Dues income", "$5,700.00", false],
            ["Insurance", "-$1,285.00", false],
            ["Utilities", "-$604.12", false],
            ["Landscaping", "-$1,170.00", false],
            ["Repairs", "-$418.50", false],
            ["Net income", "$2,222.38", true],
          ].map(([k, v, total]) => (
            <div key={k as string} className={`flex justify-between px-3 py-1.5 ${total ? "font-semibold" : ""}`}>
              <dt>{k}</dt>
              <dd className="tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    ),
  },
  {
    key: "taxes",
    screen: "Taxes",
    caption: "Form 1120-H prepared from your books, with every deadline on the calendar.",
    body: (
      <div className="space-y-3">
        <div className={`flex items-center justify-between gap-3 rounded-lg border ${LINE} px-3 py-2.5`}>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Form 1120-H</span>
            <span className={`block text-[10px] ${MUTE}`}>Every figure traced to its transactions</span>
          </span>
          <Pill tone="good">You qualify</Pill>
        </div>
        <ul className={`divide-y divide-[#EFE8DA] rounded-lg border ${LINE}`}>
          {[
            ["Contractor 1099s", "Jan 31", 107],
            ["Illinois annual report", "Feb 28", 135],
            ["Form 1120-H", "Apr 15", 181],
          ].map(([name, due, days]) => (
            <li key={name as string} className="flex items-center gap-3 px-3 py-2">
              <span className="w-[4.25rem] shrink-0 whitespace-nowrap text-right tabular-nums">
                <span className="text-[14px] font-semibold">{days}</span>
                <span className={`ml-1 text-[10px] ${MUTE}`}>days</span>
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{name}</span>
              <span className={`text-[11px] ${MUTE}`}>{due}</span>
            </li>
          ))}
        </ul>
      </div>
    ),
  },
  {
    key: "repairs",
    screen: "Repairs and documents",
    caption: "Problems, upkeep and every document in one place the next board can find.",
    body: (
      <div className="space-y-3">
        <ul className={`divide-y divide-[#EFE8DA] rounded-lg border ${LINE}`}>
          {(
            [
              ["Roof leak over Unit 4", "Quote from Riverside Roofing", "bad", "Urgent"],
              ["Gutter cleaning", "Every fall, due in 12 days", "warn", "Upkeep"],
              ["Hallway light out", "Fixed Oct 8", "good", "Done"],
            ] as const
          ).map(([title, note, tone, label]) => (
            <li key={title} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">{title}</span>
                <span className={`block truncate text-[10px] ${MUTE}`}>{note}</span>
              </span>
              <Pill tone={tone}>{label}</Pill>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {["Declaration", "Master policy", "W-9s", "Minutes", "Budget 2026"].map((d) => (
            <span key={d} className={`rounded-md border ${LINE} px-2 py-1 text-[10px] font-medium`}>
              {d}
            </span>
          ))}
        </div>
      </div>
    ),
  },
];

export function HeroSlideshow() {
  const [index, setIndex] = useState(0);
  // Hover and keyboard focus pause it for a moment; the button pauses it for good.
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => setIndex((next + SLIDES.length) % SLIDES.length), []);
  const paused = held || stopped;

  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => go(index + 1), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [index, paused, go]);

  return (
    <div
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="Examples of Walkup's screens"
      className="relative"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!regionRef.current?.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + 1);
        else if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      {/* A soft gold glow behind the card, so it lifts off the navy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-6 -z-0 rounded-[32px] bg-[radial-gradient(60%_55%_at_60%_40%,rgba(217,164,65,0.22),transparent_70%)] blur-2xl"
      />
      {/* Every slide sits in the same grid cell, so the card keeps the height
          of the tallest one and the page never jumps. */}
      <div className="relative grid" aria-live={paused ? "polite" : "off"}>
        {SLIDES.map((s, i) => {
          const active = i === index;
          return (
            <div
              key={s.key}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${SLIDES.length}: ${s.screen}`}
              aria-hidden={!active}
              inert={!active}
              data-active={active}
              className={`hero-slide col-start-1 row-start-1 flex flex-col transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-opacity ${
                active ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-2 scale-[0.98] opacity-0"
              }`}
            >
              <div className="flex-1 overflow-hidden rounded-2xl border border-white/20 bg-white text-[#1B2A41] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-black/5">
                <div className="flex items-center gap-3 px-4 py-2.5 text-[12px] text-white/80" style={{ background: NAVY }}>
                  <span aria-hidden="true" className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#D9A441]" />
                  </span>
                  <span className="font-semibold text-white">{s.screen}</span>
                  <span className="ml-auto truncate">1420 W. Example St.</span>
                </div>
                <div className="hero-stagger p-4">{s.body}</div>
              </div>
              <div className="mt-4 min-h-[3.25rem] text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-eyebrow">
                  {i + 1} of {SLIDES.length} · {s.screen}
                </p>
                <p className="mt-1 text-[14px] leading-snug text-ink">{s.caption}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="relative mt-2 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => go(index - 1)}
          aria-label="Previous example"
          className="flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors duration-300 hover:bg-ink/10 hover:text-ink"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex items-center gap-1.5">
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => go(i)}
                aria-label={`Show ${s.screen}`}
                aria-current={active ? "true" : undefined}
                className="flex h-6 items-center px-0.5"
              >
                <span
                  aria-hidden="true"
                  className={`relative block h-1.5 overflow-hidden rounded-full transition-all duration-500 ease-out ${
                    active ? "w-8 bg-ink/20" : "w-1.5 bg-ink/30 hover:bg-ink/60"
                  }`}
                >
                  {active ? (
                    // Fills over the time to the next slide; holds still while paused.
                    <span
                      key={index}
                      className="hero-progress absolute inset-0 origin-left rounded-full bg-[#D9A441]"
                      style={{ animationDuration: `${ADVANCE_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => go(index + 1)}
          aria-label="Next example"
          className="flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors duration-300 hover:bg-ink/10 hover:text-ink"
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setStopped((v) => !v)}
          aria-label={stopped ? "Play the examples" : "Pause the examples"}
          aria-pressed={stopped}
          className="ml-1 flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors duration-300 hover:bg-ink/10 hover:text-ink"
        >
          {stopped ? (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M3.5 2l6 4-6 4z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="3" y="2" width="2" height="8" rx="0.5" fill="currentColor" />
              <rect x="7" y="2" width="2" height="8" rx="0.5" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
      <p className="relative mt-1 text-center text-[11px] text-mute">Example building, illustrative figures</p>
    </div>
  );
}
