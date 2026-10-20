import { formatMoney } from "@/lib/tax/form1120h";
import type { BillTotals } from "@/lib/upkeep/bill-totals";

const SERIES = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The categories as slices with shares, the tail beyond six grouped into "Other". */
function shares(totals: BillTotals): { label: string; pct: number }[] {
  const total = totals.byCategory.reduce((s, c) => s + c.valueCents, 0);
  if (total <= 0) return [];
  const shown = totals.byCategory.slice(0, 5);
  const rest = totals.byCategory.slice(5).reduce((s, c) => s + c.valueCents, 0);
  const all = rest > 0 ? [...shown, { label: "Other", valueCents: rest }] : shown;
  return all.map((c) => ({ label: c.label, pct: (c.valueCents / total) * 100 }));
}

/** A donut of the categories, named in a legend beside it with their share. No dollar figures on the chart. */
function CategoryDonut({ totals, ariaLabel }: { totals: BillTotals; ariaLabel: string }) {
  const rows = shares(totals);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-[12px] text-mute">Nothing to chart yet. Give a bill a usual amount and its category shows here.</p>;
  }
  const R = 15.9155; // circumference 100, so dash lengths are percentages
  const GAP = rows.length > 1 ? 0.9 : 0;
  // Each slice starts where the one before it ends; 12 o'clock is offset 25.
  const arcs = rows.map((r, i) => {
    const before = rows.slice(0, i).reduce((t, x) => t + x.pct, 0);
    return { ...r, dash: Math.max(0.2, r.pct - GAP), offset: 25 - before - GAP / 2, color: SERIES[i % SERIES.length] };
  });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg viewBox="0 0 42 42" className="h-28 w-28 shrink-0" role="img" aria-label={ariaLabel}>
        {arcs.map((a) => (
          <circle key={a.label} cx="21" cy="21" r={R} fill="transparent" stroke={a.color} strokeWidth="6" strokeDasharray={`${a.dash} ${100 - a.dash}`} strokeDashoffset={a.offset} />
        ))}
        <text x="21" y="20.2" textAnchor="middle" className="figures" fontSize="5.2" fill="var(--color-ink)">
          {rows.length}
        </text>
        <text x="21" y="25" textAnchor="middle" fontSize="2.8" fill="var(--color-mute)">
          {rows.length === 1 ? "category" : "categories"}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="inline-flex min-w-0 items-center gap-2 text-ink">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: a.color }} />
              <span className="truncate">{a.label}</span>
            </span>
            <span className="figures shrink-0 text-mute">{Math.round(a.pct)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PeriodCard({ title, totals, whenWord, chartLabel }: { title: string; totals: BillTotals; whenWord: string; chartLabel: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper">
      <div className="band flex h-9 items-center bg-ink px-4 text-[11px] font-semibold uppercase tracking-wide text-paper">
        <span className="truncate">{title}</span>
      </div>
      <div className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] md:items-center">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-mute">Expected bills</p>
          <div className="figures text-[24px] leading-tight text-ink">{formatMoney(totals.totalCents)}</div>
          <p className="mt-0.5 text-[11px] leading-snug text-mute">
            {totals.payments === 0
              ? `No regular bills fall due ${whenWord}.`
              : `${plural(totals.payments, "payment")} due ${whenWord}, from the usual amounts.${
                  totals.withoutAmount > 0 ? ` ${plural(totals.withoutAmount, "has", "have")} no amount set, so the total is a little low.` : ""
                }`}
          </p>
        </div>
        <CategoryDonut totals={totals} ariaLabel={chartLabel} />
      </div>
    </div>
  );
}

/**
 * The top of the Bills tab: two larger cards, this month and this year. Each
 * has what is expected from the bills' own schedules and a donut of the
 * categories it goes to.
 */
export function BillMetrics({ month, year, monthLabel }: { month: BillTotals; year: BillTotals; monthLabel: string }) {
  const yearLabel = monthLabel.split(" ").pop();
  return (
    <section aria-label="Expected bills" className="grid gap-3 xl:grid-cols-2">
      <PeriodCard title={`This month, ${monthLabel}`} totals={month} whenWord="this month" chartLabel={`Bills expected in ${monthLabel} by category.`} />
      <PeriodCard title={`This year, ${yearLabel}`} totals={year} whenWord="this year" chartLabel={`Bills expected in ${yearLabel} by category.`} />
    </section>
  );
}
