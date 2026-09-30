import { createClient, getUser } from "@/lib/supabase/server";
import { Empty, money, moneyRounded } from "@/components/ui";
import { toCents } from "@/lib/tax/form1120h";
import { assembleReminders, nextOccurrence } from "@/lib/home/reminders";
import { urgentItems } from "@/lib/home/urgent-items";
import {
  buildSetupGuide,
  countSteps,
  isSetupComplete,
  nextStep,
  openSteps,
} from "@/lib/home/setup-guide";
import { Greeting } from "@/components/home/greeting";
import { SetupGuidePanel } from "@/components/home/setup-guide-panel";
import { cashByMonth } from "@/lib/money/cash";
import { dueDate } from "@/lib/tax/due-rules";
import { spendByAccount } from "@/lib/money/spending";
import { dateOfKey, monthLongLabel, monthShortLabel } from "@/lib/money/months";
import { WorthAMinute } from "@/components/home/worth-a-minute";
import { Standing } from "@/components/home/standing";
import { YourList, type ManualTask } from "@/components/home/your-list";
import {
  ShowcaseCards,
  type CashCardData,
  type InOutCardData,
  type SpendingCardData,
} from "@/components/home/showcase-cards";
import { ComingUp } from "@/components/home/coming-up";
import { Building, type BuildingUnit } from "@/components/home/building";

export const dynamic = "force-dynamic";

// Display-only figures that arrive as JSON numbers (14,2) from the older
// views. Anything from the 0017 views arrives as text and goes through the
// strict toCents instead (DECISIONS #20).
const looseCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);


export default async function HomePage() {
  const supabase = await createClient();
  const user = await getUser();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [
    { data: associations },
    { data: fiscalYears },
    { data: funds },
    { data: units },
    { data: totals },
    { data: unitOwners },
    { data: bankConnections },
    { data: policies },
    { data: vendors },
    { data: setupDocuments },
    { data: unitRows },
    { data: roleGrants },
    { count: inviteCount },
    { data: budgetLines },
    { count: scheduleCount },
    { data: taxFilings },
    { count: uncategorizedCount },
    { count: postedEntryCount },
    { data: bills },
    { data: futureCharges },
    { data: aging },
    { data: persons },
    { data: boardTasks },
    { data: cashActivity },
    { data: duesCollection },
    { data: spendingRows },
    { data: budgetRows },
  ] = await Promise.all([
    supabase
      .from("associations")
      .select(
        "id, display_name, state_code, fiscal_year_end_month, incorporated_on, reserve_target, ein, city, county, dues_payee_name, dues_account_number, dues_zelle_handle, setup_dismissed_at",
      ),
    supabase.from("fiscal_years").select("id, label, ends_on").order("starts_on", { ascending: false }).limit(1),
    supabase
      .from("fund_cash_balances")
      .select("fund_id, name, kind, cash_balance, visible_lines")
      .order("name"),
    supabase
      .from("unit_balances")
      .select("unit_id, label, balance_owed, visible_charges")
      .order("sort_order"),
    supabase
      .from("association_totals")
      .select("visible_tb_rows, total_debits, total_credits, total_owed, units_behind"),
    supabase.from("unit_owners").select("unit_id, effective_from, effective_to, persons(full_name)"),
    supabase.from("bank_connections").select("id, status, created_at, last_synced_at"),
    supabase
      .from("insurance_policies")
      .select("coverage, effective_from, effective_to, renewal_reminder_days")
      .is("replaced_at", null),
    supabase.from("vendors").select("id, w9_on_file, w9_received_on, is_1099_exempt"),
    supabase
      .from("documents")
      .select("uploaded_at, document_categories(slug)")
      .is("deleted_at", null)
      .eq("is_current_version", true),
    supabase.from("units").select("id"),
    supabase.from("role_grants").select("person_id, granted_on, revoked_at, expires_on"),
    supabase.from("invites").select("id", { count: "exact", head: true }),
    supabase.from("budget_lines").select("id, budgets(fiscal_year_id)"),
    supabase.from("assessment_schedules").select("id", { count: "exact", head: true }),
    supabase.from("tax_filings").select("fiscal_year_id, computed_at").eq("form", "1120-H"),
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .is("posting_kind", null)
      .is("journal_entry_id", null)
      .is("excluded_at", null)
      .is("removed_at", null)
      .eq("pending", false),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("is_posted", true),
    supabase.from("upcoming_bills").select("name, next_due_on, autopay_arranged"),
    supabase
      .from("charge_balances")
      .select("due_on")
      .in("status", ["open", "partial"])
      .gt("due_on", todayIso)
      .order("due_on")
      .limit(50),
    supabase
      .from("delinquency_aging")
      .select("label, days_1_30, days_31_60, days_60_plus, total_owed"),
    supabase.from("persons").select("id, full_name, auth_user_id"),
    supabase
      .from("board_tasks")
      .select("id, title, completed_at, owner_person_id")
      .order("created_at"),
    supabase
      .from("monthly_cash_activity")
      .select("month, fund_kind, inflow, outflow, transfer_inflow, transfer_outflow")
      .order("month"),
    supabase
      .from("monthly_dues_collection")
      .select("month, charge_count, charged, collected, collected_on_time")
      .order("month"),
    supabase
      .from("monthly_expense_actuals")
      .select("month, account_id, account_name, fund_id, total")
      .order("month"),
    supabase.from("budget_vs_actual").select("type, variance"),
  ]);

  const association = associations?.[0];
  if (!association) {
    return <Empty>No association is visible to you.</Empty>;
  }

  const t = totals?.[0];
  const booksVisible = (t?.visible_tb_rows ?? 0) > 0;
  const tbDebitCents = looseCents(t?.total_debits ?? 0);
  const booksBalanced = booksVisible && tbDebitCents === looseCents(t?.total_credits ?? 0);
  const owedCents = looseCents(t?.total_owed ?? 0);
  const behind = Number(t?.units_behind ?? 0);
  const fyLabel = fiscalYears?.[0]?.label ?? String(new Date().getFullYear());

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // The building's clock, not the server's: Vercel runs on UTC, and the one
  // state on record is Illinois. Central time is the honest default.
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: association.state_code === "IL" ? "America/Chicago" : "UTC",
    }).format(new Date()),
  );

  // --------------------------------------------------------------------------
  // People
  // --------------------------------------------------------------------------
  const me = (persons ?? []).find((p) => p.auth_user_id === user?.id);
  const firstName = me?.full_name.split(" ")[0] ?? user?.email?.split("@")[0] ?? "there";

  const personName = new Map((persons ?? []).map((p) => [p.id, p.full_name]));
  const ownerName = new Map<string, string>();
  for (const o of unitOwners ?? []) {
    const p = o.persons as unknown as { full_name: string } | null;
    if (p) ownerName.set(o.unit_id, p.full_name);
  }

  const statusLine = !booksVisible
    ? "No financial activity has been recorded yet."
    : behind > 0
      ? `${moneyRounded(owedCents / 100)} is owed across ${behind} unit${behind === 1 ? "" : "s"}. Everything else looks in order.`
      : "Every unit is current and nothing is overdue.";

  // --------------------------------------------------------------------------
  // Worth a minute today
  // --------------------------------------------------------------------------
  const activePolicies = (policies ?? []).filter(
    (p) => new Date(`${p.effective_to}T00:00:00`) >= today,
  );
  const soonestExpiry = activePolicies
    .map((p) => new Date(`${p.effective_to}T00:00:00`))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const vendorsMissingW9 = (vendors ?? []).filter(
    (v) => !v.w9_on_file && !v.is_1099_exempt,
  ).length;

  // Safe to call regardless of booksVisible — urgentItems only raises the
  // "books don't match" item when booksVisible is true itself; every other
  // check (delinquency, W-9s, insurance, bank connection) doesn't depend on
  // any activity having been posted yet.
  const urgent = urgentItems({
    booksVisible,
    booksBalance: booksBalanced,
    aging: aging ?? [],
    vendorsMissingW9,
    nec1099Due: nextOccurrence(1, 31, today),
    insuranceExpiry: soonestExpiry ?? null,
    bankConnected: (bankConnections ?? []).some((c) => c.status === "active"),
    today,
  });

  // --------------------------------------------------------------------------
  // Standing + checklist
  // --------------------------------------------------------------------------
  const visibleFunds = (funds ?? []).filter((f) => f.visible_lines > 0);
  const operatingCents = visibleFunds
    .filter((f) => f.kind === "operating")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);
  const reserveCents = visibleFunds
    .filter((f) => f.kind === "reserve")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);
  const totalCents = visibleFunds.reduce((s, f) => s + looseCents(f.cash_balance), 0);

  // Setting a reserve target is governance, not a books-derived figure —
  // available regardless of whether anything's been posted yet.
  const { data: isAdmin } = await supabase.rpc("has_role_in", {
    assoc: association.id,
    roles: ["board_admin"],
  });
  const canSetTarget = isAdmin === true;

  // None of these inputs require any posted activity either.
  const currentFyId = fiscalYears?.[0]?.id ?? null;
  const setupSections = buildSetupGuide({
    today,
    association,
    units: unitRows ?? [],
    unitOwners: unitOwners ?? [],
    persons: persons ?? [],
    roleGrants: roleGrants ?? [],
    myPersonId: me?.id ?? null,
    inviteCount: inviteCount ?? 0,
    bankConnections: bankConnections ?? [],
    uncategorizedCount: uncategorizedCount ?? 0,
    postedEntryCount: postedEntryCount ?? 0,
    budgetLineCount: (budgetLines ?? []).filter(
      (l) => (l.budgets as unknown as { fiscal_year_id: string } | null)?.fiscal_year_id === currentFyId,
    ).length,
    assessmentScheduleCount: scheduleCount ?? 0,
    taxFilingComputedAt:
      (taxFilings ?? []).find((f) => f.fiscal_year_id === currentFyId && f.computed_at)?.computed_at ?? null,
    policies: policies ?? [],
    vendors: vendors ?? [],
    documents: (setupDocuments ?? []).map((d) => ({
      uploaded_at: d.uploaded_at,
      category_slug: (d.document_categories as unknown as { slug: string } | null)?.slug ?? null,
    })),
  });
  const setupCounts = countSteps(setupSections);
  const showSetupGuide =
    canSetTarget && !isSetupComplete(setupSections) && association.setup_dismissed_at === null;
  const derived = openSteps(setupSections);

  const manual: ManualTask[] = (boardTasks ?? []).map((task) => ({
    id: task.id,
    title: task.title,
    completedAt: task.completed_at,
    ownerName: task.owner_person_id ? (personName.get(task.owner_person_id) ?? null) : null,
    isYou: task.owner_person_id === me?.id,
  }));

  // --------------------------------------------------------------------------
  // Charts. All 0017-view money is text → strict cents (DECISIONS #20).
  // --------------------------------------------------------------------------
  // Shared with Budget & spending (src/lib/money) so the two pages can't
  // disagree. Transfers between the association's own accounts are excluded
  // from "in" and "out" but still carried in the balance.
  let cash: CashCardData | null = null;
  let inOut: InOutCardData | null = null;
  const series = cashByMonth(cashActivity ?? []);

  if (series.length > 0) {
    const window = series.slice(-12);
    const beforeWindowCents =
      window.length < series.length ? series[series.length - window.length - 1].balanceCents : 0;
    const sinceLabel = `Since ${monthLongLabel(window[0].key, dateOfKey(window[0].key).getFullYear() !== today.getFullYear())}`;

    cash = {
      points: window.map((s) => ({ label: monthShortLabel(s.key), valueCents: s.balanceCents })),
      netChangeCents: window[window.length - 1].balanceCents - beforeWindowCents,
      sinceLabel,
    };

    // Spending by month, for shortfall captions.
    const topSpendByMonth = new Map<string, { name: string; cents: number }>();
    for (const month of new Set((spendingRows ?? []).map((r) => r.month))) {
      const top = spendByAccount(spendingRows ?? [], month, month)[0];
      if (top) topSpendByMonth.set(month, { name: top.name, cents: top.cents });
    }

    let varianceCents: number | null = null;
    const expenseBudgetRows = (budgetRows ?? []).filter((r) => r.type === "expense");
    if (expenseBudgetRows.length > 0) {
      varianceCents = expenseBudgetRows.reduce((s, r) => s + looseCents(r.variance), 0);
    }

    inOut = {
      groups: window.slice(-6).map((s) => {
        const shortfall = s.outCents > s.inCents;
        const top = topSpendByMonth.get(s.key);
        return {
          label: monthShortLabel(s.key),
          aCents: s.inCents,
          bCents: s.outCents,
          shortfall,
          caption: shortfall && top ? `mostly ${top.name}` : null,
        };
      }),
      varianceCents,
      fiscalYearLabel: fyLabel,
    };
  }

  let spending: SpendingCardData | null = null;
  if ((spendingRows ?? []).length > 0) {
    const months = [...new Set((spendingRows ?? []).map((r) => r.month))].sort();
    const byAccount = spendByAccount(spendingRows ?? [], months[0], months[months.length - 1]);
    const totalSpendCents = byAccount.reduce((s, a) => s + a.cents, 0);
    spending = {
      slices: byAccount.map((a) => ({ label: a.name, valueCents: a.cents })),
      avgMonthlyCents: Math.round(totalSpendCents / months.length),
      sinceLabel: `Since ${monthLongLabel(months[0], dateOfKey(months[0]).getFullYear() !== today.getFullYear())}`,
    };
  }

  const reserveTarget = association.reserve_target as number | null;

  // --------------------------------------------------------------------------
  // Coming up + the building
  // --------------------------------------------------------------------------
  // Compliance/bill deadlines don't depend on any activity having been posted.
  let lastAccessReviewAt: string | null | undefined;
  if (canSetTarget) {
    const { data: lastReview } = await supabase
      .from("access_reviews")
      .select("reviewed_at")
      .order("reviewed_at", { ascending: false })
      .limit(1);
    lastAccessReviewAt = lastReview?.[0]?.reviewed_at ?? null;
  }

  // Tax deadlines from verified official-form templates, when they exist.
  const [{ data: dueTemplates }, { data: w9Gaps }] = await Promise.all([
    supabase
      .from("tax_form_templates")
      .select("form_code, tax_year, due_rule")
      .eq("active", true)
      .in("form_code", ["irs_1120h", "irs_1099_nec", "il_sos_annual_report"]),
    supabase
      .from("vendor_1099_calendar_totals")
      .select("vendor_id")
      .eq("calendar_year", today.getFullYear())
      .eq("w9_on_file", false),
  ]);
  const fyEndsOn = fiscalYears?.[0]?.ends_on ?? null;
  const verifiedTaxDeadlines: Partial<Record<"irs_1120h" | "irs_1099_nec" | "il_sos_annual_report", string>> = {};
  for (const t of dueTemplates ?? []) {
    const due = dueDate(t.due_rule, {
      fiscalYearEnd: t.form_code === "irs_1120h" ? fyEndsOn : null,
      calendarYear: t.form_code === "irs_1099_nec" ? t.tax_year : null,
      incorporatedOn: association.incorporated_on,
      today,
    });
    const matchesYear =
      t.form_code === "il_sos_annual_report" ||
      (t.form_code === "irs_1120h" && fyEndsOn?.startsWith(String(t.tax_year))) ||
      t.form_code === "irs_1099_nec";
    if (due && matchesYear) verifiedTaxDeadlines[t.form_code as keyof typeof verifiedTaxDeadlines] = due;
  }

  const reminders = assembleReminders({
    association,
    bills: bills ?? [],
    policies: policies ?? [],
    upcomingChargeDates: (futureCharges ?? []).map((c) => c.due_on as string),
    today,
    lastAccessReviewAt,
    verifiedTaxDeadlines,
    contractorsMissingW9: (w9Gaps ?? []).length,
  });

  const buildingUnits: BuildingUnit[] = (units ?? []).map((u) => {
    const name = ownerName.get(u.unit_id) ?? null;
    const owed = looseCents(u.balance_owed);
    const status: BuildingUnit["status"] =
      u.visible_charges === 0 && !booksVisible
        ? "hidden"
        : !name
          ? "vacant"
          : owed > 0
            ? "behind"
            : "current";
    return {
      id: u.unit_id,
      label: u.label,
      ownerName: name,
      status,
      owedLabel: status === "behind" ? `owes ${money(u.balance_owed)}` : null,
    };
  });

  const latestDues = (duesCollection ?? []).at(-1);
  const currentCount = buildingUnits.filter((u) => u.status === "current").length;
  const duesLine =
    booksVisible && latestDues && toCents(latestDues.charged) > 0
      ? `Dues run ${money(toCents(latestDues.charged) / 100)} a month · ${currentCount} of ${buildingUnits.length} units current.`
      : null;

  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <Greeting
        firstName={firstName}
        statusLine={statusLine}
        hour={hour}
        books={booksVisible ? { visible: true, balanced: booksBalanced } : null}
      />

      {urgent.length > 0 ? (
        <WorthAMinute items={urgent} />
      ) : booksVisible ? (
        <p className="rounded-lg border border-good-line bg-good-tint px-4 py-2.5 text-[13px] text-good-text">
          Nothing needs you today. The books balance and every unit is current.
        </p>
      ) : (
        <p className="rounded-lg border border-line bg-fill px-4 py-2.5 text-[13px] text-mute">
          Nothing to flag yet — no activity has been recorded.
        </p>
      )}

      <div
        className={`grid items-start gap-4 lg:grid-cols-[3fr_2fr] ${showSetupGuide ? "lg:items-stretch" : ""}`}
      >
        <Standing
          totalCents={totalCents}
          operatingCents={operatingCents}
          reserveCents={reserveCents}
          reserveTarget={reserveTarget}
          booksBalanced={booksBalanced}
          tbTotalCents={tbDebitCents}
          canSetTarget={canSetTarget}
          hasActivity={booksVisible}
          matchSetupGuide={showSetupGuide}
        />
        {showSetupGuide ? (
          <SetupGuidePanel
            sections={setupSections}
            activeStepKey={nextStep(setupSections)?.key ?? null}
            done={setupCounts.done}
            total={setupCounts.total}
          />
        ) : (
          <YourList
            derived={derived}
            derivedDoneCount={setupCounts.done}
            manual={manual}
            persons={(persons ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))}
          />
        )}
      </div>

      <ShowcaseCards cash={cash} inOut={inOut} spending={spending} />

      <div className="grid items-start gap-4 lg:grid-cols-[3fr_2fr]">
        {reminders.length > 0 ? <ComingUp reminders={reminders} today={today} /> : null}
        <Building units={buildingUnits} duesLine={duesLine} />
      </div>
    </div>
  );
}
