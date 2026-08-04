import Link from "next/link";
import { formatMoney } from "@/lib/tax/form1120h";
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

function ShowcaseCard({
  tone,
  heading,
  line,
  figure,
  figureTone = "text-ink",
  figureCaption,
  button,
  children,
}: {
  tone: keyof typeof TONES;
  heading: string;
  line: string;
  figure: string;
  figureTone?: string;
  figureCaption: string;
  button: { label: string; href: string };
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  return (
    <section
      className={`grid overflow-hidden rounded-xl border md:grid-cols-[minmax(220px,36%)_1fr] ${t.card}`}
    >
      <div className="flex flex-col justify-between gap-5 px-5 py-5">
        <div>
          <h2 className={`text-[16px] font-semibold tracking-tight ${t.heading}`}>{heading}</h2>
          <p className={`mt-1 text-[12px] leading-relaxed ${t.heading} opacity-85`}>{line}</p>
        </div>
        <div>
          <div className={`figures text-[22px] ${figureTone}`}>{figure}</div>
          <p className={`text-[11px] ${t.heading} opacity-85`}>{figureCaption}</p>
        </div>
        <Link
          href={button.href}
          className="w-fit rounded-full border border-line-strong bg-paper px-3.5 py-1.5 text-[12px] font-medium text-ink hover:bg-fill"
        >
          {button.label}
        </Link>
      </div>
      <div className="border-t border-line bg-paper px-4 py-4 md:border-l md:border-t-0">
        {children}
      </div>
    </section>
  );
}

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

export function ShowcaseCards({
  cash,
  inOut,
  spending,
}: {
  cash: CashCardData | null;
  inOut: InOutCardData | null;
  spending: SpendingCardData | null;
}) {
  return (
    <div className="space-y-4">
      {cash && cash.points.length > 0 ? (
        <ShowcaseCard
          tone="good"
          heading="Money in the bank"
          line="Every account together, month by month."
          figure={`${cash.netChangeCents >= 0 ? "+" : "−"}${formatMoney(Math.abs(cash.netChangeCents))}`}
          figureTone={cash.netChangeCents >= 0 ? "text-good-text" : "text-bad-text"}
          figureCaption={`net change ${cash.sinceLabel.replace(/^Since/, "since")}`}
          button={{ label: "See every transaction", href: "/ledger" }}
        >
          <LineChart
            points={cash.points}
            ariaLabel={`Cash balance ${cash.sinceLabel.toLowerCase()}, ending at ${formatMoney(
              cash.points[cash.points.length - 1].valueCents,
            )}, a net change of ${formatMoney(cash.netChangeCents)}.`}
          />
          <p className="mt-1 text-right text-[10px] text-mute-soft">{cash.sinceLabel}</p>
        </ShowcaseCard>
      ) : null}

      {inOut && inOut.groups.length > 0 ? (
        <ShowcaseCard
          tone="info"
          heading="In and out, month by month"
          line="What came in against what went out."
          figure={
            inOut.varianceCents === null
              ? "—"
              : `${inOut.varianceCents > 0 ? "+" : inOut.varianceCents < 0 ? "−" : ""}${formatMoney(Math.abs(inOut.varianceCents))}`
          }
          figureTone={
            inOut.varianceCents === null
              ? "text-ink"
              : inOut.varianceCents > 0
                ? "text-bad-text"
                : "text-good-text"
          }
          figureCaption={
            inOut.varianceCents === null
              ? `no budget set for ${inOut.fiscalYearLabel} yet`
              : `spending against budget, ${inOut.fiscalYearLabel} to date`
          }
          button={{ label: "Open the budget", href: "/budget" }}
        >
          <BarChart
            groups={inOut.groups}
            seriesALabel="came in"
            seriesBLabel="went out"
            ariaLabel={`Monthly money in and out over the last ${inOut.groups.length} months.`}
          />
        </ShowcaseCard>
      ) : null}

      {spending && spending.slices.length > 0 ? (
        <ShowcaseCard
          tone="warning"
          heading="Where the money went"
          line="Spending grouped by account, the same way the ledger sees it."
          figure={formatMoney(spending.avgMonthlyCents)}
          figureCaption={`average monthly spend ${spending.sinceLabel.replace(/^Since/, "since")}`}
          button={{ label: "See all spending", href: "/ledger" }}
        >
          <DonutChart
            slices={spending.slices}
            ariaLabel={`Spending by category ${spending.sinceLabel.toLowerCase()}, averaging ${formatMoney(
              spending.avgMonthlyCents,
            )} a month.`}
          />
        </ShowcaseCard>
      ) : null}
    </div>
  );
}
