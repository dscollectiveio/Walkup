"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck, FileText, HandCoins, Landmark, ShieldCheck, Wrench } from "lucide-react";

/**
 * The landing hero's right side: one window styled like the app, with a row of
 * tabs attached under its top bar. Pick a tab to see that screen. Left alone it
 * moves on every few seconds with a soft crossfade, and a thin bar under the
 * active tab shows the time left. A mouse resting on the window, or keyboard
 * focus inside it, holds the current screen. Illustrative figures only.
 */

const ADVANCE_MS = 7000;

// Fixed colors on purpose: the example card is a light screenshot on the navy
// hero in both themes, like a photo of the product.
const NAVY = "#1B2A41";
const MUTE = "text-[#5B6475]";
const LINE = "border-[#E3DED3]";

function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "info"; children: React.ReactNode }) {
  const cls = {
    good: "bg-[#e8f3ec] text-[#1f6b45]",
    warn: "bg-[#f8efdb] text-[#8a5f22]",
    bad: "bg-[#f7ebe6] text-[#7a2519]",
    info: "bg-[#eaeff7] text-[#1d3560]",
  }[tone];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

type Slide = {
  key: string;
  tab: string;
  Icon: typeof Landmark;
  body: React.ReactNode;
};

// ---- The example building. Every figure on every screen comes from the data in this block. ------------------

const TODAY = Date.UTC(2026, 9, 16); // the example "today": Oct 16, 2026
const DAY_MS = 86_400_000;
const daysFrom = (utc: number) => Math.round((utc - TODAY) / DAY_MS);
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

/** What each unit pays a month. Every dues figure below is worked out from DUES_UNITS and this. */
const MONTHLY_DUES = 475;
const DUES_UNITS: { unit: string; owner: string; paid: string | null }[] = [
  { unit: "Unit 1", owner: "Patel", paid: "Oct 1" },
  { unit: "Unit 2", owner: "Nguyen", paid: "Oct 3" },
  { unit: "Unit 3", owner: "Lopez", paid: null },
  { unit: "Unit 4", owner: "Brooks", paid: "Oct 2" },
];
const PAID_UNITS = DUES_UNITS.filter((u) => u.paid).length;
const DUES_DUE = DUES_UNITS.length * MONTHLY_DUES;
const DUES_COLLECTED = PAID_UNITS * MONTHLY_DUES;
const DUES_OUTSTANDING = DUES_DUE - DUES_COLLECTED;
const BEHIND = DUES_UNITS.filter((u) => !u.paid);
const DAYS_LATE = -daysFrom(Date.UTC(2026, 9, 1));

/** The budget lines on the bookkeeping screen; the "under plan" sentence is worked out from them. */
const BUDGET_LINES: [name: string, plan: number, spent: number][] = [
  ["Insurance", 4180, 3960],
  ["Utilities", 2400, 1790],
];
const PLAN_TOTAL = BUDGET_LINES.reduce((n, [, plan]) => n + plan, 0);
const SPENT_TOTAL = BUDGET_LINES.reduce((n, [, , spent]) => n + spent, 0);
/** Nine months of a twelve-month year have gone, so an even spread would be 75% used. */
const PACE = 75;

/** Where the money came from, for the short-tax-form check. */
const OWNER_FEES = 5700;
const OTHER_INCOME = 400;
const OWNER_SHARE = Math.round((OWNER_FEES / (OWNER_FEES + OTHER_INCOME)) * 100);

const FORM_1120H_DUE = Date.UTC(2027, 3, 15);

const RENEWS = Date.UTC(2026, 11, 17);
const FIDELITY_BOND = 50000;
const MONEY_HELD = 62000;

// ---- Pieces the real app uses ------------------------------------------------------------------------------

/** A white card with the navy band the app puts on every card: small uppercase title, optional hint. */
function BandCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={`overflow-hidden rounded-lg border ${LINE}`}>
      <div className="px-3 py-2" style={{ background: NAVY }}>
        <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#F5EFE3]">{title}</p>
        {hint ? <p className="mt-0.5 text-[10px] leading-snug text-[#A9B3C7]">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** The app's headline strip: a 3px rule in the status colour and one plain sentence. */
function Answer({ tone, headline, detail, children }: { tone: "good" | "warn" | "bad" | "neutral"; headline: string; detail?: string; children?: React.ReactNode }) {
  const t = {
    good: ["#2f7a5c", "#e8f3ec"],
    warn: ["#d9a441", "#f8efdb"],
    bad: ["#a3432f", "#f7ebe6"],
    neutral: ["#8e93a3", "#f1ede4"],
  }[tone];
  return (
    <div className="rounded-r-lg border-l-[3px] px-3 py-2" style={{ borderColor: t[0], background: t[1] }}>
      <p className="text-[13px] font-bold leading-snug">{headline}</p>
      {detail ? <p className={`mt-0.5 text-[11px] leading-snug ${MUTE}`}>{detail}</p> : null}
      {children}
    </div>
  );
}

/** Rings the part of the screen that makes the feature worth having, with a small gold tag. */
function Spot({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-lg bg-[#fffaf0] ring-2 ring-inset ring-[#D9A441]">
      <span className="absolute bottom-1.5 right-2 z-10 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-[#1B2A41]" style={{ background: "#D9A441" }}>
        {tag}
      </span>
      {children}
    </div>
  );
}

function NavyBtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: NAVY }}>
      {children}
    </span>
  );
}

function GhostBtn({ children }: { children: React.ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-md border border-[#cdc6b6] bg-white px-2.5 py-1 text-[11px] font-semibold`}>{children}</span>;
}

const SLIDES: Slide[] = [
  {
    key: "dues",
    tab: "Dues",
    Icon: HandCoins,
    body: (
      <div className="space-y-3">
        <BandCard title="Where every unit stands" hint={`${BEHIND.length} of ${DUES_UNITS.length} units ${BEHIND.length === 1 ? "is" : "are"} behind.`}>
          <div className="grid grid-cols-3 divide-x divide-[#EFE8DA] border-b border-[#EFE8DA]">
            {[
              ["Collected in October", money(DUES_COLLECTED), `of ${money(DUES_DUE)}`],
              ["Outstanding", money(DUES_OUTSTANDING), ""],
              ["Next due", "Nov 1", ""],
            ].map(([k, v, sub]) => (
              <div key={k} className="px-2.5 py-2">
                <p className={`text-[9px] ${MUTE}`}>{k}</p>
                <p className="mt-0.5 text-[14px] font-semibold tabular-nums">{v}</p>
                {sub ? <p className={`text-[9px] ${MUTE}`}>{sub}</p> : null}
              </div>
            ))}
          </div>
          <ul className="divide-y divide-[#EFE8DA]">
            {DUES_UNITS.map(({ unit, owner, paid }) => (
              <li key={unit} className="flex items-center gap-2 bg-[#f4f7fb] px-3 py-1.5">
                <span className="text-[12px] font-bold">{unit}</span>
                <Pill tone={paid ? "good" : "bad"}>{paid ? "up to date" : "behind"}</Pill>
                <span className={`min-w-0 flex-1 truncate text-[11px] ${MUTE}`}>{owner}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${paid ? MUTE : "bg-[#f7ebe6] text-[#7a2519]"}`}>
                  OWED {paid ? "Paid up" : money(MONTHLY_DUES)}
                </span>
              </li>
            ))}
          </ul>
        </BandCard>
        <div className="space-y-1.5">
          <Spot tag="Drafted for you">
            <div className="flex items-center gap-2 px-3 pb-6 pt-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold leading-snug">
                  {BEHIND[0]?.unit} is behind: {money(MONTHLY_DUES)} past due
                </p>
                <p className={`text-[10px] ${MUTE}`}>
                  {DAYS_LATE} days · {BEHIND[0]?.owner}
                </p>
              </div>
              <GhostBtn>Draft a reminder</GhostBtn>
            </div>
          </Spot>
          <p className={`px-1 text-[10px] ${MUTE}`}>Opens a draft in your own mail app. Nothing is sent by Walkup.</p>
        </div>
      </div>
    ),
  },
  {
    key: "books",
    tab: "Bookkeeping",
    Icon: Landmark,
    body: (
      <div className="space-y-3">
        <BandCard title="Transactions" hint="Click a recommendation to post it.">
          <ul className="divide-y divide-[#EFE8DA]">
            {[
              ["Oct 14", "ComEd", "-$212.40", "Utilities", "you filed this payee the same way 11 times before", false],
              ["Oct 15", "Unit 2 Zelle", `+$${MONTHLY_DUES}.00`, "Dues · Unit 2", "looks like Unit 2's October dues", true],
              ["Oct 12", "GreenScape LLC", "-$390.00", "Landscaping", "you filed this payee the same way 6 times before", false],
            ].map(([date, who, amt, cat, why, key]) => {
              const row = (
                <li className="px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <span className={`w-10 shrink-0 text-[10px] ${MUTE}`}>{date}</span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{who}</span>
                    <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${String(amt).startsWith("+") ? "text-[#2f7a5c]" : ""}`}>{amt}</span>
                  </div>
                  <div className="mt-0.5 pl-12">
                    <span className="inline-flex items-center rounded-full bg-[#eaeff7] px-2 py-0.5 text-[10px] font-semibold text-[#1d3560]">&#10003; {cat}</span>
                    <p className={`mt-0.5 text-[10px] leading-snug ${MUTE}`}>{why}</p>
                  </div>
                </li>
              );
              return key ? (
                <div key={who as string} className="py-1.5">
                  <Spot tag="One click">{row}</Spot>
                </div>
              ) : (
                <div key={who as string}>{row}</div>
              );
            })}
          </ul>
        </BandCard>
        <Answer
          tone="good"
          headline={`Fiscal 2026 so far: ${money(SPENT_TOTAL)} spent of ${money(PLAN_TOTAL)} planned: ${money(PLAN_TOTAL - SPENT_TOTAL)} under plan.`}
        >
          <div className="relative mt-2 h-1.5 rounded-full bg-[#ece5d6]">
            <div className="h-1.5 rounded-full bg-[#2f7a5c]" style={{ width: `${Math.round((SPENT_TOTAL / PLAN_TOTAL) * 100)}%` }} />
            <span aria-hidden="true" className="absolute -top-0.5 h-2.5 w-px bg-[#1B2A41]" style={{ left: `${PACE}%` }} />
          </div>
        </Answer>
      </div>
    ),
  },
  {
    key: "taxes",
    tab: "Taxes",
    Icon: FileText,
    body: (
      <div className="space-y-3">
        <Spot tag="Deadline counted">
          <Answer tone="neutral" headline={`Form 1120-H is due April 15, 2027, ${daysFrom(FORM_1120H_DUE)} days`}>
            <div className="mt-1.5 flex items-center pb-5">
              <NavyBtn>Start Form 1120-H</NavyBtn>
            </div>
          </Answer>
        </Spot>
        <BandCard title="1120-H check">
          <div className="space-y-2 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-bold">You qualify for the short tax form this year</p>
              <Pill tone="good">Yes</Pill>
            </div>
            <div>
              <p className="text-[11px] font-semibold">Rule 1: where your money comes from</p>
              <div className="relative mt-1.5 h-2 rounded-full bg-[#ece5d6]">
                <div className="h-2 rounded-full bg-[#2f7a5c]" style={{ width: `${OWNER_SHARE}%` }} />
                <span aria-hidden="true" className="absolute -top-1 h-4 w-0.5 bg-[#1B2A41]" style={{ left: "60%" }} />
              </div>
              <div className={`mt-1 flex justify-between text-[10px] ${MUTE}`}>
                <span>You&rsquo;re at {OWNER_SHARE}%</span>
                <span>need 60% · marked by the line</span>
              </div>
            </div>
          </div>
        </BandCard>
      </div>
    ),
  },
  {
    key: "insurance",
    tab: "Insurance",
    Icon: ShieldCheck,
    body: (
      <div className="space-y-3">
        <Answer tone="warn" headline={`Master policy renews in ${daysFrom(RENEWS)} days, on Dec 17, 2026.`}>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <NavyBtn>Ask for quotes</NavyBtn>
            <GhostBtn>Find agencies</GhostBtn>
          </div>
        </Answer>
        <BandCard title="Coverage on file">
          <ul className="grid grid-cols-2 divide-x divide-y divide-[#EFE8DA]">
            {(
              [
                ["Building and property", "$4,200,000", "good"],
                ["General liability", "$1,000,000", "good"],
                ["Directors and officers", "$1,000,000", "good"],
                ["Crime and fidelity bond", money(FIDELITY_BOND), "bad"],
              ] as const
            ).map(([k, v, tone]) => (
              <li key={k} className="px-2.5 py-2">
                <p className={`text-[10px] ${MUTE}`}>{k}</p>
                <p className="text-[13px] font-semibold tabular-nums">{v}</p>
                <p className={`mt-0.5 flex items-center gap-1 text-[9px] ${MUTE}`}>
                  <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${tone === "good" ? "bg-[#2f7a5c]" : "bg-[#a3432f]"}`} />
                  {tone === "good" ? "Acme Mutual master policy" : "Gap: see Coverage check"}
                </p>
              </li>
            ))}
          </ul>
        </BandCard>
        <Spot tag="Gap found">
          <div className="px-3 pb-6 pt-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone="bad">Gap</Pill>
              <span className="rounded-full border border-[#cdc6b6] px-2 py-0.5 text-[9px] font-semibold">Illinois law</span>
            </div>
            <p className="mt-1 text-[12px] font-bold leading-snug">
              The fidelity bond is {money(MONEY_HELD - FIDELITY_BOND)} below the money the association holds.
            </p>
          </div>
        </Spot>
      </div>
    ),
  },
  {
    key: "maintenance",
    tab: "Maintenance",
    Icon: Wrench,
    body: (
      <div className="space-y-3">
        <Answer tone="bad" headline="1 emergency problem open" detail="Roof leak over Unit 4." />
        <BandCard title="Problems">
          <div className="px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] font-bold">Roof leak over Unit 4</span>
              <Pill tone="bad">Emergency</Pill>
            </div>
            <p className={`mt-0.5 text-[10px] ${MUTE}`}>#12 · Unit 4 · Roofing · reported Oct 14 · No contractor yet</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
              <span className="rounded-md border border-[#cdc6b6] px-2 py-0.5 font-medium">1. Not Started</span>
              <span className="font-semibold underline underline-offset-2">Get quotes</span>
            </div>
          </div>
        </BandCard>
        <BandCard title="Upkeep schedule">
          <Spot tag="Never forgotten">
            <div className="flex items-center gap-2 px-3 pb-6 pt-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold">Gutters and downspouts cleared</p>
                <p className={`truncate text-[10px] ${MUTE}`}>Every year · last done Oct 4, 2025</p>
              </div>
              <Pill tone="bad">12 days overdue</Pill>
            </div>
          </Spot>
          <div className="flex items-center gap-2 border-t border-[#EFE8DA] px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">Boiler / furnace service</p>
              <p className={`truncate text-[10px] ${MUTE}`}>Every year · HVAC</p>
            </div>
            <Pill tone="info">due Nov 14</Pill>
          </div>
        </BandCard>
      </div>
    ),
  },
  {
    key: "documents",
    tab: "Documents",
    Icon: FileCheck,
    body: (
      <div className="space-y-3">
        <BandCard title="All documents">
          <div className="border-b border-[#EFE8DA] px-3 py-2">
            <div className={`rounded-md border border-[#cdc6b6] bg-white px-2 py-1 text-[11px] ${MUTE}`}>Search titles, filenames or words inside the file</div>
          </div>
          <ul className="divide-y divide-[#EFE8DA]">
            {(
              [
                ["Master policy 2026", "Insurance", "212 KB · 10/16/2026 · uploaded · version 2", false],
                ["Riverside Roofing W-9", "Tax form", "98 KB · 10/15/2026 · arrived by email", false],
                ["Board minutes, September", "Meeting minutes", "140 KB · 10/02/2026 · uploaded", false],
                ["scan_0231.pdf", "Invoice or bill", "301 KB · 10/14/2026 · scanned", true],
              ] as const
            ).map(([title, cat, meta, guess]) => {
              const row = (
                <li className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-semibold">{title}</span>
                    {guess ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f8efdb] px-2 py-0.5 text-[10px] font-semibold text-[#8a5f22]">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#d9a441]" />
                        {cat} · guess, 82% sure
                      </span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cat === "Tax form" ? "bg-[#eaeff7] text-[#1d3560]" : "bg-[#efeae0] text-[#4a4f60]"}`}>{cat}</span>
                    )}
                  </div>
                  <p className={`text-[10px] ${MUTE}`}>{meta}</p>
                </li>
              );
              return guess ? (
                <div key={title} className="py-1">
                  <Spot tag="Person confirms">{row}</Spot>
                </div>
              ) : (
                <div key={title}>{row}</div>
              );
            })}
          </ul>
        </BandCard>
      </div>
    ),
  },
];

/** The sidebar lists the pages in the app's own order; the tabs above the window use the order of SLIDES. */
const RAIL_ORDER = ["books", "dues", "taxes", "insurance", "maintenance", "documents"];

export function HeroSlideshow() {
  const [index, setIndex] = useState(0);
  // A mouse resting on the window or keyboard focus inside it holds the screen; a tap on a phone must not freeze it.
  const [held, setHeld] = useState(false);
  const regionRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const go = useCallback((next: number) => {
    const i = (next + SLIDES.length) % SLIDES.length;
    setIndex(i);
    tabRefs.current[i]?.focus();
  }, []);

  useEffect(() => {
    if (held) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % SLIDES.length), ADVANCE_MS);
    return () => window.clearTimeout(id);
  }, [index, held]);

  return (
    <div
      ref={regionRef}
      className="relative min-w-0"
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHeld(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHeld(false);
      }}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!regionRef.current?.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-[#F5EFE3] text-[#1B2A41] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)] ring-1 ring-black/5">
        {/* The app's top bar, then the tabs on a second navy strip, so tabs and window read as one product view. */}
        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[#F5EFE3]" style={{ background: NAVY }}>
          <span className="min-w-0 flex-1 truncate font-semibold">1420 W. Example St.</span>
          <span className="hidden text-[#A9B3C7] sm:inline">Help</span>
          <span className="hidden text-[#A9B3C7] sm:inline">Sign out</span>
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-brass text-[9px] font-bold text-[#1B2A41]">
            DS
          </span>
        </div>
        <div
          role="tablist"
          aria-label="Walkup's screens"
          className="flex overflow-x-auto border-t border-white/10 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ background: NAVY }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") {
              e.preventDefault();
              go(index + 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              go(index - 1);
            } else if (e.key === "Home") {
              e.preventDefault();
              go(0);
            } else if (e.key === "End") {
              e.preventDefault();
              go(SLIDES.length - 1);
            }
          }}
        >
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <button
                key={s.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                id={`hero-tab-${s.key}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`hero-panel-${s.key}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setIndex(i)}
                className={`relative shrink-0 px-3 py-2.5 text-[12px] font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass ${
                  active ? "text-white" : "text-[#A9B3C7] hover:text-white"
                }`}
              >
                {s.tab}
                {active ? (
                  // The only mark of the selected tab: a bar that fills over the time to the next screen and holds still while held.
                  <span aria-hidden="true" className="absolute inset-x-1.5 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/15">
                    <span
                      key={index}
                      className="hero-progress absolute inset-0 origin-left bg-brass"
                      style={{ animationDuration: `${ADVANCE_MS}ms`, animationPlayState: held ? "paused" : "running" }}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {/* Every panel sits in the same grid cell, so the window keeps the height of the tallest one and never jumps. */}
        <div className="grid grid-cols-[minmax(0,1fr)]">
          {SLIDES.map((s, i) => {
            const active = i === index;
            return (
              <div
                key={s.key}
                id={`hero-panel-${s.key}`}
                role="tabpanel"
                aria-labelledby={`hero-tab-${s.key}`}
                aria-hidden={!active}
                inert={!active}
                data-active={active}
                className={`col-start-1 row-start-1 flex transition-opacity duration-200 ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}
              >
                {/* The sidebar, as icons: the page on show has the navy fill and the gold bar on its left edge. */}
                <div aria-hidden="true" className="hidden w-11 shrink-0 flex-col items-center gap-1 border-r border-[#E3DED3] bg-white py-2 sm:flex">
                  {RAIL_ORDER.map((k) => {
                    const NavIcon = SLIDES.find((n) => n.key === k)!.Icon;
                    const on = k === s.key;
                    return (
                      <span key={k} className={`relative flex h-8 w-8 items-center justify-center rounded-md ${on ? "bg-[#1B2A41] text-white" : "text-[#8e93a3]"}`}>
                        {on ? <span className="absolute -left-1.5 bottom-1 top-1 w-[3px] rounded-r bg-brass" /> : null}
                        <NavIcon size={15} strokeWidth={1.8} />
                      </span>
                    );
                  })}
                </div>
                <div className="min-w-0 flex-1 p-3">{s.body}</div>
              </div>
            );
          })}
        </div>
        <p className={`border-t border-[#E3DED3] px-3 py-1.5 text-[10px] ${MUTE}`}>Example building, illustrative figures</p>
      </div>
    </div>
  );
}
