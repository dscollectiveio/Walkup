"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { formatMoney } from "@/lib/tax/form1120h";
import { Empty } from "@/components/ui";
import { LineChart, type LinePoint } from "./charts/line-chart";
import { BarChart, type BarGroup } from "./charts/bar-chart";
import { DonutChart, type DonutSlice } from "./charts/donut-chart";

// Flat tinted panels, not the mockup's gradients — gradients are banned by
// the brand guide, and the tint families carry the same warm/cool split.
const TONES = {
  good: { card: "border-good-line bg-good-tint", heading: "text-good-text" },
  info: { card: "border-info-line bg-info-tint", heading: "text-info-text" },
  warning: { card: "border-warning-line bg-warning-tint", heading: "text-warning-text" },
} as const;

export interface CashCardData {
  points: LinePoint[];
  netChangeCents: number;
  sinceLabel: string;
}

export interface InOutCardData {
  groups: BarGroup[];
  varianceCents: number | null; // null = no budget set
  fiscalYearLabel: string;
}

export interface SpendingCardData {
  slices: DonutSlice[];
  avgMonthlyCents: number;
  sinceLabel: string;
}

interface View {
  key: "cash" | "inout" | "spending";
  tab: string;
  tone: keyof typeof TONES;
  heading: string;
  line: string;
  figure: string;
  figureTone: string;
  figureCaption: string;
  button: { label: string; href: string };
  chart: React.ReactNode;
}

function buildViews(
  cash: CashCardData | null,
  inOut: InOutCardData | null,
  spending: SpendingCardData | null,
): View[] {
  const views: View[] = [];

  if (cash && cash.points.length > 0) {
    views.push({
      key: "cash",
      tab: "In the bank",
      tone: "good",
      heading: "Money in the bank",
      line: "Every account together, month by month.",
      figure: `${cash.netChangeCents >= 0 ? "+" : "−"}${formatMoney(Math.abs(cash.netChangeCents))}`,
      figureTone: cash.netChangeCents >= 0 ? "text-good-text" : "text-bad-text",
      figureCaption: `net change ${cash.sinceLabel.replace(/^Since/, "since")}`,
      button: { label: "See every transaction", href: "/ledger" },
      chart: (
        <>
          <LineChart
            points={cash.points}
            ariaLabel={`Cash balance ${cash.sinceLabel.toLowerCase()}, ending at ${formatMoney(
              cash.points[cash.points.length - 1].valueCents,
            )}, a net change of ${formatMoney(cash.netChangeCents)}.`}
          />
          <p className="mt-1 text-right text-[10px] text-mute-soft">{cash.sinceLabel}</p>
        </>
      ),
    });
  }

  if (inOut && inOut.groups.length > 0) {
    const v = inOut.varianceCents;
    views.push({
      key: "inout",
      tab: "In & out",
      tone: "info",
      heading: "In and out, month by month",
      line: "What came in against what went out.",
      figure: v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatMoney(Math.abs(v))}`,
      figureTone: v === null ? "text-ink" : v > 0 ? "text-bad-text" : "text-good-text",
      figureCaption:
        v === null
          ? `no budget set for ${inOut.fiscalYearLabel} yet`
          : `spending against budget, ${inOut.fiscalYearLabel} to date`,
      button: { label: "Open the budget", href: "/budget" },
      chart: (
        <BarChart
          groups={inOut.groups}
          seriesALabel="came in"
          seriesBLabel="went out"
          ariaLabel={`Monthly money in and out over the last ${inOut.groups.length} months.`}
        />
      ),
    });
  }

  if (spending && spending.slices.length > 0) {
    views.push({
      key: "spending",
      tab: "Where it went",
      tone: "warning",
      heading: "Where the money went",
      line: "Spending grouped by account, the same way the ledger sees it.",
      figure: formatMoney(spending.avgMonthlyCents),
      figureTone: "text-ink",
      figureCaption: `average monthly spend ${spending.sinceLabel.replace(/^Since/, "since")}`,
      button: { label: "See all spending", href: "/ledger" },
      chart: (
        <DonutChart
          slices={spending.slices}
          ariaLabel={`Spending by category ${spending.sinceLabel.toLowerCase()}, averaging ${formatMoney(
            spending.avgMonthlyCents,
          )} a month.`}
        />
      ),
    });
  }

  return views;
}

/**
 * Every view is rendered in the same grid cell and only the active one is
 * visible, so the cell is always as tall as the tallest view. That is what
 * keeps the card from resizing as it switches — no measuring, no magic
 * number. Hidden views are inert (unfocusable, unclickable) and aria-hidden.
 */
function Stack({
  views,
  activeKey,
  animated,
  children,
}: {
  views: View[];
  activeKey: View["key"];
  animated: boolean;
  children: (view: View) => React.ReactNode;
}) {
  return (
    <div className="grid">
      {views.map((v) => {
        const active = v.key === activeKey;
        return (
          <div
            key={v.key}
            aria-hidden={!active}
            inert={!active}
            className={`col-start-1 row-start-1 ${active ? (animated ? "money-slide" : "") : "invisible"}`}
          >
            {children(v)}
          </div>
        );
      })}
    </div>
  );
}

/** How long each view stays up while the card is rotating on its own. */
const ROTATE_MS = 12000;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * The three money views — cash balance, in vs out, spending by category —
 * share one card and switch with tabs, so they take a single card's space.
 * Only views with data get a tab.
 *
 * It also rotates through them on its own, so a glance at Home shows all
 * three. The rotation is the user's to stop: hovering or focusing inside the
 * card holds it, clicking a tab ends it, the pause button toggles it, and
 * anyone who has asked their system for reduced motion never gets it.
 */
export function ShowcaseCards({
  cash,
  inOut,
  spending,
}: {
  cash: CashCardData | null;
  inOut: InOutCardData | null;
  spending: SpendingCardData | null;
}) {
  const views = buildViews(cash, inOut, spending);
  const [activeKey, setActiveKey] = useState<View["key"] | null>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const rotating = views.length > 1 && !userPaused && !reducedMotion;
  // Nothing slides on first paint — only once the view has actually changed.
  const animated = activeKey !== null;
  const currentKey = (views.find((v) => v.key === activeKey) ?? views[0])?.key;

  useEffect(() => {
    if (!rotating || holding || !currentKey) return;
    const timer = setTimeout(() => {
      const i = views.findIndex((v) => v.key === currentKey);
      setActiveKey(views[(i + 1) % views.length].key);
    }, ROTATE_MS);
    return () => clearTimeout(timer);
    // `views` is rebuilt every render from props; its length and keys are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotating, holding, currentKey, views.length]);

  if (views.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-paper">
        <Empty>No monthly activity recorded yet — these fill in once something posts.</Empty>
      </div>
    );
  }

  const view = views.find((v) => v.key === activeKey) ?? views[0];
  const t = TONES[view.tone];

  return (
    <section
      onMouseEnter={() => setHolding(true)}
      onMouseLeave={() => setHolding(false)}
      onFocusCapture={() => setHolding(true)}
      onBlurCapture={() => setHolding(false)}
      className={`relative grid overflow-hidden rounded-xl border md:grid-cols-[minmax(220px,36%)_1fr] ${t.card}`}
    >
      <div className="flex flex-col justify-between gap-5 px-5 py-5">
        <div>
          {views.length > 1 ? (
            <div
              role="tablist"
              aria-label="Money views"
              className="mb-4 inline-flex flex-wrap gap-1 rounded-full border border-line bg-paper p-0.5"
            >
              {views.map((v) => {
                const selected = v.key === view.key;
                return (
                  <button
                    key={v.key}
                    type="button"
                    role="tab"
                    id={`money-tab-${v.key}`}
                    aria-selected={selected}
                    aria-controls="money-panel"
                    onClick={() => {
                      setActiveKey(v.key);
                      setUserPaused(true);
                    }}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      selected ? "bg-ink text-paper" : "text-mute hover:text-ink"
                    }`}
                  >
                    {v.tab}
                  </button>
                );
              })}
              {!reducedMotion ? (
                <button
                  type="button"
                  onClick={() => setUserPaused((p) => !p)}
                  aria-label={userPaused ? "Resume automatic rotation" : "Pause automatic rotation"}
                  title={userPaused ? "Resume" : "Pause"}
                  className="ml-1 flex h-6 w-6 items-center justify-center rounded-full text-mute hover:text-ink"
                >
                  {userPaused ? <Play size={11} strokeWidth={2} aria-hidden="true" /> : <Pause size={11} strokeWidth={2} aria-hidden="true" />}
                </button>
              ) : null}
            </div>
          ) : null}
          <Stack views={views} activeKey={view.key} animated={animated}>
            {(v) => (
              <>
                <h2 className={`text-[16px] font-bold tracking-tight ${TONES[v.tone].heading}`}>{v.heading}</h2>
                <p className={`mt-1 text-[12px] leading-relaxed ${TONES[v.tone].heading} opacity-85`}>{v.line}</p>
              </>
            )}
          </Stack>
        </div>
        <Stack views={views} activeKey={view.key} animated={animated}>
          {(v) => (
            <>
              <div className={`figures text-[22px] ${v.figureTone}`}>{v.figure}</div>
              <p className={`text-[11px] ${TONES[v.tone].heading} opacity-85`}>{v.figureCaption}</p>
            </>
          )}
        </Stack>
        <Stack views={views} activeKey={view.key} animated={animated}>
          {(v) => (
            <Link
              href={v.button.href}
              className="block w-fit rounded-full border border-line-strong bg-paper px-3.5 py-1.5 text-[12px] font-medium text-ink hover:bg-fill"
            >
              {v.button.label}
            </Link>
          )}
        </Stack>
      </div>
      <div
        id="money-panel"
        role="tabpanel"
        aria-labelledby={`money-tab-${view.key}`}
        aria-live={rotating ? "off" : "polite"}
        className="border-t border-line bg-paper px-4 py-4 md:border-l md:border-t-0"
      >
        <Stack views={views} activeKey={view.key} animated={animated}>
          {(v) => v.chart}
        </Stack>
      </div>
      {rotating ? (
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-line/60">
          <div
            key={view.key}
            className="h-full origin-left bg-ink/50"
            style={{
              animation: `money-rotate ${ROTATE_MS}ms linear forwards`,
              animationPlayState: holding ? "paused" : "running",
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
