import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, money } from "@/components/ui";
import { statementHref, type PeriodBounds, type PeriodGrain, type ViewMode } from "./periods";
import { loadStatement, type AccountLine } from "./data";

export const dynamic = "force-dynamic";

function pillClass(active: boolean): string {
  return active
    ? "rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
    : "rounded-full border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill";
}

const navBtn =
  "rounded-md border border-ondark-mute/50 px-3 py-1.5 text-[12px] font-medium text-paper transition-colors hover:bg-ink-mid";
const toolBtn =
  "rounded-md border border-line-strong bg-paper px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-fill";

/** One block of the statement: a labelled band, its accounts with a share bar, then the total. */
function Section({
  label,
  rows,
  total,
  totalLabel,
  tone,
}: {
  label: string;
  rows: AccountLine[];
  total: number;
  totalLabel: string;
  tone: "income" | "expense";
}) {
  const bar = tone === "income" ? "bg-moss" : "bg-brass";
  return (
    <>
      <tr>
        <td colSpan={3} className="bg-fill/60 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.07em] text-section-label">
          {label}
        </td>
      </tr>
      {rows.map((r) => {
        const share = total > 0 ? Math.max(0, Math.min(100, (r.amount / total) * 100)) : 0;
        return (
          <tr key={r.account_id} className="border-b border-line/70">
            <td className="py-2.5 pl-3 pr-3">
              <span className="text-ink">{r.account_name}</span>
              <span className="figures ml-2 text-[11px] text-mute-soft">{r.code}</span>
            </td>
            <td className="hidden w-44 py-2.5 pr-4 sm:table-cell">
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${share}%` }} />
                </div>
                <span className="figures w-9 text-right text-[11px] text-mute">{Math.round(share)}%</span>
              </div>
            </td>
            <td className="figures w-28 py-2.5 pr-3 text-right text-ink">{money(r.amount)}</td>
          </tr>
        );
      })}
      <tr>
        <td className="py-2.5 pl-3 font-semibold text-ink">{totalLabel}</td>
        <td className="hidden sm:table-cell" />
        <td className="figures py-2.5 pr-3 text-right font-semibold text-ink">{money(total)}</td>
      </tr>
    </>
  );
}

function buildEmailDraft(
  associationName: string,
  view: ViewMode,
  bounds: PeriodBounds,
  incomeRows: AccountLine[],
  expenseRows: AccountLine[],
  totalIncome: number,
  totalExpenses: number,
): string {
  const title = view === "total" ? "Profit & Loss" : "Expenses";
  const subject = `${associationName} — ${title} — ${bounds.label}`;
  const lines: string[] = [
    `${associationName}`,
    `${title} — ${bounds.label}`,
    "",
    "A PDF of this statement is attached — download it from the Financial Statements page and attach it here before sending.",
    "",
  ];

  if (view === "total") {
    lines.push("Income");
    for (const r of incomeRows) lines.push(`  ${r.code}  ${r.account_name}: ${money(r.amount)}`);
    lines.push(`  Total income: ${money(totalIncome)}`, "");
    lines.push("Expenses");
    for (const r of expenseRows) lines.push(`  ${r.code}  ${r.account_name}: ${money(r.amount)}`);
    lines.push(`  Total expenses: ${money(totalExpenses)}`, "");
    lines.push(`Net income: ${money(totalIncome - totalExpenses)}`);
  } else {
    lines.push("Expenses");
    for (const r of expenseRows) lines.push(`  ${r.code}  ${r.account_name}: ${money(r.amount)}`);
    lines.push(`  Total expenses: ${money(totalExpenses)}`);
  }

  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export default async function FinancialStatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; period?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const view: ViewMode = sp.view === "expenses" ? "expenses" : "total";
  const period: PeriodGrain =
    sp.period === "quarterly" ? "quarterly" : sp.period === "annual" ? "annual" : "monthly";
  const offset = Math.max(0, Math.trunc(Number(sp.offset ?? 0)) || 0);

  const supabase = await createClient();
  const statement = await loadStatement(supabase, view, period, offset);
  if ("restricted" in statement) return <Restricted what="financial statements" />;

  const {
    association,
    bounds,
    incomeRows,
    expenseRows,
    totalIncome,
    totalExpenses,
    netIncome,
    unpostedCount,
    canGoNewer,
    canGoOlder,
  } = statement;
  const rows = [...incomeRows, ...expenseRows];

  const emailHref = bounds
    ? buildEmailDraft(
        association.display_name,
        view,
        bounds,
        incomeRows,
        expenseRows,
        totalIncome,
        totalExpenses,
      )
    : null;
  const excelHref = statementHref("/financial-statements/export", view, period, offset);
  const pdfHref = statementHref("/financial-statements/export/pdf", view, period, offset);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">
          Financial Statements
        </h1>
        <p className="mt-1 text-mute">
          Built from bank transactions that have been posted to the books — the same numbers as
          your tax filing and budget pages.
        </p>
      </div>

      {unpostedCount > 0 ? (
        <p className="border-l-[3px] border-warning bg-warning-tint px-3 py-2 text-[13px] text-warning-text">
          {unpostedCount} bank transaction{unpostedCount === 1 ? "" : "s"} in this period{" "}
          {unpostedCount === 1 ? "hasn't" : "haven't"} been posted to the books yet — the figures
          below leave {unpostedCount === 1 ? "it" : "them"} out.{" "}
          <Link href="/bank-feed?status=needs" className="underline underline-offset-2">
            Categorize on the bank feed →
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={statementHref("/financial-statements", view, "monthly", 0)} className={pillClass(period === "monthly")}>
            Monthly
          </Link>
          <Link href={statementHref("/financial-statements", view, "quarterly", 0)} className={pillClass(period === "quarterly")}>
            Quarterly
          </Link>
          <Link href={statementHref("/financial-statements", view, "annual", 0)} className={pillClass(period === "annual")}>
            Annual
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={statementHref("/financial-statements", "total", period, offset)} className={pillClass(view === "total")}>
            Total P&amp;L
          </Link>
          <Link
            href={statementHref("/financial-statements", "expenses", period, offset)}
            className={pillClass(view === "expenses")}
          >
            Expenses
          </Link>
        </div>
      </div>

      <Card
        navy
        title={bounds ? bounds.label : "No period available"}
        hint={
          view === "total"
            ? "Income and expenses posted to the ledger in this period."
            : "Expenses posted to the ledger in this period, largest first."
        }
        action={
          <div className="flex gap-1.5">
            <Link
              href={statementHref("/financial-statements", view, period, offset + 1)}
              aria-disabled={!canGoOlder}
              className={`${navBtn} ${canGoOlder ? "" : "pointer-events-none opacity-40"}`}
            >
              ← Earlier
            </Link>
            <Link
              href={statementHref("/financial-statements", view, period, Math.max(0, offset - 1))}
              aria-disabled={!canGoNewer}
              className={`${navBtn} ${canGoNewer ? "" : "pointer-events-none opacity-40"}`}
            >
              Later →
            </Link>
          </div>
        }
      >
        {rows.length > 0 ? (
          <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
            <a href={excelHref} className={toolBtn}>
              Export to Excel
            </a>
            <a href={pdfHref} className={toolBtn}>
              Download PDF
            </a>
            {emailHref ? (
              <a
                href={emailHref}
                title="A mailto: link can’t carry an attachment — download the PDF, then attach it to the drafted email yourself."
                className={toolBtn}
              >
                Draft email
              </a>
            ) : null}
          </div>
        ) : null}

        {!bounds ? (
          <Empty>No fiscal year is set up yet.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No posted activity in this period.</Empty>
        ) : (
          <>
            <dl
              className={`grid divide-y divide-line overflow-hidden rounded-lg border border-line sm:divide-x sm:divide-y-0 ${
                view === "total" ? "sm:grid-cols-3" : "sm:grid-cols-1"
              }`}
            >
              {view === "total" ? (
                <>
                  <div className="px-5 py-4">
                    <dt className="text-[12px] text-mute">Income</dt>
                    <dd className="figures mt-1 text-[22px] text-ink">{money(totalIncome)}</dd>
                  </div>
                  <div className="px-5 py-4">
                    <dt className="text-[12px] text-mute">Expenses</dt>
                    <dd className="figures mt-1 text-[22px] text-ink">{money(totalExpenses)}</dd>
                  </div>
                  <div className={`px-5 py-4 ${netIncome < 0 ? "bg-bad-tint" : "bg-good-tint"}`}>
                    <dt className={`text-[12px] ${netIncome < 0 ? "text-bad-text" : "text-good-text"}`}>Net income</dt>
                    <dd className={`figures mt-1 text-[22px] ${netIncome < 0 ? "text-bad-text" : "text-good-text"}`}>
                      {money(netIncome)}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="px-5 py-4">
                  <dt className="text-[12px] text-mute">Total expenses</dt>
                  <dd className="figures mt-1 text-[22px] text-ink">{money(totalExpenses)}</dd>
                </div>
              )}
            </dl>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-[13px]">
                <tbody>
                  {view === "total" ? (
                    <>
                      <Section label="Income" rows={incomeRows} total={totalIncome} totalLabel="Total income" tone="income" />
                      <Section label="Expenses" rows={expenseRows} total={totalExpenses} totalLabel="Total expenses" tone="expense" />
                      <tr className="border-t-2 border-ink">
                        <td className="pt-3 text-[14px] font-bold text-ink">Net income</td>
                        <td className="hidden sm:table-cell" />
                        <td
                          className={`figures pt-3 text-right text-[14px] font-bold ${
                            netIncome < 0 ? "text-bad-text" : "text-good-text"
                          }`}
                        >
                          {money(netIncome)}
                        </td>
                      </tr>
                    </>
                  ) : (
                    <Section label="Expenses" rows={expenseRows} total={totalExpenses} totalLabel="Total expenses" tone="expense" />
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
