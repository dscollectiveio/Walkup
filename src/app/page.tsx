import { createClient, getUser } from "@/lib/supabase/server";
import { Empty, money, moneyRounded } from "@/components/ui";
import { toCents } from "@/lib/tax/form1120h";
import { assembleReminders, homeTaxDeadlines, nextFilingReminder, nextOccurrence } from "@/lib/home/reminders";
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
import { buildingTodayIso, todayIso as localIso } from "@/lib/dates";
import { defaultContractorYear, parametersAsOf } from "@/app/tax/data";
import { buildSnapshot } from "@/lib/home/snapshot";
import { spendByAccount } from "@/lib/money/spending";
import { addMonths, monthKey, monthKeyOf, monthsBetween } from "@/lib/money/months";
import { bankMonths, loadBankCash } from "@/lib/bank/position";
import { getConnectionBalance } from "@/app/bank-feed/balances";
import { buildPlanRows, overBudgetAlerts } from "@/lib/money/plan";
import { dateOfKey, monthLongLabel, monthShortLabel } from "@/lib/money/months";
import { WorthAMinute } from "@/components/home/worth-a-minute";
import { AnnouncementsStrip } from "@/components/home/announcements-strip";
import { loadAnnouncements } from "@/lib/owner/load";
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
import { Landing } from "@/components/landing/landing";
import { Card } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/client";
import { complianceFor, usedRecently } from "@/lib/contractors/compliance";
import { tradeBySlug } from "@/lib/contractors/trades";
import { finishedRuns } from "@/lib/home/finished-runs";
import { renewalFor, withStatus } from "@/lib/insurance/status";
import { loadInsuranceBanners } from "@/lib/insurance/queries";
import { loadEmergencyInfo } from "@/lib/repairs/page-data";
import { possibleEmergency } from "@/lib/repairs/today";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/owner/viewer";
import { SHARE_DESCRIPTION, SHARE_TITLE, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/lib/site-config";
import type { Metadata } from "next";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

// Display-only figures that arrive as JSON numbers (14,2) from the older
// views. Anything from the 0017 views arrives as text and goes through the
// strict toCents instead (DECISIONS #20).
const looseCents = (v: string | number | null) => Math.round(Number(v ?? 0) * 100);


// The public face of the main URL: signed-out visitors get the landing page,
// signed-in people their Dashboard. Search engines only ever see the former.
export async function generateMetadata(): Promise<Metadata> {
  const user = await getUser();
  if (user) return { title: "Dashboard | Walkup" };
  // Search results use the keyword title; link previews use the shorter hook. The share image is src/app/opengraph-image.tsx.
  return {
    alternates: { canonical: "/" },
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    openGraph: {
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
      url: SITE_URL,
      siteName: "Walkup",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: SHARE_TITLE,
      description: SHARE_DESCRIPTION,
    },
  };
}

export default async function HomePage() {
  const user = await getUser();
  if (!user) return <Landing nonce={(await headers()).get("x-nonce") ?? undefined} />;
  // Owners who are not on the board or the accountant have their own Home
  // (owner-portal-spec 2.2). getViewer() is null for a person with no record
  // or a session that is not two-step yet; they fall through as before.
  const viewer = await getViewer();
  if (viewer && !viewer.isStaff) redirect("/owner");
  const supabase = await createClient();
  // The building's calendar day (America/Chicago), never the server's: Vercel
  // runs on UTC, so at 8pm in Chicago on Oct 31 the server already says Nov 1.
  // Every computed status on Home uses this one day.
  const buildingToday = buildingTodayIso();
  const todayIso = buildingToday;
  const todayLocal = buildingToday;
  // 1099s are prepared in January and February for the year just ended; the
  // rest of the year looks at the current one (the Taxes tab's rule).
  const contractorYear = defaultContractorYear(buildingToday);

  const [
    { data: associations },
    { data: fiscalYears },
    { data: funds, error: fundsError },
    { data: units },
    { data: totals, error: totalsError },
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
    { data: taxTemplates },
    { data: taxForms },
    { data: thresholdRows },
    { data: contractorTotals },
    { count: announcementCount },
    { data: importBatches },
    { data: emailSettings },
  ] = await Promise.all([
    supabase
      .from("associations")
      .select(
        "id, display_name, state_code, fiscal_year_end_month, incorporated_on, reserve_target, ein, city, county, dues_payee_name, dues_account_number, dues_zelle_handle, setup_dismissed_at, information_returns_filing, accountant_person_id, board_contact_name, board_contact_email",
      ),
    // Every year, newest first: [0] is the latest, and the tax deadlines pick
    // the one whose return is next to file from the whole list.
    supabase.from("fiscal_years").select("id, label, starts_on, ends_on").order("starts_on", { ascending: false }),
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
    supabase.from("bank_connections").select("id, status, institution_name, created_at, last_synced_at"),
    // Every policy that isn't archived: status is computed (lib/insurance/status),
    // so a legacy replaced row is handled there, not filtered here.
    supabase
      .from("insurance_policies")
      .select("id, coverage, effective_from, effective_to, renewal_reminder_days, replaced_by_policy_id, replaced_at, archived_at")
      .is("archived_at", null),
    supabase
      .from("vendors")
      .select(
        "id, name, w9_on_file, w9_received_on, is_1099_exempt, insured_until, status, license_number, license_expires_on, archived_at, trades, last_used_on",
      ),
    supabase
      .from("documents")
      .select("uploaded_at, document_categories(slug)")
      .is("deleted_at", null)
      .eq("is_current_version", true),
    supabase.from("units").select("id"),
    supabase.from("role_grants").select("person_id, role, granted_on, revoked_at, expires_on"),
    supabase.from("invites").select("id", { count: "exact", head: true }),
    supabase.from("budget_lines").select("id, budgets(fiscal_year_id)"),
    supabase.from("assessment_schedules").select("id", { count: "exact", head: true }),
    supabase.from("tax_filings").select("fiscal_year_id, computed_at, locked_at").eq("form", "1120-H"),
    supabase
      .from("bank_transactions")
      .select("id", { count: "exact", head: true })
      .is("posting_kind", null)
      .is("journal_entry_id", null)
      .is("excluded_at", null)
      .is("removed_at", null)
      .eq("pending", false),
    supabase.from("journal_entries").select("id", { count: "exact", head: true }).eq("is_posted", true),
    // The table rather than the 0013 view, which has no paused_at (0053).
    supabase.from("recurring_bills").select("name, next_due_on, autopay_arranged, paused_at").eq("is_active", true),
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
    supabase.from("budget_vs_actual").select("fiscal_year_id, type, variance, account_id, fund_id, name, budgeted"),
    // The tax deadlines (lib/tax/deadlines) are built from these rows alone —
    // Home never loads the full tax context.
    supabase
      .from("tax_form_templates")
      .select("form_code, tax_year, due_rule, due_rule_citation, notes, verified_at, active")
      .eq("active", true),
    supabase
      .from("tax_forms")
      .select("id, form_code, tax_year, vendor_id, fiscal_year_id, status, filed_on, sent_to_accountant_at"),
    supabase
      .from("tax_parameters")
      .select("numeric_value, effective_from, effective_to")
      .eq("key", "form_1099_nec_threshold"),
    supabase
      .from("vendor_1099_calendar_totals")
      .select("vendor_id, name, total_paid, w9_on_file")
      .eq("calendar_year", contractorYear),
    // Owner portal and imports: RLS shows the board only what is theirs, and
    // owners never reach this page (they are redirected above).
    supabase.from("announcements").select("id", { count: "exact", head: true }).neq("status", "draft"),
    supabase.from("import_batches").select("kind, status"),
    supabase.from("email_settings").select("sending_enabled").limit(1),
  ]);

  const association = associations?.[0];
  if (!association) {
    return <Empty>No association is visible to you.</Empty>;
  }

  const t = totals?.[0];
  const booksVisible = (t?.visible_tb_rows ?? 0) > 0;
  const booksBalanced = booksVisible && looseCents(t?.total_debits ?? 0) === looseCents(t?.total_credits ?? 0);
  const [ty, tm, td] = buildingToday.split("-").map(Number);
  const today = new Date(ty, tm - 1, td);

  // The fiscal year the building is in today (the Budget page's rule), not the
  // newest one: a board drafting next year's budget in November must not
  // switch Home to a year that hasn't started.
  const fyList = fiscalYears ?? [];
  const currentFy =
    fyList.find((f) => f.starts_on <= buildingToday && f.ends_on >= buildingToday) ??
    fyList.find((f) => f.starts_on <= buildingToday) ??
    fyList[0];
  const fyLabel = currentFy?.label ?? String(today.getFullYear());
  const fyBudgetRows = (budgetRows ?? []).filter((r) => r.fiscal_year_id === currentFy?.id);

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
  // Current owners only (a past owner's row has ended), co-owners together.
  const ownerNames = new Map<string, string[]>();
  for (const o of unitOwners ?? []) {
    const p = o.persons as unknown as { full_name: string } | null;
    const current = o.effective_from <= buildingToday && (!o.effective_to || o.effective_to >= buildingToday);
    if (!p || !current) continue;
    ownerNames.set(o.unit_id, [...(ownerNames.get(o.unit_id) ?? []), p.full_name].sort());
  }
  const ownerName = new Map([...ownerNames].map(([unitId, names]) => [unitId, names.join(" & ")]));

  // What is actually past due, by unit, from the aging buckets. The unit
  // balances also count charges entered ahead of their due date, which aren't
  // late yet and must not make a unit "behind".
  const overdueByLabel = new Map(
    (aging ?? []).map((a) => [
      a.label as string,
      looseCents(a.days_1_30 ?? 0) + looseCents(a.days_31_60 ?? 0) + looseCents(a.days_60_plus ?? 0),
    ]),
  );
  const overdueCents = [...overdueByLabel.values()].reduce((s, c) => s + c, 0);
  const unitsOverdue = [...overdueByLabel.values()].filter((c) => c > 0).length;


  // --------------------------------------------------------------------------
  // Worth a minute today
  // --------------------------------------------------------------------------
  // Insurance (insurance-spec §12 I-1): status is computed, never stored, so
  // a renewal recorded early keeps the old policy active until the new one starts.
  const policyRows = (policies ?? []).map((p) => ({
    id: p.id as string,
    coverage: p.coverage as string,
    effective_from: p.effective_from as string,
    effective_to: p.effective_to as string,
    renewal_reminder_days: (p.renewal_reminder_days as number | null) ?? 60,
    replaced_by_policy_id: (p.replaced_by_policy_id as string | null) ?? null,
    replaced_at: (p.replaced_at as string | null) ?? null,
    archived_at: (p.archived_at as string | null) ?? null,
  }));
  const statuses = withStatus(policyRows, todayLocal);
  const renewal = renewalFor(policyRows, todayLocal);
  // The snapshot tile shows the soonest end among policies in force, renewed or not.
  const soonestActive = statuses
    .filter((s) => s.status === "active")
    .sort((a, b) => a.daysToEnd - b.daysToEnd || a.policy.id.localeCompare(b.policy.id))[0];

  // Tax deadlines: the one list the Taxes tab and the .ics download also read
  // (lib/tax/deadlines), built from rows alone. The 1099 threshold is the row
  // in force on Dec 31 of the payment year, resolved the way the tab and
  // compute_and_save_tax_filing() resolve it (half-open: on 2026-01-01 the
  // $600 row is out and the $2,000 row is in).
  const threshold = parametersAsOf(
    (thresholdRows ?? []).map((p) => ({
      value: Number(p.numeric_value),
      effectiveFrom: p.effective_from as string,
      effectiveTo: (p.effective_to as string | null) ?? null,
    })),
    `${contractorYear}-12-31`,
  )[0];
  const taxHome = homeTaxDeadlines({
    todayIso: localIso(today),
    association: {
      stateCode: association.state_code,
      fiscalYearEndMonth: association.fiscal_year_end_month ?? null,
      incorporatedOn: association.incorporated_on,
      informationReturnsFiling:
        association.information_returns_filing === "paper" || association.information_returns_filing === "electronic"
          ? association.information_returns_filing
          : null,
      accountantSet: Boolean(association.accountant_person_id),
    },
    fiscalYears: fiscalYears ?? [],
    contractorYear,
    thresholdCents: threshold ? Math.round(threshold.value * 100) : null,
    contractors: (contractorTotals ?? []).map((c) => ({
      vendorId: c.vendor_id,
      name: c.name,
      totalCents: toCents(String(c.total_paid)),
      w9OnFile: c.w9_on_file === true,
    })),
    templates: (taxTemplates ?? []).map((t) => ({
      formCode: t.form_code,
      taxYear: t.tax_year,
      dueRule: t.due_rule ?? null,
      dueRuleCitation: t.due_rule_citation ?? null,
      notes: t.notes ?? null,
      verified: t.verified_at !== null,
      active: t.active === true,
    })),
    forms: (taxForms ?? []).map((f) => ({
      id: f.id,
      formCode: f.form_code,
      taxYear: f.tax_year,
      vendorId: f.vendor_id ?? null,
      status: f.status,
      filedOn: f.filed_on ?? null,
      sentToAccountantAt: f.sent_to_accountant_at ?? null,
    })),
    locked1120hFiscalYearIds: (taxFilings ?? []).filter((f) => f.locked_at).map((f) => f.fiscal_year_id as string),
  });
  const nec1099 = taxHome.deadlines.find((d) => d.formCode === "irs_1099_nec" && d.dueOn !== null);

  // Safe to call regardless of booksVisible — urgentItems only raises the
  // "books don't match" item when booksVisible is true itself; every other
  // check (delinquency, W-9s, insurance, bank connection) doesn't depend on
  // any activity having been posted yet.
  // Categories past the 10% band against their share of the year so far —
  // the same arithmetic as the Budget page's list, so the two agree.
  const fyRow = currentFy;
  const operatingFundId = (funds ?? []).find((f) => f.kind === "operating")?.fund_id ?? null;
  let budgetOver: { name: string; overCents: number }[] = [];
  // Spent minus this point in the year's share of the plan, summed; positive is over.
  let budgetVarianceToDateCents: number | null = null;
  if (fyRow?.starts_on && operatingFundId) {
    const fyStartKey = monthKeyOf(fyRow.starts_on);
    const current = monthKey(today);
    const fyMonths = Math.max(1, monthsBetween(fyStartKey, monthKeyOf(fyRow.ends_on)).length);
    const share = Math.min(1, monthsBetween(fyStartKey, current).length / fyMonths);
    const annual = new Map(
      fyBudgetRows
        .filter((r) => r.type === "expense" && r.fund_id === operatingFundId && Number(r.budgeted) > 0)
        .map((r) => [r.account_id as string, Math.round(Number(r.budgeted) * 100)]),
    );
    const nameOf = new Map(fyBudgetRows.map((r) => [r.account_id as string, r.name as string]));
    const spent = new Map(
      spendByAccount(spendingRows ?? [], fyStartKey, current, operatingFundId).map((a) => [a.accountId, a.cents]),
    );
    const planRows = buildPlanRows(annual, spent, (id) => nameOf.get(id) ?? "A category", share);
    budgetOver = overBudgetAlerts(planRows);
    if (planRows.length > 0) budgetVarianceToDateCents = -planRows.reduce((s, r) => s + r.leftCents, 0);
  }

  // --------------------------------------------------------------------------
  // Board-only data: Repairs & Upkeep (repairs-spec §18.1), quotes and the
  // owner summary (insurance-spec §12 I-1 to I-3), background runs.
  // --------------------------------------------------------------------------
  const [{ data: isBoardRes }, { data: canReadFinancialsRes }, { data: isAdmin }] = await Promise.all([
    supabase.rpc("has_role_in", { assoc: association.id, roles: ["board_admin", "board_member"] }),
    supabase.rpc("can_read_financials", { assoc: association.id }),
    supabase.rpc("has_role_in", { assoc: association.id, roles: ["board_admin"] }),
  ]);
  const isBoard = isBoardRes === true;
  const canReadFinancials = canReadFinancialsRes === true;
  const [board, finance, email, notices] = await Promise.all([
    isBoard ? loadBoardHome(supabase, association.id) : Promise.resolve(null),
    canReadFinancials ? loadRepairsHome(supabase, todayLocal) : Promise.resolve(null),
    isAdmin === true ? loadEmailHealth(supabase) : Promise.resolve(null),
    loadAnnouncements(supabase, buildingToday, 6),
  ]);

  // Contractors: in use = on an open problem, the usual contractor on an
  // active upkeep job, or paid in the last year (lib/contractors/compliance).
  const inUseIds = new Set<string>(finance?.inUseIds ?? []);
  const lastUsed = new Map<string, string>(finance?.lastPaid ?? []);
  const contractorRows = (vendors ?? [])
    .filter((v) => v.status !== "do_not_use")
    .map((v) => {
      const id = v.id as string;
      const lastOn = [lastUsed.get(id), (v.last_used_on as string | null) ?? undefined].filter(Boolean).sort().pop() ?? null;
      const inUse = inUseIds.has(id) || usedRecently(lastOn, todayLocal);
      const trades = (v.trades as string[] | null) ?? [];
      const { items } = complianceFor(
        {
          insured_until: (v.insured_until as string | null) ?? null,
          license_number: (v.license_number as string | null) ?? null,
          license_expires_on: (v.license_expires_on as string | null) ?? null,
          w9_on_file: v.w9_on_file === true,
          is_1099_exempt: v.is_1099_exempt === true,
          status: v.status as string,
          archived_at: (v.archived_at as string | null) ?? null,
          inUse,
          tradeNeedsLicense: trades.some((t) => tradeBySlug(t)?.licenseTypical),
        },
        todayLocal,
      );
      return { v, id, inUse, items };
    });
  const expiredPaperwork = contractorRows.filter(
    (c) => c.inUse && c.items.some((i) => i.key === "coi_expired" || i.key === "license_expired"),
  );

  // Open problems, by what they need.
  const openTickets = finance?.tickets ?? [];
  const emergencies = openTickets.filter((t) => t.emergency_kind !== null);
  const possible = openTickets.filter((t) => possibleEmergency(t) !== null);
  const overdueUpkeep = (finance?.upkeep ?? []).filter((t) => t.next_due_on < todayLocal);

  const urgent = urgentItems({
    booksVisible,
    booksBalance: booksBalanced,
    aging: aging ?? [],
    vendorsMissingW9: taxHome.contractorsMissingW9,
    // The 1099 deadline when one is in play (verified or estimated); the
    // general January 31 otherwise, so the W-9 nudge keeps its six-month lead.
    nec1099Due: nec1099?.dueOn ? new Date(`${nec1099.dueOn}T00:00:00`) : nextOccurrence(1, 31, today),
    insuranceRenewal: renewal,
    insuranceBanners: board?.insuranceBanners ?? [],
    ...(isBoard
      ? {
          repairsEmergency: {
            count: emergencies.length,
            firstTitle: emergencies[0]?.title ?? null,
            firstId: emergencies[0]?.id ?? null,
          },
          repairsPossibleEmergency: possible.length,
          repairsUrgent: openTickets.filter((t) => t.priority === "urgent" && t.emergency_kind === null).length,
          repairsOverdue: openTickets.filter((t) => t.due_on !== null && t.due_on < todayLocal).length,
          upkeepOverdue: { count: overdueUpkeep.length, firstName: overdueUpkeep[0]?.name ?? null },
          contractorPaperwork: {
            expired: expiredPaperwork.length,
            firstName: (expiredPaperwork[0]?.v.name as string | undefined) ?? null,
            firstKind: expiredPaperwork[0]?.items.some((i) => i.key === "coi_expired") ? "coi" : "license",
          },
          finishedRuns: board?.finishedRuns ?? [],
        }
      : {}),
    // 'error' is a bank waiting for a fresh sign-in — connected, just stale;
    // the sync nudge below covers it rather than "not connected yet".
    ...(email ? { email } : {}),
    bankConnected: (bankConnections ?? []).some((c) => c.status !== "disconnected"),
    lastSyncedAt:
      (bankConnections ?? [])
        .filter((c) => c.status !== "disconnected")
        .map((c) => c.last_synced_at as string | null)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1) ?? null,
    today,
    budgetOver,
  });

  // Only say "everything else looks in order" when nothing else is on the card.
  const othersFlagged = urgent.some((i) => i.key !== "delinquent");
  const statusLine = !booksVisible
    ? "No financial activity has been recorded yet."
    : unitsOverdue > 0
      ? `${moneyRounded(overdueCents / 100)} is past due across ${unitsOverdue} unit${unitsOverdue === 1 ? "" : "s"}.${othersFlagged ? "" : " Everything else looks in order."}`
      : othersFlagged
        ? "Every unit is current. A few other things need a look below."
        : "Every unit is current and nothing is overdue.";

  // --------------------------------------------------------------------------
  // Standing + checklist
  // --------------------------------------------------------------------------
  const visibleFunds = (funds ?? []).filter((f) => f.visible_lines > 0);
  const booksOperatingCents = visibleFunds
    .filter((f) => f.kind === "operating")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);
  const booksReserveCents = visibleFunds
    .filter((f) => f.kind === "reserve")
    .reduce((s, f) => s + looseCents(f.cash_balance), 0);
  const booksTotalCents = visibleFunds.reduce((s, f) => s + looseCents(f.cash_balance), 0);

  // Cash is the bank's figure (lib/bank/position), the same one the Bank Feed
  // shows. A board admin's visit refreshes the stored balances from Plaid
  // (remembered for minutes), so the two pages agree to the cent. The books
  // fill in only when no bank is connected.
  const activeConnections = (bankConnections ?? []).filter((c) => c.status !== "disconnected");
  if (isAdmin === true && activeConnections.length > 0) {
    await Promise.all(activeConnections.map((c) => getConnectionBalance(supabase, c.id).catch(() => null)));
  }
  const bankCash = activeConnections.length > 0 ? await loadBankCash(supabase) : null;
  const operatingCents = bankCash ? bankCash.operatingCents : booksOperatingCents;
  const reserveCents = bankCash ? bankCash.reserveCents : booksReserveCents;
  const totalCents = bankCash ? bankCash.totalCents : booksTotalCents;
  const booksGap =
    bankCash && booksVisible ? { cents: booksTotalCents - bankCash.totalCents, waiting: uncategorizedCount ?? 0 } : null;

  // Setting a reserve target is governance, not a books-derived figure —
  // available regardless of whether anything's been posted yet.
  const canSetTarget = isAdmin === true;

  // None of these inputs require any posted activity either.
  const currentFyId = currentFy?.id ?? null;
  const setupSections = buildSetupGuide({
    today,
    association,
    units: unitRows ?? [],
    unitOwners: unitOwners ?? [],
    persons: persons ?? [],
    roleGrants: (roleGrants ?? []).filter((g) => ["board_admin", "board_member", "accountant"].includes(g.role as string)),
    myPersonId: me?.id ?? null,
    inviteCount: inviteCount ?? 0,
    announcementCount: announcementCount ?? 0,
    importBatches: (importBatches ?? []).map((b) => ({ kind: b.kind as string, status: b.status as string })),
    emailSendingEnabled: emailSettings?.[0]?.sending_enabled === true,
    bankConnections: bankConnections ?? [],
    uncategorizedCount: uncategorizedCount ?? 0,
    postedEntryCount: postedEntryCount ?? 0,
    budgetLineCount: (budgetLines ?? []).filter(
      (l) => (l.budgets as unknown as { fiscal_year_id: string } | null)?.fiscal_year_id === currentFyId,
    ).length,
    assessmentScheduleCount: scheduleCount ?? 0,
    taxFilingComputedAt:
      (taxFilings ?? []).find((f) => f.fiscal_year_id === currentFyId && f.computed_at)?.computed_at ?? null,
    // The return by its fiscal year; 1099s carry no fiscal_year_id, so by their payment year.
    taxFormsStarted: (taxForms ?? []).filter((f) =>
      f.fiscal_year_id ? f.fiscal_year_id === taxHome.filingYear?.id : f.tax_year === contractorYear,
    ).length,
    policies: statuses.map((s) => ({ effective_from: s.policy.effective_from, status: s.status })),
    aiConfigured: aiConfigured(),
    ownerSummaryPublishedAt: board?.ownerSummaryPublishedAt ?? null,
    vendors: contractorRows.map((c) => ({
      w9_on_file: c.v.w9_on_file === true,
      w9_received_on: (c.v.w9_received_on as string | null) ?? null,
      is_1099_exempt: c.v.is_1099_exempt === true,
      archived_at: (c.v.archived_at as string | null) ?? null,
      inUse: c.inUse,
    })),
    upkeepTasks: (finance?.upkeep ?? []).map((t) => ({ id: t.id })),
    emergencyInfo: { filled: board?.emergencyFilled ?? 0 },
    documents: (setupDocuments ?? []).map((d) => ({
      uploaded_at: d.uploaded_at,
      category_slug: (d.document_categories as unknown as { slug: string } | null)?.slug ?? null,
    })),
  });
  const setupCounts = countSteps(setupSections);
  const showSetupGuide =
    canSetTarget && !isSetupComplete(setupSections) && association.setup_dismissed_at === null;
  // Setup steps are the board's to do; an accountant can neither act on them
  // nor see the invites, imports and email settings they're judged from.
  const derived = isBoard ? openSteps(setupSections) : [];

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
  const currentKey = monthKey(today);
  const series: { key: string; inCents: number; outCents: number; netCents: number; balanceCents: number }[] = bankCash
    ? (await bankMonths(supabase, bankCash, addMonths(currentKey, -11), currentKey)).map((m) => ({
        ...m,
        netCents: m.inCents - m.outCents,
      }))
    : cashByMonth(cashActivity ?? []);

  if (series.length > 0) {
    const window = series.slice(-12);
    // The balance just before the window: its first month's close less that month's movement.
    const beforeWindowCents = window[0].balanceCents - window[0].netCents;
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

    // Against the share of this year's plan that has come due so far, the
    // same arithmetic as the over-budget alerts, so an on-plan April reads
    // as on plan rather than as the whole year's budget left unspent.
    const varianceCents = budgetVarianceToDateCents;

    const lastSix = window.slice(-6);
    // One "mostly …" caption, on the latest short month: six of them side by
    // side run into each other under narrow bars.
    const lastShortKey = [...lastSix].reverse().find((s) => s.outCents > s.inCents)?.key ?? null;
    inOut = {
      groups: lastSix.map((s) => {
        const shortfall = s.outCents > s.inCents;
        const top = topSpendByMonth.get(s.key);
        return {
          label: monthShortLabel(s.key),
          aCents: s.inCents,
          bCents: s.outCents,
          shortfall,
          caption: s.key === lastShortKey && top ? `mostly ${top.name}` : null,
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
      monthCount: months.length,
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

  const reminders = assembleReminders({
    bills: bills ?? [],
    policies: statuses
      .filter((s) => s.status === "active" || s.status === "upcoming")
      .map((s) => ({
        coverage: s.policy.coverage,
        effective_to: s.policy.effective_to,
        renewal_reminder_days: s.policy.renewal_reminder_days,
        renewed: s.renewed,
      })),
    quoteRequests: board?.quoteRequests ?? [],
    quotes: board?.quotes ?? [],
    ...(isBoard
      ? {
          upkeep: (finance?.upkeep ?? []).map((t) => ({ name: t.name, next_due_on: t.next_due_on })),
          visits: openTickets
            .filter((t) => t.scheduled_for !== null)
            .map((t) => ({ title: t.title, reference: t.reference, scheduled_for: t.scheduled_for! })),
          contractorExpiries: contractorRows
            .filter((c) => c.inUse && !c.v.archived_at)
            .flatMap((c) => [
              ...(c.v.insured_until ? [{ name: c.v.name as string, kind: "coi" as const, date: c.v.insured_until as string }] : []),
              ...(c.v.license_expires_on ? [{ name: c.v.name as string, kind: "license" as const, date: c.v.license_expires_on as string }] : []),
            ]),
        }
      : {}),
    upcomingChargeDates: (futureCharges ?? []).map((c) => c.due_on as string),
    today,
    lastAccessReviewAt,
    taxDeadlines: taxHome.deadlines,
    contractorsMissingW9: taxHome.contractorsMissingW9,
  });

  // The soonest tax filing, picked by key rather than by its display name.
  const nextFiling = nextFilingReminder(reminders);

  const snapshotTiles = buildSnapshot({
    today,
    bankConnections: (bankConnections ?? [])
      .filter((c) => c.status !== "disconnected")
      .map((c) => ({
        status: c.status,
        institutionName: c.institution_name,
        lastSyncedAt: c.last_synced_at,
      })),
    uncategorizedCount: uncategorizedCount ?? 0,
    insuranceRenewal: soonestActive
      ? {
          policy: { effective_to: soonestActive.policy.effective_to },
          daysToEnd: soonestActive.daysToEnd,
          withinReminder: soonestActive.daysToEnd <= soonestActive.policy.renewal_reminder_days,
          renewed: soonestActive.renewed,
        }
      : null,
    nextFiling: nextFiling
      ? { name: nextFiling.name, dueOn: localIso(nextFiling.due), estimated: nextFiling.unverified === true }
      : null,
    contractors: contractorRows.map((c) => ({
      w9OnFile: c.v.w9_on_file === true,
      is1099Exempt: c.v.is_1099_exempt === true,
      insuredUntil: (c.v.insured_until as string | null) ?? null,
      licenseExpiresOn: (c.v.license_expires_on as string | null) ?? null,
      archived: Boolean(c.v.archived_at),
      inUse: c.inUse,
    })),
  });

  const buildingUnits: BuildingUnit[] = (units ?? []).map((u) => {
    const name = ownerName.get(u.unit_id) ?? null;
    const owed = overdueByLabel.get(u.label as string) ?? 0;
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
      owedLabel: status === "behind" ? `owes ${money(owed / 100)}` : null,
    };
  });

  // Owners: the board's published "what the master policy covers" (decision 9),
  // read through its SECURITY DEFINER function, never the insurance tables.
  let ownerInsurance = false;
  if (!isBoard && !canReadFinancials) {
    const { data: summary } = await supabase.rpc("owner_insurance_summary", { p_association: association.id });
    ownerInsurance = summary !== null && summary !== undefined;
  }

  const latestDues = (duesCollection ?? []).at(-1);
  const currentCount = buildingUnits.filter((u) => u.status === "current").length;
  const duesLine =
    booksVisible && latestDues && toCents(latestDues.charged) > 0
      ? `Dues run ${money(toCents(latestDues.charged) / 100)} a month · ${currentCount} of ${buildingUnits.length} units current.`
      : null;

  // --------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {notices ? (
        <AnnouncementsStrip rows={notices.rows} unread={notices.unread} todayIso={buildingToday} canPost={isBoard} />
      ) : null}

      <Greeting
        firstName={firstName}
        statusLine={statusLine}
        hour={hour}
        books={booksVisible ? { visible: true, balanced: booksBalanced } : null}
      />


      {fundsError || totalsError ? (
        <p role="alert" className="rounded-xl border border-bad-line bg-bad-tint px-5 py-3 text-[13px] text-bad-text">
          Some balances couldn&rsquo;t be loaded just now, so figures below may read as zero. Reload the page in a moment.
        </p>
      ) : null}

      <WorthAMinute
        items={urgent}
        emptyNote={
          booksVisible
            ? "The books balance and every unit is current."
            : "No activity has been recorded yet, so there's nothing to flag."
        }
      />

      {ownerInsurance ? (
        <Card title="What the building's insurance covers">
          <p className="text-[13px] text-ink">
            What the building&rsquo;s master policy covers, and what it leaves for your own condo (HO-6) policy.
          </p>
          <Link
            href="/insurance"
            className="mt-3 inline-flex min-h-[40px] items-center rounded-md border border-line-strong bg-paper px-3.5 text-[13px] font-medium text-ink hover:bg-fill"
          >
            Read the summary
          </Link>
        </Card>
      ) : null}

      <div
        className={`grid items-start gap-4 lg:grid-cols-[3fr_2fr] ${showSetupGuide ? "lg:items-stretch" : ""}`}
      >
        <Standing
          totalCents={totalCents}
          operatingCents={operatingCents}
          reserveCents={reserveCents}
          reserveTarget={reserveTarget}
          canSetTarget={canSetTarget}
          tiles={snapshotTiles}
          source={bankCash ? "bank" : "books"}
          booksGap={booksGap}
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

      <div className={`grid items-start gap-4 ${reminders.length > 0 ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        {reminders.length > 0 ? <ComingUp reminders={reminders} today={today} /> : null}
        <Building units={buildingUnits} duesLine={duesLine} />
      </div>

      <ShowcaseCards cash={cash} inOut={inOut} spending={spending} />
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

interface HomeTicket {
  id: string;
  reference: number;
  title: string;
  priority: string;
  emergency_kind: string | null;
  scheduled_for: string | null;
  due_on: string | null;
  triage_emergency: string | null;
  triage_at: string | null;
  emergency_suggestion_dismissed_at: string | null;
}

/**
 * Repairs & Upkeep rows for anyone who reads the books (repairs-spec §18.1):
 * open problems with their board details, active upkeep, and which
 * contractors are in use (an open problem, an upkeep job, paid in the last year).
 */
async function loadRepairsHome(supabase: Supabase, todayLocal: string) {
  const yearAgo = new Date(Date.UTC(Number(todayLocal.slice(0, 4)) - 1, Number(todayLocal.slice(5, 7)) - 1, Number(todayLocal.slice(8, 10))))
    .toISOString()
    .slice(0, 10);
  const [{ data: tickets }, { data: tasks }, { data: paid }] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "id, reference, title, status, priority, emergency_kind, scheduled_for, scheduled_window, resolved_at, assigned_vendor_id, ticket_board_details(due_on, triage, emergency_suggestion_dismissed_at)",
      )
      .not("status", "in", "(resolved,closed)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("upkeep_tasks").select("id, name, next_due_on, vendor_id").eq("is_active", true).order("next_due_on"),
    supabase.from("expenses").select("vendor_id, paid_on").not("vendor_id", "is", null).gte("paid_on", yearAgo),
  ]);
  type Details = { due_on: string | null; triage: { emergency?: unknown; at?: unknown } | null; emergency_suggestion_dismissed_at: string | null };
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const inUseIds = new Set<string>();
  const open: HomeTicket[] = (tickets ?? []).map((t) => {
    if (t.assigned_vendor_id) inUseIds.add(t.assigned_vendor_id as string);
    const d = one(t.ticket_board_details as unknown as Details | Details[] | null);
    return {
      id: t.id as string,
      reference: t.reference as number,
      title: t.title as string,
      priority: t.priority as string,
      emergency_kind: (t.emergency_kind as string | null) ?? null,
      scheduled_for: (t.scheduled_for as string | null) ?? null,
      due_on: d?.due_on ?? null,
      triage_emergency: typeof d?.triage?.emergency === "string" ? d.triage.emergency : null,
      triage_at: typeof d?.triage?.at === "string" ? d.triage.at : null,
      emergency_suggestion_dismissed_at: d?.emergency_suggestion_dismissed_at ?? null,
    };
  });
  for (const t of tasks ?? []) if (t.vendor_id) inUseIds.add(t.vendor_id as string);
  const lastPaid = new Map<string, string>();
  for (const e of paid ?? []) {
    const id = e.vendor_id as string;
    const on = (e.paid_on as string | null)?.slice(0, 10);
    if (on && (!lastPaid.has(id) || on > lastPaid.get(id)!)) lastPaid.set(id, on);
  }
  return {
    tickets: open,
    upkeep: (tasks ?? []).map((t) => ({ id: t.id as string, name: t.name as string, next_due_on: t.next_due_on as string })),
    inUseIds: [...inUseIds],
    lastPaid: [...lastPaid.entries()],
  };
}

/**
 * Board-only Home rows: Insurance's own to-dos (I-1), quote follow-ups and
 * expiries (I-2), whether the owner summary is published (I-3), how much
 * emergency info is filled in (repairs-spec §18.5) and background searches
 * that finished in the last day (foundation-spec 5.3).
 */
/**
 * What happened to Walkup's own email in the last 7 days, for board admins
 * (money-and-reminders-spec 15). A key the email service rejected leaves the
 * row queued with a last_error that starts "rejected_key" (M1 deviation 9).
 * Any read that fails reads as nothing to show.
 */
async function loadEmailHealth(supabase: Supabase): Promise<{ keyRejected: boolean; failed: number; bounced: number }> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [rejected, failed, bounced] = await Promise.all([
    supabase.from("email_outbox").select("id", { count: "exact", head: true }).gte("updated_at", since).like("last_error", "rejected_key%"),
    supabase.from("email_outbox").select("id", { count: "exact", head: true }).gte("updated_at", since).eq("status", "failed"),
    supabase.from("email_outbox").select("id", { count: "exact", head: true }).gte("updated_at", since).eq("status", "bounced"),
  ]);
  return { keyRejected: (rejected.count ?? 0) > 0, failed: failed.count ?? 0, bounced: bounced.count ?? 0 };
}

async function loadBoardHome(supabase: Supabase, associationId: string) {
  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [insuranceBanners, { data: requests }, { data: quotes }, { data: summaries }, emergency, { data: webRuns }, { data: marketRuns }] =
    await Promise.all([
      loadInsuranceBanners(supabase, associationId),
      supabase
        .from("insurance_quote_requests")
        .select("status, follow_up_on, insurance_contacts(name), insurance_partners(name)")
        .eq("status", "sent")
        .not("follow_up_on", "is", null),
      supabase
        .from("insurance_quotes")
        .select("carrier_name, valid_until, declined_at, was_selected")
        .not("valid_until", "is", null),
      supabase.from("insurance_owner_summaries").select("published_at").limit(1),
      loadEmergencyInfo(supabase, associationId),
      supabase
        .from("contractor_search_cache")
        .select("id, trade, query_key, ai_state, ai_finished_at, results_json")
        .eq("provider", "web")
        .in("ai_state", ["done", "failed"])
        .gte("ai_finished_at", dayAgo)
        .limit(10),
      supabase
        .from("insurance_market_research")
        .select("kind, ai_state, ai_finished_at, items")
        .in("ai_state", ["done", "failed"])
        .gte("ai_finished_at", dayAgo),
    ]);
  const nameOf = (v: unknown): string | null => {
    const row = Array.isArray(v) ? v[0] : v;
    return row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : null;
  };
  const building = emergency.building as Record<string, string | null> | null;
  return {
    insuranceBanners,
    quoteRequests: (requests ?? []).map((r) => ({
      contactName: nameOf(r.insurance_contacts) ?? nameOf(r.insurance_partners) ?? "your agent",
      followUpOn: (r.follow_up_on as string | null) ?? null,
      status: r.status as string,
    })),
    quotes: (quotes ?? []).map((q) => ({
      carrier: (q.carrier_name as string | null) ?? "A",
      validUntil: (q.valid_until as string | null) ?? null,
      declined: q.declined_at !== null,
      selected: q.was_selected === true,
    })),
    ownerSummaryPublishedAt: (summaries?.[0]?.published_at as string | null | undefined) ?? null,
    emergencyFilled: (building ? Object.values(building).filter((v) => v !== null).length : 0) + emergency.contacts.length,
    finishedRuns: finishedRuns({
      contractor: (webRuns ?? []).map((r) => ({
        id: r.id as string,
        trade: r.trade as string,
        query_key: (r.query_key as string | null) ?? "",
        ai_state: r.ai_state as string,
        ai_finished_at: (r.ai_finished_at as string | null) ?? null,
        resultCount: Array.isArray(r.results_json) ? r.results_json.length : 0,
      })),
      market: (marketRuns ?? []).map((m) => ({
        kind: m.kind as string,
        ai_state: m.ai_state as string,
        ai_finished_at: (m.ai_finished_at as string | null) ?? null,
        itemCount: Array.isArray(m.items) ? m.items.length : 0,
      })),
      now: new Date(),
    }),
  };
}
