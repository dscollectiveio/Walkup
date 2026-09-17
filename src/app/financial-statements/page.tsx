import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted, Stat, money } from "@/components/ui";
import { fiscalYearBounds, monthBounds, quarterBounds, type PeriodBounds, type PeriodGrain, type ViewMode } from "./periods";

export const dynamic = "force-dynamic";

interface AccountLine {
  account_id: string;
  code: string;
  account_name: string;
  account_type: "income" | "expense";
  amount: number;
}

function pillClass(active: boolean): string {
  return active
    ? "rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-paper"
    : "rounded-full border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill";
}

function hrefFor(view: ViewMode, period: PeriodGrain, offset: number): string {
  const params = new URLSearchParams();
  if (view !== "total") params.set("view", view);
  if (period !== "monthly") params.set("period", period);
  if (offset !== 0) params.set("offset", String(offset));
  const qs = params.toString();
  return `/financial-statements${qs ? `?${qs}` : ""}`;
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
  const lines: string[] = [`${associationName}`, `${title} — ${bounds.label}`, ""];

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

  const { data: associations } = await supabase
    .from("associations")
    .select("id, display_name")
    .limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="financial statements" />;

  const { data: canReadFinancialsRes } = await supabase.rpc("can_read_financials", {
    assoc: association.id,
  });
  if (canReadFinancialsRes !== true) return <Restricted what="financial statements" />;

  let bounds: PeriodBounds | null;
  let fiscalYearCount = 0;
  if (period === "annual") {
    const { data: fiscalYears } = await supabase
      .from("fiscal_years")
      .select("label, starts_on, ends_on")
      .order("starts_on", { ascending: false });
    fiscalYearCount = fiscalYears?.length ?? 0;
    bounds = fiscalYearBounds(fiscalYears ?? [], offset);
  } else if (period === "quarterly") {
    bounds = quarterBounds(offset);
  } else {
    bounds = monthBounds(offset);
  }

  const { data: lineRows } = bounds
    ? await supabase
        .from("income_statement_lines")
        .select("account_id, code, account_name, account_type, amount")
        .eq("association_id", association.id)
        .gte("entry_date", bounds.start)
        .lte("entry_date", bounds.end)
    : { data: [] };

  const byAccount = new Map<string, AccountLine>();
  for (const l of lineRows ?? []) {
    const existing = byAccount.get(l.account_id);
    const amount = Number(l.amount);
    if (existing) existing.amount += amount;
    else
      byAccount.set(l.account_id, {
        account_id: l.account_id,
        code: l.code,
        account_name: l.account_name,
        account_type: l.account_type as "income" | "expense",
        amount,
      });
  }
  const rows = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  const incomeRows = rows.filter((r) => r.account_type === "income");
  const expenseRows = rows
    .filter((r) => r.account_type === "expense")
    .sort((a, b) => (view === "expenses" ? b.amount - a.amount : a.code.localeCompare(b.code)));
  const totalIncome = incomeRows.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenseRows.reduce((s, r) => s + r.amount, 0);
  const netIncome = totalIncome - totalExpenses;

  const canGoNewer = offset > 0;
  const canGoOlder = period !== "annual" || offset + 1 < fiscalYearCount;

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-tight text-ink">
          Financial Statements
        </h1>
        <p className="mt-1 text-mute">
          Built from the posted ledger — the same numbers as your tax filing and budget pages.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={hrefFor(view, "monthly", 0)} className={pillClass(period === "monthly")}>
            Monthly
          </Link>
          <Link href={hrefFor(view, "quarterly", 0)} className={pillClass(period === "quarterly")}>
            Quarterly
          </Link>
          <Link href={hrefFor(view, "annual", 0)} className={pillClass(period === "annual")}>
            Annual
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={hrefFor("total", period, offset)} className={pillClass(view === "total")}>
            Total P&amp;L
          </Link>
          <Link
            href={hrefFor("expenses", period, offset)}
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
              href={hrefFor(view, period, offset + 1)}
              aria-disabled={!canGoOlder}
              className={`rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill ${
                canGoOlder ? "" : "pointer-events-none opacity-40"
              }`}
            >
              ← Earlier
            </Link>
            <Link
              href={hrefFor(view, period, Math.max(0, offset - 1))}
              aria-disabled={!canGoNewer}
              className={`rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill ${
                canGoNewer ? "" : "pointer-events-none opacity-40"
              }`}
            >
              Later →
            </Link>
          </div>
          {emailHref && rows.length > 0 ? (
            <a
              href={emailHref}
              className="rounded-md border border-line-strong px-3 py-1.5 text-[12px] text-ink hover:bg-fill"
            >
              Draft email
            </a>
          ) : null}
        </div>

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
