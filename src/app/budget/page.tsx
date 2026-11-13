import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { formatMoney } from "@/lib/tax/form1120h";
import { transfersInByMonth, type CashActivityRow } from "@/lib/money/cash";
import { spendByAccount, type ExpenseActualRow } from "@/lib/money/spending";
import { addMonths, monthKey, monthsBetween } from "@/lib/money/months";
import { PERIOD_LABEL, parsePeriod, resolvePeriod, type PeriodKey } from "@/lib/money/period";
import { forecastYearEnd, MIN_FORECAST_MONTHS } from "@/lib/money/budget";
import { buildPlanRows, suggestAnnualFromSpend, type PlanRow } from "@/lib/money/plan";
import { dateRangeLabel, shortDate, todayIso as todayIsoOf } from "@/lib/dates";
import { BudgetRow } from "./budget-row";
import { AddCategoryForm } from "./add-category-form";
import { SuggestedBudget } from "./suggested-budget";
import { PlannedAmount } from "./planned-amount";
import { inForce } from "@/lib/insurance/status";
import { toCents } from "@/lib/money/cents";
import { btnSecondary } from "@/components/repairs/styles";

export const dynamic = "force-dynamic";

const looseCents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const dollars = (cents: number) => formatMoney(Math.round(cents / 100) * 100).replace(/\.00$/, "");

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

/**
 * The row bar, 5px. Within budget (or within 5% of it): one green fill, spent ÷ budget.
 * Over budget: the whole bar is what was spent, green up to the budget and brick for the rest.
 * `fill` recolors the single fill (the reserve's savings bar is navy).
 */
function BudgetBar({ spent, target, over = false, fill = "bg-moss" }: { spent: number; target: number; over?: boolean; fill?: string }) {
  if (over && spent > 0) {
    const within = Math.min(100, (target / spent) * 100);
    return (
      <div className="mt-1.5 flex h-[5px] overflow-hidden rounded-full bg-fill">
        <div className="h-full bg-moss" style={{ width: `${within}%` }} />
        <div className="h-full flex-1 bg-bad" />
      </div>
    );
  }
  const used = target > 0 ? Math.min(100, (spent / target) * 100) : 0;
  return (
    <div className="mt-1.5 h-[5px] overflow-hidden rounded-full bg-fill">
      <div className={`h-full ${fill}`} style={{ width: `${used}%` }} />
    </div>
  );
}

/** Spent | Budget | Status as three fixed, right-aligned columns from sm up; "$spent of $budget" then the status below that on a phone. */
const NUM_GRID = "sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_6rem_7rem] sm:items-baseline sm:gap-x-3";

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const editOpen = sp.edit === "1";

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id, display_name, legal_name").limit(1);
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
  // Adding a category is an admin's or the Treasurer's (create_expense_account, 0076); other board members edit the lines.
  const { data: booksDuty } = await supabase.rpc("has_duty", { p_association_id: association.id, p_duty: "books" });
  const canAddCategory = booksDuty === true;
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

  // Next to the Insurance category: what the policies in force cost a year
  // (insurance-spec §12 I-11). Readers of the books only, like the policies.
  let premiumsHint: { text: string; href: string } | null = null;
  if (canSeeActuals && expenseAccounts.some((a) => /insurance/i.test(a.name))) {
    const { data: policyRows } = await supabase
      .from("insurance_policies")
      .select("id, coverage, effective_from, effective_to, renewal_reminder_days, archived_at, replaced_by_policy_id, replaced_at, annual_premium::text")
      .is("archived_at", null);
    const active = inForce(
      (policyRows ?? []).map((r) => ({
        id: r.id as string,
        coverage: r.coverage as string,
        effective_from: r.effective_from as string,
        effective_to: r.effective_to as string,
        renewal_reminder_days: (r.renewal_reminder_days as number | null) ?? 60,
        archived_at: (r.archived_at as string | null) ?? null,
        replaced_by_policy_id: (r.replaced_by_policy_id as string | null) ?? null,
        replaced_at: (r.replaced_at as string | null) ?? null,
        annual_premium: (r.annual_premium as string | null) ?? null,
      })),
      todayIso,
    );
    const totalCents = active.reduce((sum, p) => {
      try {
        return sum + (p.annual_premium ? toCents(p.annual_premium) : 0);
      } catch {
        return sum;
      }
    }, 0);
    if (active.length > 0) premiumsHint = { text: `Current premiums: ${dollars(totalCents)} a year`, href: "/insurance" };
  }
  const reserveCashAccount = (accounts ?? []).find((a) => a.is_cash_account && /reserve/i.test(a.name)) ?? null;
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const p = resolvePeriod(period, fiscalYear, today);

  // Spending data doesn't depend on the budget rows, so it starts now and
  // runs alongside them instead of after them. Owners never see actuals, so
  // they don't pay for it.
  const actualsPromise = canSeeActuals
    ? Promise.all([
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
      ])
    : null;

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
  // Spending plan only: income budget lines (assessments, laundry…) are not something to "spend".
  const expenseIds = new Set(expenseAccounts.map((a) => a.id));
  const budgetByAccount = new Map(
    operatingBudgetRows
      .filter((r) => looseCents(r.budgeted) > 0 && expenseIds.has(r.account_id as string))
      .map((r) => [r.account_id as string, looseCents(r.budgeted)]),
  );
  const budgetedByAccount = new Map(operatingBudgetRows.map((r) => [r.account_id as string, Number(r.budgeted)]));
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
          {association.legal_name} · Fiscal year {dateRangeLabel(fiscalYear.starts_on, fiscalYear.ends_on)}
        </p>
      </div>
    </div>
  );

  /** spentById: this period's spending per category (same figures as every other number on the page); null when the viewer can't see actuals. */
  const renderEditTable = (spentById: Map<string, number> | null) => (
    <>
      {expenseAccounts.length === 0 ? (
        <Empty>No spending categories on file.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 text-right font-medium">Budget for the year</th>
                <th className="pb-2 text-right font-medium">{period === "month" ? "Spent this month" : "Spent so far this year"}</th>
                <th className="pb-2 text-right font-medium">{period === "month" ? "Over / under this month\u2019s share" : "Over / under the budget"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {expenseAccounts.map((a) => {
                const annualBudget = budgetedByAccount.get(a.id) ?? null;
                const spent = (spentById?.get(a.id) ?? 0) / 100;
                // Over/under compares spending with the same share of the year the period covers.
                const variance = annualBudget === null ? null : spent - annualBudget * p.budgetShare;
                return (
                  <BudgetRow
                    key={a.id}
                    associationId={association.id}
                    fiscalYearId={fiscalYear.id}
                    fundId={operatingFund.id}
                    accountId={a.id}
                    name={a.name}
                    budgeted={annualBudget}
                    actual={spent}
                    variance={variance}
                    canEdit={canEdit}
                    canSeeActuals={canSeeActuals}
                    hint={/insurance/i.test(a.name) ? premiumsHint : null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canAddCategory ? <AddCategoryForm associationId={association.id} /> : null}
    </>
  );

  // Owners see the plan, not the spending detail — same line as the RLS on
  // expenses and bank_transactions.
  if (!canSeeActuals) {
    return (
      <div className="space-y-6">
        {header}
        <Card navy title="Annual budget" hint="What the board has budgeted for the year.">
          {renderEditTable(null)}
        </Card>
        <p className="text-[12px] text-mute">Spending detail is visible to board members and the accountant.</p>
      </div>
    );
  }

  const currentMonth = monthKey(today);

  const [{ data: expenseRows }, { data: cashRows }, , { data: entryLines }] = await actualsPromise!;

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
  // Biggest dollars over first, so the eye lands on the real problems; under-budget rows follow.
  const planRows = buildPlanRows(budgetByAccount, periodSpendById, (id) => accountName.get(id) ?? "", p.budgetShare).sort(
    (a, b) => a.leftCents - b.leftCents || a.name.localeCompare(b.name),
  );
  /** One rule for "over": more than 5% past the budget so far. Anything closer counts as on budget. */
  const isOver = (spent: number, target: number) => spent > target * 1.05;
  const biggestOverage = planRows.find((r) => isOver(r.spentCents, r.targetCents)) ?? null;
  const unbudgetedSpend = periodSpend.filter((a) => !budgetByAccount.has(a.accountId));
  const totalTarget = planRows.reduce((s, r) => s + r.targetCents, 0);
  const totalSpent = periodSpend.reduce((s, a) => s + a.cents, 0);
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

  const rowShell = "group";
  // A hairline between rows that stops short of both side edges.
  const rowLi = "relative after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-line last:after:hidden";
  const summaryShell =
    "cursor-pointer list-none px-5 py-2.5 hover:bg-fill/40 [&::-webkit-details-marker]:hidden";

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
                <span className="figures shrink-0 whitespace-nowrap text-ink">{dollars(e.cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href={transactionsFor(accountId)} className="mt-2 inline-flex min-h-[44px] items-center font-medium text-ink underline-offset-2 hover:underline sm:min-h-0">
          See all on the bank feed →
        </Link>
      </>
    );
  };

  const planRowItem = (r: PlanRow) => {
    const over = isOver(r.spentCents, r.targetCents);
    const statusText = over
      ? `${dollars(-r.leftCents)} over`
      : r.leftCents < 0
        ? "On budget"
        : `${dollars(r.leftCents)} left`;
    return (
      <li key={r.accountId} className={rowLi}>
        <details className={rowShell}>
          <summary className={summaryShell}>
            <div className={NUM_GRID}>
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                <span className="truncate text-[13px] font-medium text-ink">{r.name}</span>
              </span>
              <div className="mt-0.5 pl-[22px] text-[13px] sm:contents sm:pl-0">
                <span className="figures font-medium text-ink sm:block sm:text-right">{dollars(r.spentCents)}</span>
                <span className="figures ml-1 text-mute sm:ml-0 sm:block sm:text-right">of {dollars(r.targetCents)}</span>
              </div>
              <span className={`figures block pl-[22px] text-[13px] font-medium sm:pl-0 sm:text-right ${over ? "text-bad-text" : "text-good-text"}`}>
                {statusText}
              </span>
            </div>
            <BudgetBar spent={r.spentCents} target={r.targetCents} over={over} />
          </summary>
          <div className="bg-fill/30 px-5 pb-3 pl-11 text-[12px]">
            <p className="py-2 text-mute">
              Budget:{" "}
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
              className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 sm:min-h-[36px] text-[12px] font-medium ${
                k === period ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {PERIOD_LABEL[k]}
            </Link>
          ))}
        </nav>
        {canEdit && hasBudget ? (
          <a href={editHref} className={btnSecondary}>
            Edit budget
          </a>
        ) : null}
      </div>

      {!hasBudget ? (
        <Card
          navy
          title="Set a budget in 5 minutes"
          hint="One number per category for the year. Then this page can tell you whether spending is on budget and where the year is heading."
        >
          {suggestion}
          {renderEditTable(periodSpendById)}
        </Card>
      ) : (
        <>
          <Card navy title="Budget vs. Spent" hint={p.budgetCaption}>
            <div className="pb-4">
              <p className={`text-[20px] font-semibold leading-tight ${isOver(totalSpent, totalTarget) ? "text-bad-text" : "text-good-text"}`}>
                {isOver(totalSpent, totalTarget)
                  ? `Over so far: ${dollars(totalSpent - totalTarget)}`
                  : totalSpent > totalTarget
                    ? "On budget so far"
                    : `Under so far: ${dollars(totalTarget - totalSpent)}`}
              </p>
              {period === "year" ? (
                <p className="mt-1.5 text-[13px] text-ink">
                  {forecast
                    ? Math.abs(forecast.overUnderCents) < 10000
                      ? "On pace for the year: right on budget"
                      : `On pace for the year: ${dollars(Math.abs(forecast.overUnderCents))} ${forecast.overUnderCents > 0 ? "over" : "under"}`
                    : `On pace for the year: forecast appears after ${MIN_FORECAST_MONTHS} full months`}
                </p>
              ) : null}
              {biggestOverage ? (
                <p className="mt-0.5 text-[13px] text-mute">
                  Biggest overage: {biggestOverage.name} ({dollars(-biggestOverage.leftCents)})
                </p>
              ) : null}
            </div>

            {/* Rows sit directly in the card, edge to edge (the card's own padding is cancelled). */}
            <details open className="group/cat -mx-5 -mb-4 border-t border-line">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 px-5 py-2.5 text-[12px] font-medium text-mute hover:text-ink sm:min-h-0 [&::-webkit-details-marker]:hidden">
                <span className="group-open/cat:hidden">Show categories</span>
                <span className="hidden group-open/cat:inline">Hide categories</span>
                <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 transition-transform group-open/cat:rotate-90" />
              </summary>
              <ul className="border-t border-line">
                {planRows.map(planRowItem)}

                {unbudgetedSpend.map((a) => (
                  <li key={a.accountId} className={rowLi}>
                    <details className={rowShell}>
                      <summary className={summaryShell}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                            <span className="truncate text-[13px] font-medium text-ink">{a.name}</span>
                          </span>
                          <span className="flex flex-wrap items-baseline gap-x-2 pl-[22px] text-[13px] sm:pl-0">
                            <span className="figures font-medium text-ink">{dollars(a.cents)}</span>
                            <span className="text-mute-soft">·</span>
                            <span className="text-mute">No budget set</span>
                            {canEdit ? (
                              <>
                                <span className="text-mute-soft">·</span>
                                <PlannedAmount
                                  associationId={association.id}
                                  fiscalYearId={fiscalYear.id}
                                  fundId={operatingFund.id}
                                  accountId={a.accountId}
                                  annualCents={null}
                                  suggestedAnnualCents={suggestAnnualFromSpend(a.cents, p.elapsedShare)}
                                  canEdit={canEdit}
                                  openLabel="Add budget"
                                />
                              </>
                            ) : null}
                          </span>
                        </div>
                      </summary>
                      <div className="bg-fill/30 px-5 pb-3 pl-11 text-[12px]">{recentList(a.accountId)}</div>
                    </details>
                  </li>
                ))}
              </ul>

              {reserveFund && reserveCashAccount ? (
                <div className="border-t border-line">
                  <p className="px-5 pt-3 text-[11px] font-medium uppercase tracking-wide text-mute">Savings</p>
                  <details className={rowShell}>
                    <summary className={summaryShell}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <ChevronRight size={14} strokeWidth={1.6} aria-hidden="true" className="shrink-0 text-mute-soft transition-transform group-open:rotate-90" />
                          <span className="truncate text-[13px] font-medium text-ink">Set aside for the reserve</span>
                        </span>
                        <span className="pl-[22px] text-[13px] sm:pl-0">
                          <span className="figures font-medium text-ink">{dollars(savedCents)}</span>
                          <span className="text-mute"> set aside</span>
                          {reservePlanCents !== null ? <span className="figures text-mute"> of {dollars(reservePlanCents)}</span> : null}
                        </span>
                      </div>
                      {reservePlanCents !== null ? <BudgetBar spent={savedCents} target={reservePlanCents} fill="bg-ink" /> : null}
                      <p className="mt-1.5 text-[12px] text-mute">Savings, not spending. Never counted as over budget.</p>
                    </summary>
                    <div className="bg-fill/30 px-5 pb-3 pl-11 text-[12px]">
                      <p className="py-2 text-mute">
                        Budget to set aside:{" "}
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
                </div>
              ) : null}

              <p className="border-t border-line px-5 py-3 text-[12px] text-mute">
                Green: under budget or within 5%. Red: more than 5% over. Click a row for what&rsquo;s in it.
              </p>
            </details>
          </Card>

          {/* Always here at the bottom; the header expands it. "Edit budget" opens it. */}
          <details id="edit-budget" open={editOpen} className="group rounded-xl border border-line bg-paper">
            <summary className="band flex cursor-pointer list-none items-center justify-between gap-3 rounded-[7px] bg-ink px-5 py-3 group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="eyebrow block text-paper">{canEdit ? "Edit the full budget" : "The full budget"}</span>
                <span className="mt-1 block text-[13px] text-ondark-mute">Every category, one number for the year.</span>
              </span>
              <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ondark-mute transition-transform group-open:rotate-90" />
            </summary>
            <div className="px-5 py-4">{renderEditTable(periodSpendById)}</div>
          </details>
        </>
      )}
    </div>
  );
}
