import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Answer, Card, Empty, Restricted } from "@/components/ui";
import { formatMoney } from "@/lib/tax/form1120h";
import { SpendingBreakdown } from "@/components/home/charts/spending-breakdown";
import { transfersInByMonth, type CashActivityRow } from "@/lib/money/cash";
import { spendByAccount, type ExpenseActualRow } from "@/lib/money/spending";
import { addMonths, monthKey, monthLongLabel, monthsBetween } from "@/lib/money/months";
import { PERIOD_LABEL, parsePeriod, resolvePeriod, type PeriodKey } from "@/lib/money/period";
import { comparisonSentence, forecastYearEnd, MIN_FORECAST_MONTHS, type BudgetStatus } from "@/lib/money/budget";
import { buildPlanRows, paceShare, planHeadline, suggestAnnualFromSpend, type PlanRow } from "@/lib/money/plan";
import { shortDate, todayIso as todayIsoOf } from "@/lib/dates";
import { BudgetRow } from "./budget-row";
import { AddCategoryForm } from "./add-category-form";
import { SuggestedBudget } from "./suggested-budget";
import { PlannedAmount } from "./planned-amount";

export const dynamic = "force-dynamic";

const looseCents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const dollars = (cents: number) => formatMoney(Math.round(cents / 100) * 100).replace(/\.00$/, "");

const STATUS_STYLE: Record<BudgetStatus | "saved" | "none", { bar: string; text: string; word: string }> = {
  on_track: { bar: "bg-moss", text: "text-good-text", word: "On track" },
  watch: { bar: "bg-warning", text: "text-warning-text", word: "Watch" },
  over: { bar: "bg-bad", text: "text-bad-text", word: "Over budget" },
  saved: { bar: "bg-slate", text: "text-info-text", word: "Saved" },
  none: { bar: "bg-line-strong", text: "text-mute", word: "No plan" },
};

function syncedWords(lastSynced: string | null, now: Date): string {
  if (!lastSynced) return "Bank not synced yet";
  const d = new Date(lastSynced);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Synced today";
  if (days === 1) return "Synced yesterday";
  return `Synced ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface Params {
  period?: string;
  edit?: string;
}

function hrefFor(p: { period: PeriodKey }) {
  return p.period === "year" ? "/budget" : `/budget?period=${p.period}`;
}

/** The transactions behind a category live on the bank feed, filtered to that account. */
const transactionsFor = (accountId: string) => `/bank-feed?account=${accountId}`;

interface RecentEntry {
  entry_date: string;
  memo: string;
  cents: number;
}

/** The bar every row shares: planned = track, spent = fill, pace = thin marker. */
function PlanBar({ spent, target, pace, bar }: { spent: number; target: number; pace: number; bar: string }) {
  const used = target > 0 ? Math.min(100, (spent / target) * 100) : spent > 0 ? 100 : 0;
  return (
    <div className="relative mt-2 h-2.5 rounded-md bg-fill">
      <div className={`h-full rounded-md ${bar}`} style={{ width: `${used}%` }} />
      {target > 0 ? (
        <span
          aria-hidden="true"
          title="Where you'd be if spending were spread evenly"
          className="absolute -bottom-1 -top-1 w-px bg-ink"
          style={{ left: `${Math.round(pace * 100)}%` }}
        />
      ) : null}
    </div>
  );
}

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const editOpen = sp.edit === "1";

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id, display_name").limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="the budget" />;

  const { data: isMemberRes } = await supabase.rpc("is_member", { assoc: association.id });
  if (isMemberRes !== true) return <Restricted what="the budget" />;

  const [{ data: isBoardRes }, { data: canReadFinancialsRes }, { data: fiscalYears }, { data: funds }, { data: accounts }] =
    await Promise.all([
      supabase.rpc("is_board", { assoc: association.id }),
      supabase.rpc("can_read_financials", { assoc: association.id }),
      supabase.from("fiscal_years").select("id, label, starts_on, ends_on").order("starts_on", { ascending: false }),
      supabase.from("funds").select("id, name, kind"),
      supabase.from("accounts").select("id, code, name, type, is_cash_account").eq("is_active", true).order("code"),
    ]);
  const canEdit = isBoardRes === true;
  const canSeeActuals = canReadFinancialsRes === true;

  const today = new Date();
  const todayIso = todayIsoOf(today);
  const fyList = fiscalYears ?? [];
  const fiscalYear = fyList.find((f) => f.starts_on <= todayIso && f.ends_on >= todayIso) ?? fyList[0];
  const priorFy = fiscalYear ? fyList.find((f) => f.ends_on < fiscalYear.starts_on) : undefined;
  const operatingFund = (funds ?? []).find((f) => f.kind === "operating");
  const reserveFund = (funds ?? []).find((f) => f.kind === "reserve");

  if (!fiscalYear || !operatingFund) {
    return (
      <div className="space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Budget &amp; spending</h1>
        <Card navy title="Budget">
          <Empty>{!fiscalYear ? "No fiscal year is set up yet." : "No operating fund is set up yet."}</Empty>
        </Card>
      </div>
    );
  }

  const expenseAccounts = (accounts ?? []).filter((a) => a.type === "expense");
  const reserveCashAccount = (accounts ?? []).find((a) => a.is_cash_account && /reserve/i.test(a.name)) ?? null;
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const p = resolvePeriod(period, fiscalYear, today);

  const [{ data: budgetRows }, { data: priorBudgetRows }] = await Promise.all([
    supabase
      .from("budget_vs_actual")
      .select("account_id, fund_id, budgeted, actual, variance")
      .eq("fiscal_year_id", fiscalYear.id),
    priorFy
      ? supabase
          .from("budget_vs_actual")
          .select("account_id, budgeted")
          .eq("fiscal_year_id", priorFy.id)
          .eq("fund_id", operatingFund.id)
      : Promise.resolve({ data: null }),
  ]);
  const operatingBudgetRows = (budgetRows ?? []).filter((r) => r.fund_id === operatingFund.id);
  const budgetByAccount = new Map(
    operatingBudgetRows.filter((r) => looseCents(r.budgeted) > 0).map((r) => [r.account_id as string, looseCents(r.budgeted)]),
  );
  const annualRowByAccount = new Map(
    operatingBudgetRows.map((r) => [
      r.account_id as string,
      { budgeted: Number(r.budgeted), actual: Number(r.actual), variance: Number(r.variance) },
    ]),
  );
  const hasBudget = budgetByAccount.size > 0;
  const reserveBudgetRow =
    reserveFund && reserveCashAccount
      ? (budgetRows ?? []).find((r) => r.fund_id === reserveFund.id && r.account_id === reserveCashAccount.id)
      : undefined;
  const reservePlanAnnualCents = reserveBudgetRow ? looseCents(reserveBudgetRow.budgeted) : null;

  const editHref = `${hrefFor({ period })}${period === "year" ? "?" : "&"}edit=1#edit-budget`;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Budget &amp; spending</h1>
        <p className="mt-1 text-mute">
          {association.display_name} · Fiscal year {fiscalYear.label} ({fiscalYear.starts_on} to {fiscalYear.ends_on})
        </p>
      </div>
    </div>
  );

  const editTable = (
    <>
      {expenseAccounts.length === 0 ? (
        <Empty>No spending categories on file.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                <th className="pb-2 font-medium">Code</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 text-right font-medium">Budget for the year</th>
                <th className="pb-2 text-right font-medium">Spent so far this year</th>
                <th className="pb-2 text-right font-medium">Over / under</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {expenseAccounts.map((a) => {
                const annual = annualRowByAccount.get(a.id);
                return (
                  <BudgetRow
                    key={a.id}
                    associationId={association.id}
                    fiscalYearId={fiscalYear.id}
                    fundId={operatingFund.id}
                    accountId={a.id}
                    code={a.code}
                    name={a.name}
                    budgeted={annual?.budgeted ?? null}
                    actual={annual?.actual ?? 0}
                    variance={annual ? annual.variance : null}
                    canEdit={canEdit}
                    canSeeActuals={canSeeActuals}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? <AddCategoryForm associationId={association.id} /> : null}
    </>
  );

  // Owners see the plan, not the spending detail — same line as the RLS on
  // expenses and bank_transactions.
  if (!canSeeActuals) {
    return (
      <div className="space-y-6">
        {header}
        <Card navy title="Annual budget" hint="What the board has budgeted for the year.">
          {editTable}
        </Card>
        <p className="text-[12px] text-mute">Spending detail is visible to board members and the accountant.</p>
      </div>
    );
  }

  const currentMonth = monthKey(today);

  const [{ data: expenseRows }, { data: cashRows }, { data: connections }, { data: entryLines }] = await Promise.all([
    supabase.from("monthly_expense_actuals").select("month, account_id, account_name, fund_id, total").order("month"),
    supabase
      .from("monthly_cash_activity")
      .select("month, fund_kind, inflow, outflow, transfer_inflow, transfer_outflow")
      .order("month"),
    supabase.from("bank_connections").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1),
    // The entries behind each bar, for "click a row to see what's in it".
    expenseAccounts.length > 0
      ? supabase
          .from("journal_lines")
          .select("account_id, debit, credit, line_memo, entry:journal_entries!inner(id, entry_date, memo, is_posted)")
          .eq("association_id", association.id)
          .eq("fund_id", operatingFund.id)
          .in(
            "account_id",
            expenseAccounts.map((a) => a.id),
          )
          .eq("entry.is_posted", true)
          .gte("entry.entry_date", p.startDate)
          .lte("entry.entry_date", p.endDate)
          .limit(2000)
      : Promise.resolve({ data: null }),
  ]);

  const expenses = (expenseRows ?? []) as ExpenseActualRow[];
  const cash = (cashRows ?? []) as CashActivityRow[];

  type EntryLine = {
    account_id: string;
    debit: string | number;
    credit: string | number;
    line_memo: string | null;
    entry: { id: string; entry_date: string; memo: string | null } | { id: string; entry_date: string; memo: string | null }[];
  };
  const recentByAccount = new Map<string, RecentEntry[]>();
  for (const raw of (entryLines ?? []) as unknown as EntryLine[]) {
    const entry = Array.isArray(raw.entry) ? raw.entry[0] : raw.entry;
    if (!entry) continue;
    const list = recentByAccount.get(raw.account_id) ?? [];
    list.push({
      entry_date: entry.entry_date,
      memo: (entry.memo ?? raw.line_memo ?? "").replace(/^\[DEMO\]\s*/, "") || "Journal entry",
      cents: Math.round((Number(raw.debit) - Number(raw.credit)) * 100),
    });
    recentByAccount.set(raw.account_id, list);
  }
  for (const list of recentByAccount.values()) list.sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  // ---- Plan vs spent ---------------------------------------------------------
  const periodSpend = spendByAccount(expenses, p.startKey, p.endKey, operatingFund.id);
  const periodSpendById = new Map(periodSpend.map((a) => [a.accountId, a.cents]));
  const planRows = buildPlanRows(budgetByAccount, periodSpendById, (id) => accountName.get(id) ?? "", p.budgetShare);
  const unbudgetedSpend = periodSpend.filter((a) => !budgetByAccount.has(a.accountId));
  const totalTarget = planRows.reduce((s, r) => s + r.targetCents, 0);
  const totalSpent = periodSpend.reduce((s, a) => s + a.cents, 0);
  const pace = paceShare(p.startKey, p.endKey, today);
  const savedCents = [...transfersInByMonth(cash, "reserve").entries()]
    .filter(([k]) => k >= p.startKey && k <= p.endKey)
    .reduce((s, [, v]) => s + v, 0);
  const reservePlanCents = reservePlanAnnualCents !== null ? Math.round(reservePlanAnnualCents * p.budgetShare) : null;

  // ---- Forecast -------------------------------------------------------------
  const fyStartKey = `${fiscalYear.starts_on.slice(0, 7)}-01`;
  const monthsElapsed = monthsBetween(fyStartKey, addMonths(currentMonth, -1)).length;
  const forecast = hasBudget
    ? forecastYearEnd({
        spentByAccount: spendByAccount(expenses, fyStartKey, currentMonth, operatingFund.id),
        budgetByAccount,
        fyStart: fiscalYear.starts_on,
        fyEnd: fiscalYear.ends_on,
        today,
        monthsElapsed,
      })
    : null;
  const headline = hasBudget
    ? planHeadline({
        periodLabel: period === "year" ? fiscalYear.label : period === "month" ? monthLongLabel(currentMonth) : p.label,
        isFiscalYear: period === "year",
        spentCents: totalSpent,
        targetCents: totalTarget,
        forecast,
        rows: planRows,
      })
    : null;
  const headlineDetail =
    headline && !headline.detail && period === "year" && !forecast
      ? `A year-end forecast appears after ${MIN_FORECAST_MONTHS} full months of the fiscal year.`
      : headline?.detail;

  // ---- Where the money went ---------------------------------------------------
  const allSpend = spendByAccount(expenses, p.startKey, p.endKey);
  const allSpendTotal = allSpend.reduce((s, a) => s + a.cents, 0);
  const priorSpend = spendByAccount(expenses, addMonths(p.startKey, -12), addMonths(p.endKey, -12));
  const comparison = comparisonSentence(
    allSpend,
    priorSpend,
    (c) => formatMoney(c).replace(/\.00$/, ""),
    period === "month" ? `${monthLongLabel(addMonths(currentMonth, -12))}` : "the same months last year",
  );

  // ---- Suggested starting budget ----------------------------------------------
  const priorBudgetLines = (priorBudgetRows ?? [])
    .filter((r) => looseCents(r.budgeted) > 0 && expenseAccounts.some((a) => a.id === r.account_id))
    .map((r) => ({ accountId: r.account_id as string, name: accountName.get(r.account_id) ?? "", amountCents: looseCents(r.budgeted) }));
  const priorActualLines = priorFy
    ? spendByAccount(expenses, `${priorFy.starts_on.slice(0, 7)}-01`, `${priorFy.ends_on.slice(0, 7)}-01`, operatingFund.id)
        .filter((l) => expenseAccounts.some((a) => a.id === l.accountId))
        .map((l) => ({ accountId: l.accountId, name: l.name, amountCents: l.cents }))
    : [];
  const suggestion =
    !hasBudget && canEdit && priorFy && (priorBudgetLines.length > 0 || priorActualLines.length > 0) ? (
      <div className="mb-4">
        <SuggestedBudget
          associationId={association.id}
          fiscalYearId={fiscalYear.id}
          fundId={operatingFund.id}
          priorLabel={priorFy.label}
          source={priorBudgetLines.length > 0 ? "budget" : "actuals"}
          lines={priorBudgetLines.length > 0 ? priorBudgetLines : priorActualLines}
        />
      </div>
    ) : null;

  const lastSynced = connections?.[0]?.last_synced_at ?? null;
  const paceWords = `${Math.round(pace * 100)}% of ${period === "month" ? "the month" : "the period"} gone`;

  const rowShell = "group border-b border-line/70 last:border-b-0";
  const summaryShell =
    "cursor-pointer list-none px-3 py-2.5 hover:bg-fill/40 [&::-webkit-details-marker]:hidden";

  const recentList = (accountId: string) => {
    const list = (recentByAccount.get(accountId) ?? []).slice(0, 5);
    return (
      <>
        {list.length === 0 ? (
          <p className="text-mute-soft">Nothing posted here in this period.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {list.map((e, i) => (
              <li key={`${e.entry_date}-${i}`} className="flex items-baseline gap-3 py-1.5">
                <span className="figures w-16 shrink-0 text-mute">{shortDate(e.entry_date, todayIso)}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{e.memo}</span>
                <span className="figures shrink-0 text-ink">{dollars(e.cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={transactionsFor(accountId)} className="mt-2 inline-block font-medium text-ink underline-offset-2 hover:underline">
          See all on the bank feed →
        </Link>
      </>
    );
  };

  const planRowItem = (r: PlanRow) => {
    const style = STATUS_STYLE[r.status];
    const used = r.targetCents > 0 ? Math.round((r.spentCents / r.targetCents) * 100) : 0;
    return (
      <li key={r.accountId}>
        <details className={rowShell}>
          <summary className={summaryShell}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                <span className="truncate text-[13px] font-medium text-ink">{r.name}</span>
                <span className={`text-[11px] font-medium ${style.text}`}>
                  {r.status === "on_track" ? (r.spentCents === 0 ? "Nothing yet" : style.word) : `${r.pctOver}% over`}
                </span>
              </span>
              <span className="shrink-0 text-[12px]">
                <span className="figures text-ink">{dollars(r.spentCents)}</span>
                <span className="text-mute"> of {dollars(r.targetCents)}</span>
              </span>
            </div>
            <PlanBar spent={r.spentCents} target={r.targetCents} pace={pace} bar={style.bar} />
            <div className="mt-1 flex justify-between text-[11px] text-mute">
              <span className={r.leftCents < 0 ? style.text : ""}>
                {r.leftCents >= 0 ? `${dollars(r.leftCents)} left to spend` : `${dollars(-r.leftCents)} over`}
              </span>
              <span>{used}% used</span>
            </div>
          </summary>
          <div className="bg-fill/30 px-3 pb-3 pl-9 text-[12px]">
            <p className="py-2 text-mute">
              Plan:{" "}
              <PlannedAmount
                associationId={association.id}
                fiscalYearId={fiscalYear.id}
                fundId={operatingFund.id}
                accountId={r.accountId}
                annualCents={r.annualCents}
                canEdit={canEdit}
              />{" "}
              a year · {dollars(r.targetCents)} for this period
            </p>
            {recentList(r.accountId)}
          </div>
        </details>
      </li>
    );
  };

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
            <Link
              key={k}
              href={hrefFor({ period: k })}
              aria-current={k === period ? "page" : undefined}
              className={`inline-flex min-h-[36px] items-center rounded-full px-3.5 text-[12px] font-medium ${
                k === period ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {PERIOD_LABEL[k]}
            </Link>
          ))}
        </nav>
        <p className="flex items-center gap-3 text-[12px] text-mute">
          <span>
            {p.label} · {syncedWords(lastSynced, today)}
          </span>
          {canEdit && hasBudget ? (
            <a href={editHref} className="font-medium text-ink underline-offset-2 hover:underline">
              Edit budget
            </a>
          ) : null}
        </p>
      </div>

      {!hasBudget ? (
        <Card
          navy
          title="Set a budget in 5 minutes"
          hint="One number per category for the year. Then this page can tell you whether spending is on plan and where the year is heading."
        >
          {suggestion}
          {editTable}
        </Card>
      ) : (
        <>
          <details id="edit-budget" open={editOpen} className="rounded-xl border border-line bg-paper">
            <summary className="cursor-pointer list-none px-5 py-4 [&::-webkit-details-marker]:hidden">
              <span className="font-bold tracking-tight text-ink">{canEdit ? "Edit the full budget" : "The full budget"}</span>
              <span className="ml-3 text-[12px] text-mute">
                {canEdit ? "Every category, one number for the year. Tip: you can also click any plan figure above." : "Every category for the year."}
              </span>
            </summary>
            <div className="border-t border-line px-5 py-4">{editTable}</div>
          </details>

          <Card
            navy
            title="Plan vs. spent"
            hint={p.budgetCaption}
            action={<span className="whitespace-nowrap text-[12px] text-ondark-mute">{paceWords}</span>}
          >
            {headline ? <Answer status={headline.status} headline={headline.headline} detail={headlineDetail} /> : null}

            <ul className="mt-5 overflow-hidden rounded-lg border border-line">
              {planRows.map(planRowItem)}

              {unbudgetedSpend.map((a) => (
                <li key={a.accountId}>
                  <details className={rowShell}>
                    <summary className={summaryShell}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                          <span className="truncate text-[13px] font-medium text-ink">{a.name}</span>
                          <span className={`text-[11px] font-medium ${STATUS_STYLE.none.text}`}>{STATUS_STYLE.none.word}</span>
                        </span>
                        <span className="figures shrink-0 text-[12px] text-ink">{dollars(a.cents)}</span>
                      </div>
                      <PlanBar spent={a.cents} target={0} pace={pace} bar={STATUS_STYLE.none.bar} />
                      <div className="mt-1 text-[11px] text-mute">Spent with no plan set — add one so it&rsquo;s tracked like the rest.</div>
                    </summary>
                    <div className="bg-fill/30 px-3 pb-3 pl-9 text-[12px]">
                      <p className="py-2 text-mute">
                        <PlannedAmount
                          associationId={association.id}
                          fiscalYearId={fiscalYear.id}
                          fundId={operatingFund.id}
                          accountId={a.accountId}
                          annualCents={null}
                          suggestedAnnualCents={suggestAnnualFromSpend(a.cents, p.budgetShare)}
                          canEdit={canEdit}
                          openLabel="Add to budget"
                        />
                        {canEdit ? (
                          <span className="ml-2 text-mute-soft">
                            (pre-filled from this period&rsquo;s spending, {dollars(suggestAnnualFromSpend(a.cents, p.budgetShare))} a year)
                          </span>
                        ) : null}
                      </p>
                      {recentList(a.accountId)}
                    </div>
                  </details>
                </li>
              ))}

              {reserveFund && reserveCashAccount ? (
                <li>
                  <details className={rowShell}>
                    <summary className={summaryShell}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2">
                          <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                          <span className="truncate text-[13px] font-medium text-ink">Set aside for the reserve</span>
                          <span className={`text-[11px] font-medium ${STATUS_STYLE.saved.text}`}>
                            {reservePlanCents === null
                              ? "Savings"
                              : savedCents >= reservePlanCents
                                ? "On plan ✓"
                                : `${dollars(reservePlanCents - savedCents)} short`}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px]">
                          <span className="figures text-ink">{dollars(savedCents)}</span>
                          {reservePlanCents !== null ? <span className="text-mute"> of {dollars(reservePlanCents)}</span> : null}
                        </span>
                      </div>
                      <PlanBar spent={savedCents} target={reservePlanCents ?? 0} pace={pace} bar={STATUS_STYLE.saved.bar} />
                      <div className="mt-1 text-[11px] text-mute-soft">Savings, not spending — never counted as over budget.</div>
                    </summary>
                    <div className="bg-fill/30 px-3 pb-3 pl-9 text-[12px]">
                      <p className="py-2 text-mute">
                        Plan to set aside:{" "}
                        <PlannedAmount
                          associationId={association.id}
                          fiscalYearId={fiscalYear.id}
                          fundId={reserveFund.id}
                          accountId={reserveCashAccount.id}
                          annualCents={reservePlanAnnualCents}
                          canEdit={canEdit}
                          openLabel="Set a yearly amount"
                        />{" "}
                        {reservePlanAnnualCents !== null ? "a year" : ""}
                      </p>
                      <p className="text-mute-soft">Counts money moved from the operating account to the reserve in this period.</p>
                    </div>
                  </details>
                </li>
              ) : null}
            </ul>

            <div className="mt-3 grid gap-2 border-t border-line pt-3 text-[13px] sm:grid-cols-3">
              <div>
                <span className="text-mute">Planned</span>{" "}
                <span className="figures text-ink">{dollars(totalTarget)}</span>
              </div>
              <div>
                <span className="text-mute">Spent</span>{" "}
                <span className="figures text-ink">{dollars(totalSpent)}</span>
              </div>
              <div className="sm:text-right">
                <span className="text-mute">{totalTarget - totalSpent >= 0 ? "Left to spend" : "Over"}</span>{" "}
                <span className={`figures ${totalTarget - totalSpent >= 0 ? "text-good-text" : "text-bad-text"}`}>
                  {dollars(Math.abs(totalTarget - totalSpent))}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-mute-soft">
              The thin line on each bar is where you&rsquo;d be if spending were spread evenly. On track: at or under plan ·
              Watch: up to 10% over · Over budget: more than 10% over. Click a row for what&rsquo;s in it.
            </p>
          </Card>

          <Card navy title="Where the money went" hint="Moves to the reserve aren't included — they're savings, not spending.">
            {allSpend.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[13px] text-mute">Nothing posted for {p.label.toLowerCase()} yet.</p>
                <Link
                  href="/bank-feed"
                  className="mt-3 inline-block rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-paper hover:bg-ink-mid"
                >
                  Categorize transactions on the bank feed →
                </Link>
              </div>
            ) : (
              <>
                <SpendingBreakdown
                  slices={allSpend.map((a) => ({ label: a.name, valueCents: a.cents, href: transactionsFor(a.accountId) }))}
                  avgMonthlyCents={Math.round(allSpendTotal / Math.max(1, p.months.length))}
                  monthCount={p.months.length}
                  sinceLabel={period === "month" ? `in ${p.label}` : `Since ${monthLongLabel(p.startKey)}`}
                  ariaLabel={`Spending by category for ${p.label}.`}
                />
                {comparison ? <p className="mt-3 text-[12px] text-mute">{comparison}</p> : null}
              </>
            )}
          </Card>

        </>
      )}
    </div>
  );
}
