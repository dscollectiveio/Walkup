import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { dateRangeLabel, todayIso } from "@/lib/dates";
import { mergeRows } from "./summary";
import { viewQuery, rangeSpan, type PickerState, type StatementView } from "./range";
import { PeriodPicker } from "./period-picker";
import { ReportActions } from "./report-actions";
import { MultiStatementTable } from "./multi-table";
import { buildReport, loadView } from "./report";
import { statementHref, type FiscalYear } from "./periods";

/**
 * More than one period on screen: a month per column with a Total, one combined
 * column for a long range, or Period 1 | Period 2 | Difference when comparing.
 * Same loader as the single view, so every figure here is the figure that period
 * shows on its own. Budget, "where the money sits" and the year-end package stay
 * on the single-period view.
 */
export async function MultiPeriodView({
  view,
  fiscalYears,
  state,
}: {
  view: StatementView;
  fiscalYears: FiscalYear[];
  /** What the picker opens with. */
  state: PickerState;
}) {
  const supabase = await createClient();
  const loaded = await loadView(supabase, view);
  if (loaded === "restricted") return <Restricted what="financial statements" />;
  const { statements: periods, compare, blank } = loaded;
  if (periods.length === 0) return <Restricted what="financial statements" />;

  const today = todayIso();
  const labels = periods.map((p) => p.bounds!.label);
  const first = labels[0];
  const last = labels[labels.length - 1];
  const selectionLabel =
    view.kind === "compare"
      ? `${labels[0]} vs. ${labels[1]}`
      : view.kind === "combined"
        ? rangeSpan(view.range)
        : periods.length === 1
          ? first
          : `${first} – ${last}`;
  const income = mergeRows(periods.map((p) => ({ rows: p.incomeRows })));
  const expenses = mergeRows(periods.map((p) => ({ rows: p.expenseRows })));
  const totalIncome = periods.map((p) => p.totalIncome);
  const totalExpenses = periods.map((p) => p.totalExpenses);
  const net = periods.map((p) => p.netIncome);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const unposted = sum(periods.map((p) => p.unpostedCount));
  const hasActivity = income.length + expenses.length > 0;
  const report = buildReport(periods, { compare, blank });
  const query = viewQuery(view);
  const cardHint =
    view.kind === "compare"
      ? `From posted transactions · ${dateRangeLabel(periods[0].bounds!.start, periods[0].bounds!.end)} vs. ${dateRangeLabel(periods[1].bounds!.start, periods[1].bounds!.end)}`
      : `From posted transactions · ${dateRangeLabel(periods[0].bounds!.start, periods[periods.length - 1].bounds!.end)}`;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Financial Statements</h1>
        <p className="mt-1 text-mute">
          Built from bank transactions that have been posted to the books: the same numbers as your tax filing
          and budget pages.
        </p>
      </div>

      {unposted > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          {unposted} bank transaction{unposted === 1 ? "" : "s"} in these periods haven&rsquo;t been posted to the
          books yet: the figures below leave {unposted === 1 ? "it" : "them"} out.{" "}
          <Link href="/bank-feed?status=needs" className="underline underline-offset-2">
            Categorize on the bank feed →
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker state={state} fiscalYears={fiscalYears} today={today} />
        {report ? (
          <ReportActions
            report={report}
            pdfHref={statementHref("/financial-statements/export/pdf", "total", "monthly", 0, query)}
            excelHref={statementHref("/financial-statements/export", "total", "monthly", 0, query)}
          />
        ) : null}
      </div>

      <Card navy title={selectionLabel} hint={cardHint}>
        {!hasActivity ? (
          <Empty>No posted activity in {view.kind === "combined" ? "this period" : "these periods"}.</Empty>
        ) : (
          <MultiStatementTable
            labels={labels}
            income={income}
            expenses={expenses}
            totalIncome={totalIncome}
            totalExpenses={totalExpenses}
            net={net}
            entries={periods.map((p) => p.entriesByAccount)}
            today={today}
            compare={compare}
            blank={blank}
          />
        )}
      </Card>
    </div>
  );
}
