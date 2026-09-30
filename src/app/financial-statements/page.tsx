import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, Stat, money } from "@/components/ui";
import { statementHref, type PeriodBounds, type PeriodGrain, type ViewMode } from "./periods";
import { loadStatement, type AccountLine } from "./data";

export const dynamic = "force-dynamic";

function pillClass(active: boolean): string {
  return active
    ? "rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
    : "rounded-full border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill";
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
        <h1 className="text-[20px] font-black tracking-tight text-ink">
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
        title={bounds ? bounds.label : "No period available"}
        hint={
          view === "total"
            ? "Income and expenses posted to the ledger in this period."
            : "Expenses posted to the ledger in this period, largest first."
        }
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Link
              href={statementHref("/financial-statements", view, period, offset + 1)}
              aria-disabled={!canGoOlder}
              className={`rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill ${
                canGoOlder ? "" : "pointer-events-none opacity-40"
              }`}
            >
              ← Earlier
            </Link>
            <Link
              href={statementHref("/financial-statements", view, period, Math.max(0, offset - 1))}
              aria-disabled={!canGoNewer}
              className={`rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill ${
                canGoNewer ? "" : "pointer-events-none opacity-40"
              }`}
            >
              Later →
            </Link>
          </div>
          {rows.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              <a
                href={excelHref}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
              >
                Export to Excel
              </a>
              <a
                href={pdfHref}
                className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
              >
                Download PDF
              </a>
              {emailHref ? (
                <a
                  href={emailHref}
                  className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
                >
                  Draft email
                </a>
              ) : null}
            </div>
          ) : null}
        </div>

        {rows.length > 0 ? (
          <p className="mb-4 text-[12px] text-mute-soft">
            A mailto: link can&rsquo;t carry an attachment — download the PDF above, then attach it
            to the drafted email yourself before sending.
          </p>
        ) : null}

        {!bounds ? (
          <Empty>No fiscal year is set up yet.</Empty>
        ) : rows.length === 0 ? (
          <Empty>No posted activity in this period.</Empty>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              {view === "total" ? (
                <>
                  <Stat label="Income" value={money(totalIncome)} />
                  <Stat label="Expenses" value={money(totalExpenses)} />
                  <Stat
                    label="Net income"
                    value={money(netIncome)}
                    tone={netIncome < 0 ? "bad" : "good"}
                  />
                </>
              ) : (
                <Stat label="Total expenses" value={money(totalExpenses)} />
              )}
            </div>

            {view === "total" ? (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Code</th>
                      <th className="pb-2 font-medium">Account</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr>
                      <td colSpan={3} className="pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-mute">
                        Income
                      </td>
                    </tr>
                    {incomeRows.map((r) => (
                      <tr key={r.account_id}>
                        <td className="figures py-2 font-mono text-[11px] text-mute-soft">{r.code}</td>
                        <td className="py-2 text-ink">{r.account_name}</td>
                        <td className="figures py-2 text-right text-ink">{money(r.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td colSpan={2} className="py-2 font-medium text-ink">Total income</td>
                      <td className="figures py-2 text-right font-medium text-ink">{money(totalIncome)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="pt-4 pb-1 text-[11px] font-medium uppercase tracking-wide text-mute">
                        Expenses
                      </td>
                    </tr>
                    {expenseRows.map((r) => (
                      <tr key={r.account_id}>
                        <td className="figures py-2 font-mono text-[11px] text-mute-soft">{r.code}</td>
                        <td className="py-2 text-ink">{r.account_name}</td>
                        <td className="figures py-2 text-right text-ink">{money(r.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td colSpan={2} className="py-2 font-medium text-ink">Total expenses</td>
                      <td className="figures py-2 text-right font-medium text-ink">{money(totalExpenses)}</td>
                    </tr>
                    <tr className="border-t-2 border-line-strong">
                      <td colSpan={2} className="py-2 font-semibold text-ink">Net income</td>
                      <td className="figures py-2 text-right font-semibold text-ink">{money(netIncome)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-mute">
                      <th className="pb-2 font-medium">Code</th>
                      <th className="pb-2 font-medium">Account</th>
                      <th className="pb-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {expenseRows.map((r) => (
                      <tr key={r.account_id}>
                        <td className="figures py-2 font-mono text-[11px] text-mute-soft">{r.code}</td>
                        <td className="py-2 text-ink">{r.account_name}</td>
                        <td className="figures py-2 text-right text-ink">{money(r.amount)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line">
                      <td colSpan={2} className="py-2 font-medium text-ink">Total expenses</td>
                      <td className="figures py-2 text-right font-medium text-ink">{money(totalExpenses)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
