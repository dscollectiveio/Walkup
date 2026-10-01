import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Restricted } from "@/components/ui";
import { formatMoney } from "@/lib/tax/form1120h";
import { DonutChart } from "@/components/home/charts/donut-chart";
import { cashByMonth, transfersInByMonth, type CashActivityRow } from "@/lib/money/cash";
import { median, spendByAccount, spendByMonth, type ExpenseActualRow } from "@/lib/money/spending";
import { addMonths, monthKey, monthLongLabel, monthsBetween } from "@/lib/money/months";
import { PERIOD_LABEL, parsePeriod, resolvePeriod, type PeriodKey } from "@/lib/money/period";
import {
  budgetStatus,
  comparisonSentence,
  forecastYearEnd,
  MIN_FORECAST_MONTHS,
  type BudgetStatus,
} from "@/lib/money/budget";
import { BudgetRow } from "./budget-row";
import { AddCategoryForm } from "./add-category-form";
import { AddBillForm } from "./add-bill-form";
import { CategorizeMenu } from "./categorize-menu";
import { SuggestedBudget } from "./suggested-budget";
import { isNeedsCategory, loadTransactions, type TxRow } from "./transactions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const looseCents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const STATUS_STYLE: Record<BudgetStatus | "saved", { bar: string; text: string; word: string }> = {
  on_track: { bar: "bg-moss", text: "text-good-text", word: "On track" },
  watch: { bar: "bg-warning", text: "text-warning-text", word: "Watch" },
  over: { bar: "bg-bad", text: "text-bad-text", word: "Over budget" },
  saved: { bar: "bg-slate", text: "text-info-text", word: "Saved" },
};

function syncedWords(lastSynced: string | null, now: Date): string {
  if (!lastSynced) return "Bank not synced yet";
  const d = new Date(lastSynced);
  const days = Math.floor((new Date(iso(now)).getTime() - new Date(iso(d)).getTime()) / 86_400_000);
  if (days <= 0) return d.getHours() < 12 ? "Synced this morning" : "Synced today";
  if (days === 1) return "Synced yesterday";
  return `Synced ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface Params {
  period?: string;
  cat?: string;
  q?: string;
  show?: string;
}

function hrefFor(p: { period: PeriodKey; cat?: string | null; q?: string | null; show?: number }, hash = "") {
  const params = new URLSearchParams();
  if (p.period !== "year") params.set("period", p.period);
  if (p.cat) params.set("cat", p.cat);
  if (p.q) params.set("q", p.q);
  if (p.show && p.show > PAGE_SIZE) params.set("show", String(p.show));
  const qs = params.toString();
  return `/budget${qs ? `?${qs}` : ""}${hash}`;
}

export default async function BudgetPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const period = parsePeriod(sp.period);
  const cat = sp.cat?.trim() || null;
  const q = sp.q?.trim() || null;
  const show = Math.min(1000, Math.max(PAGE_SIZE, Number(sp.show) || PAGE_SIZE));

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
  const todayIso = iso(today);
  const fyList = fiscalYears ?? [];
  const fiscalYear = fyList.find((f) => f.starts_on <= todayIso && f.ends_on >= todayIso) ?? fyList[0];
  const priorFy = fiscalYear ? fyList.find((f) => f.ends_on < fiscalYear.starts_on) : undefined;
  const operatingFund = (funds ?? []).find((f) => f.kind === "operating");
  const reserveFund = (funds ?? []).find((f) => f.kind === "reserve");

  if (!fiscalYear || !operatingFund) {
    return (
      <div className="space-y-6">
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Budget &amp; spending</h1>
        <Card title="Budget">
          <Empty>{!fiscalYear ? "No fiscal year is set up yet." : "No operating fund is set up yet."}</Empty>
        </Card>
      </div>
    );
  }

  const expenseAccounts = (accounts ?? []).filter((a) => a.type === "expense");
  const accountName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const p = resolvePeriod(period, fiscalYear, today);

  const { data: budgetRows } = await supabase
    .from("budget_vs_actual")
    .select("account_id, budgeted, actual, variance")
    .eq("fiscal_year_id", fiscalYear.id)
    .eq("fund_id", operatingFund.id);
  const budgetByAccount = new Map(
    (budgetRows ?? []).filter((r) => looseCents(r.budgeted) > 0).map((r) => [r.account_id as string, looseCents(r.budgeted)]),
  );
  const annualRowByAccount = new Map(
    (budgetRows ?? []).map((r) => [r.account_id as string, { budgeted: Number(r.budgeted), actual: Number(r.actual), variance: Number(r.variance) }]),
  );
  const hasBudget = budgetByAccount.size > 0;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">Budget &amp; spending</h1>
        <p className="mt-1 text-mute">
          {association.display_name} · Fiscal year {fiscalYear.label} ({fiscalYear.starts_on} to {fiscalYear.ends_on})
        </p>
      </div>
      {canEdit ? (
        <a
          href="#edit-budget"
          className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong bg-paper px-4 text-[13px] font-medium text-ink hover:bg-fill"
        >
          Edit budget
        </a>
      ) : null}
    </div>
  );

  const editBudgetCard = (suggestion: React.ReactNode) => (
    <div id="edit-budget">
      <Card
        title={canEdit ? "Edit budget" : "Annual budget"}
        hint={
          canEdit
            ? "One number per category for the whole year. Leave a category blank to hide it from the bars above."
            : "What the board has budgeted for the year."
        }
      >
        {suggestion}
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
      </Card>
    </div>
  );

  // Owners see the plan, not the spending detail — same line as the RLS on
  // expenses and bank_transactions.
  if (!canSeeActuals) {
    return (
      <div className="space-y-6">
        {header}
        {editBudgetCard(null)}
        <p className="text-[12px] text-mute">Spending detail is visible to board members and the accountant.</p>
      </div>
    );
  }

  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const in30Iso = iso(in30);
  const currentMonth = monthKey(today);

  const [
    { data: expenseRows },
    { data: cashRows },
    { data: fundBalances },
    { data: duesRows },
    { data: lateCharges },
    { data: duesSoon },
    { data: billsSoon },
    { data: renewalsSoon },
    { data: connections },
    { data: units },
    { data: contractors },
    tx,
  ] = await Promise.all([
    supabase.from("monthly_expense_actuals").select("month, account_id, account_name, fund_id, total").order("month"),
    supabase
      .from("monthly_cash_activity")
      .select("month, fund_kind, inflow, outflow, transfer_inflow, transfer_outflow")
      .order("month"),
    supabase.from("fund_cash_balances").select("fund_id, kind, cash_balance"),
    supabase.from("monthly_dues_collection").select("month, charged, collected").eq("month", currentMonth),
    supabase
      .from("charge_balances")
      .select("unit_id, days_overdue, balance")
      .in("status", ["open", "partial"])
      .gt("days_overdue", 0),
    supabase
      .from("charge_balances")
      .select("balance")
      .in("status", ["open", "partial"])
      .gte("due_on", todayIso)
      .lte("due_on", in30Iso),
    supabase
      .from("recurring_bills")
      .select("id, name, typical_amount, next_due_on, autopay_arranged, vendors(id, name)")
      .eq("is_active", true)
      .gte("next_due_on", todayIso)
      .lte("next_due_on", in30Iso)
      .order("next_due_on"),
    supabase
      .from("insurance_policies")
      .select("id, coverage, carrier_name, annual_premium, effective_to")
      .gte("effective_to", todayIso)
      .lte("effective_to", in30Iso),
    supabase.from("bank_connections").select("last_synced_at").order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1),
    supabase.from("units").select("id, label"),
    supabase.from("vendors").select("id, name").order("name"),
    loadTransactions(supabase, { startDate: p.startDate, endDate: p.endDate, category: cat, query: q, limit: show }),
  ]);

  const expenses = (expenseRows ?? []) as ExpenseActualRow[];
  const cash = (cashRows ?? []) as CashActivityRow[];
  const unitLabel = new Map((units ?? []).map((u) => [u.id, u.label]));

  // ---- Stat cards --------------------------------------------------------
  const operatingCashCents = (fundBalances ?? [])
    .filter((f) => f.kind === "operating")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);
  const reserveCashCents = (fundBalances ?? [])
    .filter((f) => f.kind === "reserve")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);

  const opMonths = cashByMonth(cash, "operating").filter((m) => m.key < currentMonth);
  const recentOutflows = opMonths.slice(-6).map((m) => m.outCents).filter((c) => c > 0);
  const avgOutflow = recentOutflows.length > 0 ? recentOutflows.reduce((s, c) => s + c, 0) / recentOutflows.length : 0;
  const runwayMonths = avgOutflow > 0 ? operatingCashCents / avgOutflow : null;

  const reserveMonths = cashByMonth(cash, "reserve").filter((m) => m.key < currentMonth).slice(-3);
  const reserveGrowth =
    reserveMonths.length > 0 ? Math.round(reserveMonths.reduce((s, m) => s + m.netCents, 0) / reserveMonths.length) : null;

  const duesThisMonth = duesRows?.[0];
  const duesCharged = looseCents(duesThisMonth?.charged);
  const duesCollected = looseCents(duesThisMonth?.collected);
  const lateByUnit = new Map<string, { days: number; cents: number }>();
  for (const c of lateCharges ?? []) {
    const cur = lateByUnit.get(c.unit_id) ?? { days: 0, cents: 0 };
    lateByUnit.set(c.unit_id, { days: Math.max(cur.days, c.days_overdue), cents: cur.cents + looseCents(c.balance) });
  }
  const lateUnits = [...lateByUnit.entries()].sort((a, b) => b[1].days - a[1].days);

  const opSpendByMonth = spendByMonth(expenses, operatingFund.id);
  const spentThisMonth = opSpendByMonth.get(currentMonth) ?? 0;
  const firstSpendMonth = [...opSpendByMonth.keys()].sort()[0];
  const priorMonths = firstSpendMonth
    ? monthsBetween(firstSpendMonth, addMonths(currentMonth, -1)).slice(-12)
    : [];
  const typicalMonth = priorMonths.length >= 3 ? median(priorMonths.map((k) => opSpendByMonth.get(k) ?? 0)) : null;

  // ---- Budget vs spent -----------------------------------------------------
  const periodSpend = spendByAccount(expenses, p.startKey, p.endKey, operatingFund.id);
  const periodSpendById = new Map(periodSpend.map((a) => [a.accountId, a.cents]));
  const barRows = [...budgetByAccount.entries()]
    .map(([accountId, annualCents]) => {
      const target = Math.round(annualCents * p.budgetShare);
      const spent = periodSpendById.get(accountId) ?? 0;
      return { accountId, name: accountName.get(accountId) ?? "", spent, target, ...budgetStatus(spent, target) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const unbudgetedSpend = periodSpend.filter((a) => !budgetByAccount.has(a.accountId));
  const furthestOver = barRows.filter((r) => r.status !== "on_track").sort((a, b) => b.pctOver - a.pctOver)[0];
  const totalTarget = barRows.reduce((s, r) => s + r.target, 0);
  const totalSpent = periodSpend.reduce((s, a) => s + a.cents, 0);
  const savedCents = [...transfersInByMonth(cash, "reserve").entries()]
    .filter(([k]) => k >= p.startKey && k <= p.endKey)
    .reduce((s, [, v]) => s + v, 0);

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

  // ---- Donut + comparison -------------------------------------------------
  const allSpend = spendByAccount(expenses, p.startKey, p.endKey);
  const priorSpend = spendByAccount(expenses, addMonths(p.startKey, -12), addMonths(p.endKey, -12));
  const comparison = comparisonSentence(
    allSpend,
    priorSpend,
    (c) => formatMoney(c).replace(/\.00$/, ""),
    period === "month" ? `${monthLongLabel(addMonths(currentMonth, -12))}` : "the same months last year",
  );

  // ---- Coming up -------------------------------------------------------------
  type Upcoming = { key: string; name: string; due: string; payee: string | null; href: string | null; cents: number | null; estimate: boolean; autopay: boolean };
  const upcoming: Upcoming[] = [
    ...(billsSoon ?? []).map((b) => {
      const v = b.vendors as unknown as { id: string; name: string } | null;
      return {
        key: `bill-${b.id}`,
        name: b.name,
        due: b.next_due_on as string,
        payee: v?.name ?? null,
        href: v ? `/contractors/${v.id}` : null,
        cents: b.typical_amount === null ? null : looseCents(b.typical_amount),
        estimate: true,
        autopay: b.autopay_arranged,
      };
    }),
    ...(renewalsSoon ?? []).map((pol) => ({
      key: `ins-${pol.id}`,
      name: "Insurance renewal",
      due: pol.effective_to as string,
      payee: pol.carrier_name,
      href: "/insurance?view=quotes",
      cents: looseCents(pol.annual_premium),
      estimate: true,
      autopay: false,
    })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const upcomingCents = upcoming.reduce((s, u) => s + (u.cents ?? 0), 0);
  const duesDueSoonCents = (duesSoon ?? []).reduce((s, c) => s + looseCents(c.balance), 0);

  // ---- Transactions -----------------------------------------------------------
  const needsCount = tx.needs.length;
  const filteredCategoryName =
    cat === "needs" ? "Needs a category" : cat ? (accountName.get(cat) ?? "that category") : null;

  function describe(t: TxRow): { label: string; tone: "in" | "out" | "move" | "needs" } {
    if (isNeedsCategory(t)) return { label: "Needs a category", tone: "needs" };
    if (t.pending && t.posting_kind === null) return { label: "Pending at the bank", tone: t.amount > 0 ? "in" : "out" };
    if (t.excluded_at) return { label: "Not for the books", tone: "move" };
    if (t.posting_kind === "dues") {
      const unit = t.matched_unit_id ? unitLabel.get(t.matched_unit_id) : null;
      return { label: `Dues${unit ? ` · ${unit}` : ""} · bank deposit`, tone: "in" };
    }
    if (t.posting_kind === "transfer") {
      const toReserve = reserveFund && t.account_id && (accounts ?? []).find((a) => a.id === t.account_id)?.name.match(/reserve/i);
      return { label: toReserve ? "Moved to the reserve" : "Moved between accounts", tone: "move" };
    }
    return { label: accountName.get(t.account_id ?? "") ?? "Categorized", tone: t.amount > 0 ? "in" : "out" };
  }

  const lastSynced = connections?.[0]?.last_synced_at ?? null;
  const pct = (cents: number, of: number) => (of > 0 ? Math.round((cents / of) * 100) : 0);

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="inline-flex rounded-full border border-line bg-paper p-0.5">
          {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
            <Link
              key={k}
              href={hrefFor({ period: k, cat, q })}
              aria-current={k === period ? "page" : undefined}
              className={`inline-flex min-h-[36px] items-center rounded-full px-3.5 text-[12px] font-medium ${
                k === period ? "bg-ink text-paper" : "text-mute hover:text-ink"
              }`}
            >
              {PERIOD_LABEL[k]}
            </Link>
          ))}
        </nav>
        <p className="text-[12px] text-mute">
          {p.label} · {syncedWords(lastSynced, today)}
        </p>
      </div>

      {/* Forecast */}
      {!hasBudget ? (
        <div className="rounded-xl border border-line border-l-[3px] border-l-brass bg-paper px-5 py-4">
          <p className="text-[14px] font-medium text-ink">Set a budget in 5 minutes</p>
          <p className="mt-1 text-[13px] text-mute">
            With a number per category, this page can tell you whether spending is on plan and where the year is heading.
          </p>
          {canEdit ? (
            <a href="#edit-budget" className="mt-2 inline-block text-[13px] font-medium text-ink underline underline-offset-2">
              Set the budget →
            </a>
          ) : null}
        </div>
      ) : !forecast ? (
        <div className="rounded-xl border border-line bg-paper px-5 py-4 text-[13px] text-mute">
          Not enough history for a forecast yet — it needs {MIN_FORECAST_MONTHS} full months of this fiscal year.
        </div>
      ) : (
        (() => {
          const over = forecast.overUnderCents > 0;
          const amount = formatMoney(Math.abs(forecast.overUnderCents)).replace(/\.\d\d$/, "");
          const driver = forecast.driver;
          const onHand = operatingCashCents + reserveCashCents;
          return (
            <div
              className={`rounded-xl border border-line border-l-[3px] bg-paper px-5 py-4 ${over ? "border-l-rust" : "border-l-moss"}`}
            >
              <p className="text-[15px] font-medium text-ink">
                {Math.abs(forecast.overUnderCents) < 100
                  ? "At this pace you'll end the year right on budget."
                  : `At this pace you'll end the year about ${amount} ${over ? "over" : "under"} budget.`}
              </p>
              <p className="mt-1 text-[13px] text-mute">
                {driver
                  ? forecast.driverIsMost
                    ? `${over ? "Almost all of it" : "Most of the room"} is ${driver.name.toLowerCase()}. `
                    : `The biggest single part is ${driver.name.toLowerCase()}. `
                  : ""}
                {over
                  ? forecast.overUnderCents <= operatingCashCents
                    ? "You have the cash on hand to cover it."
                    : forecast.overUnderCents > onHand
                      ? "That's more than the association has on hand, including the reserve — worth a board discussion about whether a special assessment is needed."
                      : "Day-to-day cash wouldn't cover it on its own."
                  : ""}
              </p>
              {driver ? (
                <Link
                  href={hrefFor({ period, cat: driver.accountId }, "#transactions")}
                  className="mt-2 inline-block text-[12px] font-medium text-ink underline underline-offset-2"
                >
                  See the {driver.name.toLowerCase()} spending →
                </Link>
              ) : null}
            </div>
          );
        })()
      )}

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="text-[11px] text-mute">Cash on hand</div>
          <div className="figures mt-1 text-[26px] text-ink">{formatMoney(operatingCashCents)}</div>
          <div className="mt-1 text-[13px] text-mute">
            {runwayMonths !== null
              ? `About ${runwayMonths < 1 ? "less than a month" : `${Math.floor(runwayMonths)} month${Math.floor(runwayMonths) === 1 ? "" : "s"}`} of expenses`
              : "Not enough spending history to say how long it lasts"}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="text-[11px] text-mute">Reserve fund</div>
          <div className="figures mt-1 text-[26px] text-ink">{formatMoney(reserveCashCents)}</div>
          <div className="mt-1 text-[13px] text-mute">
            {reserveGrowth === null || reserveGrowth === 0
              ? "No money moved in or out lately"
              : `${reserveGrowth > 0 ? "Growing" : "Shrinking"} about ${formatMoney(Math.abs(reserveGrowth)).replace(/\.\d\d$/, "")} a month`}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="text-[11px] text-mute">Dues collected this month</div>
          <div className="figures mt-1 text-[26px] text-ink">
            {duesCharged > 0 ? (
              <>
                {formatMoney(duesCollected).replace(/\.00$/, "")}
                <span className="text-[15px] text-mute"> of {formatMoney(duesCharged).replace(/\.00$/, "")}</span>
              </>
            ) : (
              "—"
            )}
          </div>
          <div className="mt-1 text-[13px] text-mute">
            {duesCharged === 0 ? (
              <Link href="/dues" className="underline underline-offset-2">No dues charged this month</Link>
            ) : lateUnits.length === 0 ? (
              "Nobody is late"
            ) : (
              lateUnits.slice(0, 2).map(([unitId, l], i) => (
                <span key={unitId}>
                  {i > 0 ? " · " : ""}
                  <Link href={`/units/${unitId}`} className="text-bad-text underline underline-offset-2">
                    {unitLabel.get(unitId) ?? "A unit"} is {l.days} day{l.days === 1 ? "" : "s"} late
                  </Link>
                </span>
              ))
            )}
            {lateUnits.length > 2 ? ` · and ${lateUnits.length - 2} more` : ""}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-paper px-5 py-4">
          <div className="text-[11px] text-mute">Spent this month</div>
          <div className="figures mt-1 text-[26px] text-ink">{formatMoney(spentThisMonth)}</div>
          <div className="mt-1 text-[13px] text-mute">
            {typicalMonth === null
              ? "Not enough history for a typical month yet"
              : spentThisMonth > typicalMonth
                ? `${formatMoney(spentThisMonth - typicalMonth).replace(/\.\d\d$/, "")} more than a typical month (${formatMoney(typicalMonth).replace(/\.\d\d$/, "")})`
                : `A typical month is ${formatMoney(typicalMonth).replace(/\.\d\d$/, "")}`}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[7fr_5fr]">
        {/* Budget vs spent */}
        <Card title="Budget vs. spent" hint={hasBudget ? p.budgetCaption : undefined}>
          {!hasBudget ? (
            <Empty>No budget set for {fiscalYear.label} yet — the bars appear once there is one.</Empty>
          ) : (
            <>
              <ul className="space-y-1">
                {barRows.map((r) => {
                  const style = STATUS_STYLE[r.status];
                  const highlight = furthestOver?.accountId === r.accountId;
                  return (
                    <li key={r.accountId}>
                      <Link
                        href={hrefFor({ period, cat: r.accountId }, "#transactions")}
                        className={`block rounded-lg px-2 py-2 hover:bg-fill ${highlight ? "bg-bad-tint/60" : ""}`}
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium text-ink">{r.name}</span>
                          <span className="text-[12px]">
                            <span className="figures text-ink">
                              {formatMoney(r.spent).replace(/\.00$/, "")} of {formatMoney(r.target).replace(/\.00$/, "")}
                            </span>
                            <span className={`ml-2 font-medium ${style.text}`}>
                              {r.status === "on_track" ? style.word : `${r.pctOver}% over`}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1.5 h-3 overflow-hidden rounded-md bg-fill">
                          <div
                            className={`h-full rounded-md ${style.bar}`}
                            style={{ width: `${Math.min(100, pct(r.spent, r.target))}%` }}
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
                {unbudgetedSpend.length > 0 ? (
                  <li className="px-2 py-2 text-[12px] text-mute">
                    Also spent with no budget set:{" "}
                    {unbudgetedSpend.map((a, i) => (
                      <span key={a.accountId}>
                        {i > 0 ? ", " : ""}
                        <Link href={hrefFor({ period, cat: a.accountId }, "#transactions")} className="underline underline-offset-2">
                          {a.name} {formatMoney(a.cents).replace(/\.00$/, "")}
                        </Link>
                      </span>
                    ))}
                  </li>
                ) : null}
                <li className="px-2 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">Moved to the reserve</span>
                    <span className="text-[12px]">
                      <span className="figures text-ink">{formatMoney(savedCents).replace(/\.00$/, "")}</span>
                      <span className={`ml-2 font-medium ${STATUS_STYLE.saved.text}`}>Saved</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-3 overflow-hidden rounded-md bg-fill">
                    <div className={`h-full rounded-md ${STATUS_STYLE.saved.bar}`} style={{ width: savedCents > 0 ? "100%" : "0%" }} />
                  </div>
                  <p className="mt-1 text-[11px] text-mute-soft">Savings, not spending — never counted as over budget.</p>
                </li>
              </ul>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
                <span className="text-[13px] font-medium text-ink">Total spending</span>
                <span className="text-[13px]">
                  <span className="figures text-ink">
                    {formatMoney(totalSpent).replace(/\.00$/, "")} of {formatMoney(totalTarget).replace(/\.00$/, "")}
                  </span>
                  <span className={`ml-2 font-medium ${totalSpent > totalTarget ? "text-bad-text" : "text-good-text"}`}>
                    {formatMoney(Math.abs(totalSpent - totalTarget)).replace(/\.00$/, "")} {totalSpent > totalTarget ? "over" : "under"}
                  </span>
                </span>
              </div>
              <p className="mt-2 text-[11px] text-mute-soft">
                On track: at or under the target · Watch: up to 10% over · Over budget: more than 10% over.
              </p>
            </>
          )}
        </Card>

        {/* Where the money went */}
        <Card title="Where the money went" hint="Moves to the reserve aren't included — they're savings, not spending.">
          {allSpend.length === 0 ? (
            <Empty>No spending recorded for {p.label.toLowerCase()} yet.</Empty>
          ) : (
            <>
              <DonutChart
                slices={allSpend.map((a) => ({
                  label: a.name,
                  valueCents: a.cents,
                  href: hrefFor({ period, cat: a.accountId }, "#transactions"),
                }))}
                maxSlices={6}
                minShare={0.05}
                showPercent
                centerLabel={formatMoney(allSpend.reduce((s, a) => s + a.cents, 0)).replace(/\.\d\d$/, "")}
                ariaLabel={`Spending by category for ${p.label}.`}
              />
              {comparison ? <p className="mt-3 text-[12px] text-mute">{comparison}</p> : null}
            </>
          )}
        </Card>
      </div>

      {/* Coming up */}
      <Card title="Coming up in the next 30 days" hint="Known bills and renewals.">
        {upcoming.length === 0 ? (
          <div className="space-y-3 text-[13px] text-mute">
            <p>
              Nothing known is due in the next 30 days. Bills show up here once they&rsquo;re added — a utility, a contract,
              the insurance renewal — with when they&rsquo;re next due.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((u) => (
              <li key={u.key} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 text-[13px]">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{u.name}</span>
                  <span className="ml-2 text-mute">
                    due {new Date(`${u.due}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {u.payee ? (
                      <>
                        {" · "}
                        {u.href ? (
                          <Link href={u.href} className="underline underline-offset-2">{u.payee}</Link>
                        ) : (
                          u.payee
                        )}
                      </>
                    ) : null}
                    {u.autopay ? " · on autopay" : ""}
                  </span>
                  {u.key.startsWith("ins-") ? (
                    <Link href="/insurance?view=quotes" className="ml-2 text-[12px] font-medium text-ink underline underline-offset-2">
                      Get quotes
                    </Link>
                  ) : null}
                </div>
                <span className="figures text-ink">
                  {u.cents === null ? "amount varies" : `${u.estimate ? "about " : ""}${formatMoney(u.cents).replace(/\.00$/, "")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {upcoming.length > 0 ? (
          <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink">
            After these, about {formatMoney(operatingCashCents - upcomingCents).replace(/\.\d\d$/, "")} left in day-to-day cash
            {duesDueSoonCents > 0 ? `, plus ${formatMoney(duesDueSoonCents).replace(/\.\d\d$/, "")} in dues due in the same 30 days` : ""}.
          </p>
        ) : null}
        {canEdit ? (
          <div className="mt-4">
            <AddBillForm
              categories={expenseAccounts.map((a) => ({ id: a.id, name: a.name }))}
              contractors={(contractors ?? []).map((c) => ({ id: c.id, name: c.name }))}
            />
          </div>
        ) : null}
      </Card>

      {/* Transactions */}
      <section id="transactions" className="rounded-xl border border-line bg-paper">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-bold tracking-tight text-ink">
            Transactions
            {needsCount > 0 ? (
              <span className="ml-2 rounded-full bg-rust px-2 py-0.5 align-middle text-[11px] font-medium text-paper">
                {needsCount} need{needsCount === 1 ? "s" : ""} a category
              </span>
            ) : null}
          </h2>
          <a
            href={`/budget/export?${new URLSearchParams({ period, ...(cat ? { cat } : {}), ...(q ? { q } : {}) }).toString()}`}
            className="inline-flex min-h-[36px] items-center rounded-md border border-line-strong px-3 text-[12px] font-medium text-ink hover:bg-fill"
          >
            Export to Excel
          </a>
        </header>
        <div className="px-5 py-4">
          <form method="get" action="/budget#transactions" className="mb-4 flex flex-wrap items-end gap-2">
            {period !== "year" ? <input type="hidden" name="period" value={period} /> : null}
            <div>
              <label htmlFor="tx-cat" className="block text-[12px] font-medium text-ink">Category</label>
              <select
                id="tx-cat"
                name="cat"
                defaultValue={cat ?? ""}
                className="mt-1 min-h-[40px] rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink"
              >
                <option value="">All</option>
                <option value="needs">Needs a category ({needsCount})</option>
                {(accounts ?? [])
                  .filter((a) => a.type === "expense" || a.type === "income")
                  .map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
              </select>
            </div>
            <div className="min-w-[12rem] flex-1">
              <label htmlFor="tx-q" className="block text-[12px] font-medium text-ink">Search</label>
              <input
                id="tx-q"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Who it was paid to, or an amount"
                className="mt-1 min-h-[40px] w-full rounded-lg border border-line-strong bg-paper px-3 text-[13px] text-ink"
              />
            </div>
            <button type="submit" className="min-h-[40px] rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill">
              Filter
            </button>
            {cat || q ? (
              <Link href={hrefFor({ period }, "#transactions")} className="min-h-[40px] px-2 py-2.5 text-[12px] text-mute underline underline-offset-2">
                Clear
              </Link>
            ) : null}
          </form>

          {filteredCategoryName ? (
            <p className="mb-2 text-[12px] text-mute">Showing: {filteredCategoryName}</p>
          ) : null}

          {needsCount === 0 && cat !== "needs" && tx.rows.length > 0 ? (
            <p className="mb-2 text-[12px] text-good-text">Everything is categorized.</p>
          ) : null}

          {tx.needs.length === 0 && tx.rows.length === 0 ? (
            <Empty>No transactions for {p.label.toLowerCase()}{cat || q ? " match this filter" : ""}.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-mute">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Paid to / from</th>
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                    <th className="pb-2 text-right font-medium">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...tx.needs, ...tx.rows].map((t) => {
                    const d = describe(t);
                    const needs = d.tone === "needs";
                    return (
                      <tr key={t.id} className={needs ? "bg-warning-tint" : undefined}>
                        <td className="figures py-2 pr-3 align-top text-ink">{t.posted_on}</td>
                        <td className="py-2 pr-3 align-top text-ink">{t.description}</td>
                        <td className={`py-2 pr-3 align-top ${needs ? "font-medium text-warning-text" : "text-mute"}`}>{d.label}</td>
                        <td
                          className={`figures py-2 pr-3 text-right align-top ${
                            t.amount > 0 && d.tone === "in" ? "text-good-text" : "text-ink"
                          }`}
                        >
                          {t.amount > 0 ? "+" : "−"}
                          {formatMoney(Math.round(Math.abs(t.amount) * 100))}
                        </td>
                        <td className="py-2 text-right align-top">
                          {needs && canEdit && t.amount < 0 ? (
                            <CategorizeMenu
                              transactionId={t.id}
                              description={t.description}
                              categories={expenseAccounts.map((a) => ({ id: a.id, name: a.name }))}
                            />
                          ) : needs ? (
                            <Link href="/bank-feed?status=needs" className="text-[12px] font-medium text-ink underline underline-offset-2">
                              {t.amount > 0 ? "Categorize on the bank feed" : "Categorize"}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {tx.hasMore ? (
            <div className="mt-4">
              <Link
                href={hrefFor({ period, cat, q, show: show + PAGE_SIZE }, "#transactions")}
                className="inline-flex min-h-[44px] items-center rounded-md border border-line-strong px-4 text-[13px] text-ink hover:bg-fill"
              >
                Show earlier transactions
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {editBudgetCard(
        !hasBudget && canEdit && priorFy
          ? (() => {
              const lines = spendByAccount(
                expenses,
                `${priorFy.starts_on.slice(0, 7)}-01`,
                `${priorFy.ends_on.slice(0, 7)}-01`,
                operatingFund.id,
              ).filter((l) => expenseAccounts.some((a) => a.id === l.accountId));
              return lines.length > 0 ? (
                <div className="mb-4">
                  <SuggestedBudget
                    associationId={association.id}
                    fiscalYearId={fiscalYear.id}
                    fundId={operatingFund.id}
                    priorLabel={priorFy.label}
                    lines={lines.map((l) => ({ accountId: l.accountId, name: l.name, amountCents: l.cents }))}
                  />
                </div>
              ) : null;
            })()
          : null,
      )}
    </div>
  );
}
