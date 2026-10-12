import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { todayIso } from "@/lib/dates";
import { loadStatement, type Statement } from "./data";
import { mergeRows, type PeriodSelection } from "./summary";
import { PeriodPicker } from "./period-picker";
import { ReportActions } from "./report-actions";
import { buildReport } from "./report";
import { statementHref, type FiscalYear } from "./periods";

const NOUN = { monthly: "months", quarterly: "quarters", annual: "years" } as const;

/**
 * Two or more periods chosen: each one is a column, with a Total at the end.
 * Same loader as the single view, run once per period, so every figure here
 * is the figure that period shows on its own. Budget, entry drill-down,
 * "where the money sits" and exports stay on the single-period view.
 */
export async function MultiPeriodView({
  selection,
  sort,
  fiscalYears,
}: {
  selection: PeriodSelection;
  sort: "account" | "size";
  fiscalYears: FiscalYear[];
}) {
  const supabase = await createClient();
  const loaded = await Promise.all(
    selection.items.map((it) => loadStatement(supabase, "total", selection.grain, it.offset)),
  );
  if (loaded.some((l) => "restricted" in l)) return <Restricted what="financial statements" />;
  const periods = (loaded as Statement[]).filter((l) => l.bounds !== null);
  if (periods.length === 0) return <Restricted what="financial statements" />;

  const today = todayIso();
  const labels = periods.map((p) => p.bounds!.label);
  const first = labels[0];
  const last = labels[labels.length - 1];
  const selectionLabel =
    periods.length === 1 ? first : `${first} – ${last}`;
  const income = mergeRows(periods.map((p) => ({ rows: p.incomeRows })), "account");
  const expenses = mergeRows(periods.map((p) => ({ rows: p.expenseRows })), sort);
  const totalIncome = periods.map((p) => p.totalIncome);
  const totalExpenses = periods.map((p) => p.totalExpenses);
  const net = periods.map((p) => p.netIncome);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const incomeAll = sum(totalIncome);
  const expensesAll = sum(totalExpenses);
  const netAll = incomeAll - expensesAll;
  const unposted = sum(periods.map((p) => p.unpostedCount));
  const hasActivity = income.length + expenses.length > 0;
  const report = buildReport(periods);
  const selectedKeys = selection.items.map((i) => i.key);
  const cell = "figures whitespace-nowrap px-3 py-2.5 text-right text-ink";
  const head = "whitespace-nowrap px-3 pb-2 text-right text-[12px] font-medium text-mute";
  const band = "bg-fill/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-section-label";

  const section = (label: string, rows: ReturnType<typeof mergeRows>, totals: number[], totalLabel: string, action?: React.ReactNode) => (
    <>
      <tr>
        <td colSpan={periods.length + 2} className={band}>
          <span className="flex items-center justify-between">
            <span>{label}</span>
            {action}
          </span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.account_id} className="border-b border-line/70">
          <td className="px-3 py-2.5 text-ink">
            {r.account_name}
          </td>
          {r.amounts.map((a, i) => (
            <td key={i} className={`${cell} ${a === 0 ? "text-mute-soft" : ""}`}>
              {a === 0 ? "—" : money(a)}
            </td>
          ))}
          <td className={`${cell} font-medium`}>{money(r.total)}</td>
        </tr>
      ))}
      <tr>
        <td className="px-3 py-2.5 font-semibold text-ink">{totalLabel}</td>
        {totals.map((t, i) => (
          <td key={i} className={`${cell} font-semibold`}>
            {money(t)}
          </td>
        ))}
        <td className={`${cell} font-semibold`}>{money(sum(totals))}</td>
      </tr>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Financial Statements</h1>
        <p className="mt-1 text-mute">
          Built from bank transactions that have been posted to the books — the same numbers as your tax filing
          and budget pages.
        </p>
      </div>

      {unposted > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          {unposted} bank transaction{unposted === 1 ? "" : "s"} in these periods haven&rsquo;t been posted to the
          books yet — the figures below leave {unposted === 1 ? "it" : "them"} out.{" "}
          <Link href="/bank-feed?status=needs" className="underline underline-offset-2">
            Categorize on the bank feed →
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker
          label={selectionLabel}
          grain={selection.grain}
          selectedKeys={selectedKeys}
          fiscalYears={fiscalYears}
          today={today}
          sort={sort}
        />
        {report ? (
          <ReportActions
            report={report}
            pdfHref={statementHref("/financial-statements/export/pdf", "total", "monthly", 0, { periods: selectedKeys.join(",") })}
          />
        ) : null}
      </div>

      <Card navy title={selectionLabel} hint={`${periods.length} ${NOUN[selection.grain]} · posted to the books`}>
        {!hasActivity ? (
          <Empty>No posted activity in these periods.</Empty>
        ) : (
          <div className="space-y-5">
            <div className="overflow-x-auto rounded-lg border border-line text-[13px]">
              <table className="w-full min-w-[32rem]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-3 pb-2 pt-2.5 text-left text-[12px] font-medium text-mute">Account</th>
                    {labels.map((l) => (
                      <th key={l} className={`${head} pt-2.5`}>
                        {l}
                      </th>
                    ))}
                    <th className={`${head} pt-2.5 text-ink`}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {section("Income", income, totalIncome, "Total income")}
                  {section(
                    "Expenses",
                    expenses,
                    totalExpenses,
                    "Total expenses",
                    <Link
                      href={statementHref("/financial-statements", "total", "monthly", 0, {
                        periods: selectedKeys.join(","),
                        sort: sort === "size" ? undefined : "size",
                      })}
                      className="normal-case tracking-normal text-mute underline-offset-2 hover:text-ink hover:underline"
                    >
                      {sort === "size" ? "Sort by account" : "Sort by size"}
                    </Link>,
                  )}
                  <tr className="border-t-2 border-ink">
                    <td className="px-3 py-3 text-[14px] font-bold text-ink">{netAll < 0 ? "Left over (short)" : "Left over"}</td>
                    {net.map((n, i) => (
                      <td key={i} className={`figures whitespace-nowrap px-3 py-3 text-right text-[14px] font-bold ${n < 0 ? "text-bad-text" : "text-good-text"}`}>
                        {money(n)}
                      </td>
                    ))}
                    <td className={`figures whitespace-nowrap px-3 py-3 text-right text-[14px] font-bold ${netAll < 0 ? "text-bad-text" : "text-good-text"}`}>
                      {money(netAll)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
