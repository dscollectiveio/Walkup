import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoardOnly } from "@/components/board-only";
import { getViewer } from "@/lib/owner/viewer";
import { maskEmail, officerEmails } from "@/lib/access/contact-mask";
import { loadContactDetails } from "@/lib/people/contact-details";
import { Card, Empty, HEADER_BUTTON, Restricted, money } from "@/components/ui";
import { bankFeedHref } from "@/app/bank-feed/href";
import { PaymentForm } from "@/app/delinquency/payment-form";
import { PaymentInstructionsForm } from "./payment-instructions-form";
import { DuesScheduleCard, type ScheduleView } from "./dues-schedule-card";
import { NeedsYou, type NeedsYouItem, type UnitOption } from "./needs-you";
import { LateFeeRuleForm, OneOffChargeForm } from "./charge-forms";
import { CollectionsSection } from "./collections-section";
import { UnitCard, type UnitPlan } from "./unit-card";
import { additionalProgress, duesPaidCents, rolledOverCents } from "@/lib/dues/year";
import { annualFromPeriodCents, nextPeriodStartFor } from "@/lib/dues/plan";
import { currentPeriodStart, periodLabel, perUnitAmount, type DuesFrequency } from "@/lib/dues/period";
import {
  lateFeeProposals,
  standingFor,
  suggestUnitForDeposit,
  STANDING_WORDS,
  type ChargeLine,
  type UnitHint,
  type UnitStanding,
} from "@/lib/dues/status";
import { shortDate, todayIso } from "@/lib/dates";

export const dynamic = "force-dynamic";

const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const dollars = (c: number) => money(c / 100);

const STANDING_TONE: Record<UnitStanding, string> = {
  current: "bg-good-tint text-good-text",
  behind: "bg-bad-tint text-bad-text",
  ahead: "bg-info-tint text-info-text",
  not_charged: "bg-fill text-mute",
};

/** The first day of the period after the one `today` falls in. */
function nextPeriodStart(frequency: DuesFrequency, today: Date, startsOn: string): string | null {
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (frequency === "one_time") return startsOn > iso(today) ? startsOn : null;
  const next =
    frequency === "monthly"
      ? new Date(today.getFullYear(), today.getMonth() + 1, 1)
      : frequency === "quarterly"
        ? new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 1)
        : new Date(today.getFullYear() + 1, 0, 1);
  const n = iso(next);
  return n < startsOn ? startsOn : n;
}

export default async function DuesPage({ searchParams }: { searchParams: Promise<{ select?: string }> }) {
  const { select: selectParam } = await searchParams;
  const supabase = await createClient();

  const { data: associations } = await supabase
    .from("associations")
    .select(
      "id, display_name, dues_payee_name, dues_bank_name, dues_account_number, dues_routing_number, dues_zelle_handle, dues_payment_notes, dues_late_fee_amount, dues_late_fee_grace_days",
    )
    .limit(1);
  const association = associations?.[0];
  if (!association) return <Restricted what="HOA dues" />;

  const today = new Date();
  const todayKey = todayIso(today);

  // One round trip for everything that doesn't depend on the answers: the
  // membership check, the role checks, and the (RLS-scoped) unit list.
  const [
    { data: isMemberRes },
    { data: isBoardAdminRes },
    { data: isBoardRes },
    { data: canReadFinancialsRes },
    { data: ownedUnitIds },
    { data: units },
    { data: owners },
  ] = await Promise.all([
    supabase.rpc("is_member", { assoc: association.id }),
    supabase.rpc("has_role_in", { assoc: association.id, roles: ["board_admin"] }),
    supabase.rpc("is_board", { assoc: association.id }),
    supabase.rpc("can_read_financials", { assoc: association.id }),
    supabase.rpc("owned_unit_ids", { assoc: association.id }),
    supabase.from("units").select("id, label, sort_order").order("sort_order"),
    supabase.from("unit_owners").select("unit_id, effective_to, persons(full_name, email)"),
  ]);
  if (isMemberRes !== true) return <Restricted what="HOA dues" />;
  const isBoardAdmin = isBoardAdminRes === true;
  const isBoard = isBoardRes === true;
  const canReadFinancials = canReadFinancialsRes === true;
  // Owners have their own pages now (owner-portal-spec 2.4): what they owe,
  // how to pay and the "I paid" report live at /owner/pay.
  if (!canReadFinancials) {
    // The three outside roles (0080) own no unit unless they also hold the owner role: they get the page that
    // says this is the board's, not an empty "how to pay".
    const viewer = await getViewer();
    if (viewer?.isOutside && viewer.ownedUnitIds.length === 0) {
      return (
        <BoardOnly
          what="HOA Dues"
          why="It shows every unit's balance and the collections work."
          alternative={{ label: "Go to your home page", href: viewer.homePath }}
        />
      );
    }
    redirect("/owner/pay");
  }
  const myUnitIds: string[] = ownedUnitIds ?? [];

  // Everyone sees the units; what's attached to them is RLS-scoped below.
  const unitList = units ?? [];
  // The accountant sees the Treasurer's and the President's address and "on file" for everyone else (DECISIONS #52).
  const officers = isBoard ? new Set<string>() : await officerEmails(supabase);
  const mask = (email: string | null) => maskEmail(email, { seesAll: isBoard, officers });
  const ownerByUnit = new Map<string, { name: string; email: string | null }>();
  for (const o of owners ?? []) {
    if (o.effective_to && o.effective_to < todayKey) continue;
    const p = o.persons as unknown as { full_name: string; email: string | null } | null;
    if (p && !ownerByUnit.has(o.unit_id)) ownerByUnit.set(o.unit_id, { name: p.full_name, email: mask(p.email) });
  }

  const scopeUnits = canReadFinancials ? unitList.map((u) => u.id) : myUnitIds;
  const [{ data: chargeRows }, { data: unapplied }, { data: paymentRows }, { data: reportRows }] =
    scopeUnits.length > 0
      ? await Promise.all([
          supabase
            .from("charge_balances")
            .select("id, unit_id, charge_type, period_start, due_on, amount, amount_applied, balance, status, days_overdue")
            .in("unit_id", scopeUnits)
            .order("due_on"),
          supabase.from("payment_unapplied").select("unit_id, amount_unapplied").in("unit_id", scopeUnits).gt("amount_unapplied", 0),
          supabase
            .from("payments")
            .select("unit_id, received_on, amount")
            .in("unit_id", scopeUnits)
            .order("received_on", { ascending: false })
            .limit(300),
          supabase
            .from("dues_payment_reports")
            .select("id, unit_id, amount, paid_on, method, note, status, resolution_note, resolved_at, created_at")
            .in("unit_id", scopeUnits)
            .order("created_at", { ascending: false })
            .limit(50),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const chargeLines: ChargeLine[] = (chargeRows ?? []).map((c) => ({
    id: c.id,
    unit_id: c.unit_id,
    charge_type: c.charge_type as ChargeLine["charge_type"],
    period_start: c.period_start,
    due_on: c.due_on,
    amountCents: cents(c.amount),
    balanceCents: cents(c.balance),
    status: c.status as ChargeLine["status"],
    days_overdue: Number(c.days_overdue ?? 0),
  }));
  const creditByUnit = new Map<string, number>();
  for (const u of unapplied ?? []) {
    if (!u.unit_id) continue;
    creditByUnit.set(u.unit_id, (creditByUnit.get(u.unit_id) ?? 0) + cents(u.amount_unapplied));
  }
  const lastPaymentByUnit = new Map<string, { on: string; cents: number }>();
  for (const p of paymentRows ?? []) {
    if (p.unit_id && !lastPaymentByUnit.has(p.unit_id)) lastPaymentByUnit.set(p.unit_id, { on: p.received_on, cents: cents(p.amount) });
  }
  const reports = (reportRows ?? []).map((r) => ({ ...r, amountCents: cents(r.amount) }));

  // ---- This calendar year's dues and reserve contributions, per unit ----
  // Dues paid counts, for each unit, (1) every deposit labeled "HOA dues" for
  // it, posted to the books or not (a deposit with no open charge is booked
  // straight to income and leaves no payment record), plus (2) payments
  // recorded by hand, which have no bank row. A payment the bank feed made is
  // skipped in (2) because (1) already has it. Money that went to a late fee or
  // one-off charge is taken off. Reserve contributions are income lines on
  // account 4010 tagged to the unit.
  const yearKey = todayKey.slice(0, 4);
  const yearStart = `${yearKey}-01-01`;
  const yearEnd = `${yearKey}-12-31`;
  const feeChargeIds = chargeLines.filter((c) => c.charge_type === "late_fee" || c.charge_type === "other").map((c) => c.id);
  const specialChargeIds = chargeLines.filter((c) => c.charge_type === "special_assessment").map((c) => c.id);
  const [{ data: yearPayments }, { data: duesDeposits }, { data: contributionLines }] =
    scopeUnits.length > 0
      ? await Promise.all([
          supabase
            .from("payments")
            .select("id, unit_id, amount, journal_entry_id")
            .in("unit_id", scopeUnits)
            .gte("received_on", yearStart)
            .lte("received_on", yearEnd)
            .limit(5000),
          supabase
            .from("bank_transactions")
            .select("matched_unit_id, amount, journal_entry_id")
            .eq("posting_kind", "dues")
            .is("removed_at", null)
            .gt("amount", 0)
            .gte("posted_on", yearStart)
            .lte("posted_on", yearEnd)
            .in("matched_unit_id", scopeUnits)
            .limit(5000),
          supabase
            .from("journal_lines")
            .select("unit_id, debit, credit, accounts!inner(code), journal_entries!inner(entry_date, is_posted, source)")
            .eq("accounts.code", "4010")
            .eq("journal_entries.is_posted", true)
            // Only money given voluntarily. A required assessment's own charge also credits 4010,
            // but that is "assessment" source, and what pays it is counted from the payments.
            .eq("journal_entries.source", "manual")
            .gte("journal_entries.entry_date", yearStart)
            .lte("journal_entries.entry_date", yearEnd)
            .in("unit_id", scopeUnits)
            .limit(5000),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
  const bankEntryIds = new Set((duesDeposits ?? []).map((d) => d.journal_entry_id as string | null).filter((x): x is string => !!x));
  const yearPaymentById = new Map((yearPayments ?? []).map((p) => [p.id as string, p]));
  const toFees = new Map<string, number>(); // unit id -> cents of this year's payments applied to fees / one-offs
  const toSpecial = new Map<string, number>(); // unit id -> cents applied to a required Additional Agreed Assessment
  for (const [ids, into] of [
    [feeChargeIds, toFees],
    [specialChargeIds, toSpecial],
  ] as const) {
    for (let i = 0; i < ids.length; i += 150) {
      const { data: allocs } = await supabase
        .from("payment_allocations")
        .select("payment_id, amount")
        .in("charge_id", ids.slice(i, i + 150));
      for (const a of allocs ?? []) {
        const pay = yearPaymentById.get(a.payment_id as string);
        if (pay?.unit_id) into.set(pay.unit_id as string, (into.get(pay.unit_id as string) ?? 0) + cents(a.amount));
      }
    }
  }
  const { data: pledgeRows } =
    scopeUnits.length > 0
      ? await supabase
          .from("assessment_schedules")
          .select("unit_id, annual_amount, total_amount")
          .eq("is_special", true)
          .not("unit_id", "is", null)
          .or(`ends_on.is.null,ends_on.gte.${todayKey}`)
          .in("unit_id", scopeUnits)
      : { data: [] as { unit_id: string | null; annual_amount: number | null; total_amount: number | null }[] };
  const pledgeByUnit = new Map<string, number>();
  for (const r of pledgeRows ?? []) {
    if (r.unit_id && !pledgeByUnit.has(r.unit_id)) pledgeByUnit.set(r.unit_id, cents(r.annual_amount ?? r.total_amount));
  }
  // The reconciliation status beside the Reconcile Transactions button: deposits still waiting for a
  // category or a unit, and deposits already labeled dues that are waiting to be posted to the books.
  const [unmatchedRes, readyRes] = isBoard
    ? await Promise.all([
        supabase
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .is("posting_kind", null)
          .is("removed_at", null)
          .eq("pending", false)
          .gt("amount", 0),
        supabase
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("posting_kind", "dues")
          .is("journal_entry_id", null)
          .is("removed_at", null),
      ])
    : [null, null];
  const unmatchedDeposits = unmatchedRes?.count ?? 0;
  const readyToPostDeposits = readyRes?.count ?? 0;

  // Each unit's property manager and who Walkup's email goes to for it (0066).
  const { data: managerRows } =
    scopeUnits.length > 0
      ? await supabase
          .from("unit_property_managers")
          .select("unit_id, person_id, company, main_contact, persons(full_name, email)")
          .in("unit_id", scopeUnits)
      : { data: [] as never[] };
  // A manager's phone is a contact detail (0082): only the board reads it, so the accountant's view never asks.
  const managerContacts = isBoard
    ? await loadContactDetails(supabase, ((managerRows ?? []) as unknown as { person_id: string }[]).map((m) => m.person_id))
    : new Map<string, { phone: string | null }>();
  const managerByUnit = new Map<
    string,
    { name: string; email: string | null; phone: string | null; company: string | null; main: "owner" | "manager" }
  >();
  for (const m of (managerRows ?? []) as unknown as {
    unit_id: string;
    person_id: string;
    company: string | null;
    main_contact: "owner" | "manager";
    persons: { full_name: string; email: string | null } | null;
  }[]) {
    if (m.persons) {
      managerByUnit.set(m.unit_id, {
        name: m.persons.full_name,
        email: mask(m.persons.email),
        phone: managerContacts.get(m.person_id)?.phone ?? null,
        company: m.company,
        main: m.main_contact,
      });
    }
  }
  /** The address a draft for this unit opens to: the manager when they are the main contact and have one. */
  const contactEmailFor = (unitId: string): string | null => {
    const m = managerByUnit.get(unitId);
    return m && m.main === "manager" && (m.email ?? "").trim() !== "" ? m.email : (ownerByUnit.get(unitId)?.email ?? null);
  };
  const yearPaidByUnit = new Map<
    string,
    { paidCents: number; pendingCents: number; contributedCents: number; appliedToAdditionalCents: number }
  >();
  for (const id of scopeUnits) {
    const deposits = (duesDeposits ?? []).filter((d) => d.matched_unit_id === id);
    const byHand = (yearPayments ?? []).filter((p) => p.unit_id === id && !bankEntryIds.has(p.journal_entry_id as string));
    const contributed = (contributionLines ?? [])
      .filter((l) => l.unit_id === id)
      .reduce((s, l) => s + cents(l.credit) - cents(l.debit), 0);
    yearPaidByUnit.set(id, {
      paidCents: duesPaidCents({
        bankCents: deposits.map((d) => cents(d.amount)),
        otherPaymentCents: byHand.map((p) => cents(p.amount)),
        appliedToFeesCents: toFees.get(id) ?? 0,
        appliedToAdditionalCents: toSpecial.get(id) ?? 0,
      }),
      pendingCents: deposits.filter((d) => !d.journal_entry_id).reduce((s, d) => s + cents(d.amount), 0),
      contributedCents: Math.max(contributed, 0),
      appliedToAdditionalCents: toSpecial.get(id) ?? 0,
    });
  }

  const standingByUnit = new Map(
    unitList.map((u) => [
      u.id,
      standingFor(
        chargeLines.filter((c) => c.unit_id === u.id),
        creditByUnit.get(u.id) ?? 0,
        todayKey,
      ),
    ]),
  );

  // ---- Board-only: schedules, unmatched deposits, this month's collection ----
  let schedules: ScheduleView[] = [];
  const needsItems: NeedsYouItem[] = [];
  let collectedCents = 0;
  let chargedCents = 0;
  let nextDue: string | null = null;
  let perPeriodCents: number | null = null;
  const planByUnit = new Map<
    string,
    { scheduleId: string; plan: UnitPlan; periodCents: number; periodStart: string | null; charged: boolean; nextCharge: string | null }
  >();

  if (canReadFinancials) {
    const monthKey = `${todayKey.slice(0, 7)}-01`;
    const [{ data: scheduleRows }, { data: deposits }, { data: collection }] = await Promise.all([
      supabase
        .from("assessment_schedules")
        .select("id, name, frequency, allocation_method, total_amount, starts_on, ends_on, unit_id, annual_amount, note")
        .eq("is_special", false)
        .order("starts_on", { ascending: false }),
      supabase
        .from("bank_transactions")
        .select("id, posted_on, description, amount")
        .is("posting_kind", null)
        .is("removed_at", null)
        .eq("pending", false)
        .gt("amount", 0)
        .order("posted_on", { ascending: false })
        .limit(10),
      supabase.from("monthly_dues_collection").select("month, charged, collected").eq("month", monthKey).limit(1),
    ]);
    const scheduleIds = (scheduleRows ?? []).map((s) => s.id);
    const { data: periodCharges } =
      scheduleIds.length > 0
        ? await supabase.from("assessment_charges").select("schedule_id, period_start").in("schedule_id", scheduleIds)
        : { data: [] as { schedule_id: string | null; period_start: string }[] };

    const legacyRows = (scheduleRows ?? []).filter((s) => !s.unit_id);
    const planRows = (scheduleRows ?? []).filter((s) => s.unit_id && (!s.ends_on || s.ends_on >= todayKey));
    for (const r of planRows) {
      const frequency = r.frequency as UnitPlan["frequency"];
      if (!["monthly", "quarterly", "annual"].includes(frequency) || r.total_amount === null) continue;
      const periodCents = cents(r.total_amount);
      const annualCents = r.annual_amount !== null ? cents(r.annual_amount) : annualFromPeriodCents(periodCents, frequency);
      const periodStart = currentPeriodStart(frequency, today, r.starts_on, r.ends_on);
      const charged = periodStart
        ? (periodCharges ?? []).some((c) => c.schedule_id === r.id && c.period_start === periodStart)
        : false;
      if (!planByUnit.has(r.unit_id as string)) {
        planByUnit.set(r.unit_id as string, {
          scheduleId: r.id,
          plan: { annualCents, frequency, note: r.note ?? null },
          periodCents,
          periodStart,
          charged,
          nextCharge: periodStart && !charged ? periodStart : periodStart ? nextPeriodStartFor(frequency, today) : r.starts_on,
        });
      }
    }

    schedules = legacyRows.map((s) => {
      const frequency = s.frequency as DuesFrequency;
      const periodStart = currentPeriodStart(frequency, today, s.starts_on, s.ends_on);
      return {
        id: s.id,
        name: s.name,
        frequency: s.frequency,
        allocation_method: s.allocation_method,
        total_amount: Number(s.total_amount ?? 0),
        starts_on: s.starts_on,
        periodStart,
        periodLabel: periodStart ? periodLabel(frequency, periodStart) : null,
        chargedUnits: periodStart
          ? (periodCharges ?? []).filter((c) => c.schedule_id === s.id && c.period_start === periodStart).length
          : 0,
      };
    });
    const main = schedules[0];
    const mainFrequency = (main?.frequency ?? "monthly") as DuesFrequency;
    if (main && (main.allocation_method === "fixed_per_unit" || main.allocation_method === "equal")) {
      perPeriodCents = Math.round(perUnitAmount(main.allocation_method, main.total_amount, unitList.length) * 100);
    }
    const nextCharges = [...planByUnit.values()].map((p) => p.nextCharge).filter((d): d is string => !!d).sort();
    nextDue = nextCharges[0] ?? (main ? nextPeriodStart(mainFrequency, today, main.starts_on) : null);

    // Per-unit plans with a period due that isn't charged yet — one button.
    const dueNow = [...planByUnit.values()].filter((p) => p.periodStart && !p.charged);
    if (dueNow.length > 0) {
      const frequencies = new Set(dueNow.map((p) => p.plan.frequency));
      const periodWords =
        frequencies.size === 1
          ? periodLabel(dueNow[0].plan.frequency, dueNow[0].periodStart as string)
          : "This period's";
      needsItems.push({
        kind: "charge_all",
        unitsLeft: dueNow.length,
        totalCents: dueNow.reduce((sum, p) => sum + p.periodCents, 0),
        periodWords,
      });
    }
    collectedCents = cents(collection?.[0]?.collected);
    chargedCents = cents(collection?.[0]?.charged);

    // Needs you, in the order a treasurer would want to deal with them.
    for (const s of schedules) {
      if (!s.periodStart || !s.periodLabel) continue;
      if (s.allocation_method !== "fixed_per_unit" && s.allocation_method !== "equal") continue;
      const left = unitList.length - s.chargedUnits;
      if (left > 0) {
        needsItems.push({
          kind: "charge",
          scheduleId: s.id,
          periodLabel: s.periodLabel,
          unitsLeft: left,
          amountCents: Math.round(perUnitAmount(s.allocation_method, s.total_amount, unitList.length) * 100),
        });
      }
    }

    const hints: UnitHint[] = unitList.map((u) => ({
      unit_id: u.id,
      label: u.label,
      ownerNames: ownerByUnit.get(u.id) ? [ownerByUnit.get(u.id)!.name] : [],
      owedCents: standingByUnit.get(u.id)?.owedCents ?? 0,
      perPeriodCents: planByUnit.get(u.id)?.periodCents ?? perPeriodCents,
    }));
    const pendingReports = reports.filter((r) => r.status === "pending");
    const claimedReports = new Set<string>();
    for (const d of deposits ?? []) {
      const amountCents = cents(d.amount);
      const match = suggestUnitForDeposit(
        { description: d.description, amountCents },
        hints,
        pendingReports.map((r) => ({ unit_id: r.unit_id, amountCents: r.amountCents, paid_on: r.paid_on })),
        d.posted_on,
      );
      const report = match
        ? pendingReports.find(
            (r) =>
              r.unit_id === match.unit_id &&
              r.amountCents === amountCents &&
              !claimedReports.has(r.id) &&
              Math.abs(new Date(r.paid_on).getTime() - new Date(d.posted_on).getTime()) <= 10 * 86_400_000,
          )
        : undefined;
      if (report) claimedReports.add(report.id);
      needsItems.push({
        kind: "deposit",
        bankTransactionId: d.id,
        description: d.description,
        postedOn: d.posted_on,
        amountCents,
        suggestedUnitId: match?.unit_id ?? null,
        reason: match?.reason ?? null,
        reportId: report?.id ?? null,
      });
    }
    for (const r of pendingReports) {
      if (claimedReports.has(r.id)) continue;
      needsItems.push({
        kind: "report",
        reportId: r.id,
        unitId: r.unit_id,
        amountCents: r.amountCents,
        paidOn: r.paid_on,
        method: r.method,
        note: r.note,
      });
    }
    const fees = lateFeeProposals(chargeLines, {
      amountCents: association.dues_late_fee_amount === null ? null : cents(association.dues_late_fee_amount),
      graceDays: association.dues_late_fee_grace_days,
    });
    for (const f of fees) {
      needsItems.push({
        kind: "late_fee",
        unitId: f.unit_id,
        periodLabel: periodLabel(planByUnit.get(f.unit_id)?.plan.frequency ?? mainFrequency, f.period_start),
        daysOverdue: f.daysOverdue,
        amountCents: f.amountCents,
        periodStart: f.period_start,
      });
    }
    for (const u of unitList) {
      const s = standingByUnit.get(u.id);
      if (!s || s.standing !== "behind") continue;
      const days = Math.max(
        0,
        ...chargeLines.filter((c) => c.unit_id === u.id && (c.status === "open" || c.status === "partial")).map((c) => c.days_overdue),
      );
      needsItems.push({ kind: "behind", unitId: u.id, owedCents: s.owedCents, overdueCents: s.overdueCents, daysOverdue: days });
    }
  }

  const unitOptions: UnitOption[] = unitList.map((u) => ({
    id: u.id,
    label: u.label,
    ownerName: ownerByUnit.get(u.id)?.name ?? null,
    ownerEmail: contactEmailFor(u.id),
    contactName: (() => {
      const m = managerByUnit.get(u.id);
      return m && m.main === "manager" && (m.email ?? "").trim() !== "" ? m.name : null;
    })(),
  }));
  const outstandingCents = [...standingByUnit.values()].reduce((s, v) => s + v.owedCents, 0);
  const hasPaymentInfo = Boolean(
    association.dues_payee_name || association.dues_account_number || association.dues_zelle_handle,
  );

  const howToPay = (
    <Card
      navy
      title="How to pay"
      hint="Set this up once in your bank's bill pay (or Zelle), and it runs on its own every month. No processor, no fee for anyone."
    >
      {!hasPaymentInfo ? (
        <Empty>
          {isBoardAdmin
            ? "Add the association's payment details so owners know where to send dues."
            : "The board hasn't added payment details yet."}
        </Empty>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          {association.dues_payee_name ? (
            <div>
              <dt className="text-[11px] text-mute">Payee name</dt>
              <dd className="figures text-ink">{association.dues_payee_name}</dd>
            </div>
          ) : null}
          {association.dues_bank_name ? (
            <div>
              <dt className="text-[11px] text-mute">Bank</dt>
              <dd className="text-ink">{association.dues_bank_name}</dd>
            </div>
          ) : null}
          {association.dues_account_number ? (
            <div>
              <dt className="text-[11px] text-mute">Account number</dt>
              <dd className="figures text-ink">{association.dues_account_number}</dd>
            </div>
          ) : null}
          {association.dues_routing_number ? (
            <div>
              <dt className="text-[11px] text-mute">Routing number</dt>
              <dd className="figures text-ink">{association.dues_routing_number}</dd>
            </div>
          ) : null}
          {association.dues_zelle_handle ? (
            <div>
              <dt className="text-[11px] text-mute">Zelle</dt>
              <dd className="text-ink">{association.dues_zelle_handle}</dd>
            </div>
          ) : null}
          {association.dues_payment_notes ? (
            <div className="sm:col-span-2">
              <dt className="text-[11px] text-mute">Notes</dt>
              <dd className="text-ink">{association.dues_payment_notes}</dd>
            </div>
          ) : null}
        </dl>
      )}
      {isBoardAdmin ? (
        <div className="mt-4">
          <PaymentInstructionsForm
            instructions={{
              dues_payee_name: association.dues_payee_name,
              dues_bank_name: association.dues_bank_name,
              dues_account_number: association.dues_account_number,
              dues_routing_number: association.dues_routing_number,
              dues_zelle_handle: association.dues_zelle_handle,
              dues_payment_notes: association.dues_payment_notes,
            }}
          />
        </div>
      ) : null}
    </Card>
  );

  // ---------------------------------------------------------------------------
  // Treasurer view.
  // ---------------------------------------------------------------------------
  const monthWord = today.toLocaleDateString("en-US", { month: "long" });
  const behindCount = [...standingByUnit.values()].filter((s) => s.standing === "behind").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[20px] font-bold tracking-tight text-ink">HOA Dues</h1>
        <p className="mt-1 text-mute">
          Who&rsquo;s paid, who hasn&rsquo;t, and what to do about it. Owners pay from their own bank; you confirm it when it lands.
        </p>
        {isBoard ? (
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
            <Link href="#collections" className="text-ink underline underline-offset-2">
              Collections
            </Link>
            <Link href="/dues/statements" className="text-ink underline underline-offset-2">
              Owner statements
            </Link>
            <Link href="/dues/email" className="text-ink underline underline-offset-2">
              Email &amp; reminders
            </Link>
          </p>
        ) : null}
      </div>

      <Card
        navy
        title="Where every unit stands"
        action={
          isBoard ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span
                role="status"
                className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ${
                  unmatchedDeposits > 0 ? "bg-warning-tint text-warning-text" : readyToPostDeposits > 0 ? "bg-info-tint text-info-text" : "bg-good-tint text-good-text"
                }`}
              >
                {unmatchedDeposits > 0
                  ? `${unmatchedDeposits} deposit${unmatchedDeposits === 1 ? "" : "s"} to match`
                  : readyToPostDeposits > 0
                    ? `${readyToPostDeposits} ready to post`
                    : "All deposits matched"}
                {unmatchedDeposits > 0 && readyToPostDeposits > 0 ? ` · ${readyToPostDeposits} ready to post` : ""}
              </span>
              <Link href={bankFeedHref({ range: "all", status: "needs", sort: "date_desc" })} className={HEADER_BUTTON}>
                Reconcile Transactions
              </Link>
            </div>
          ) : null
        }
        hint={
          unitList.length === 0
            ? "Add the building's units first."
            : behindCount === 0
              ? `All ${unitList.length} units are up to date.`
              : `${behindCount} of ${unitList.length} units ${behindCount === 1 ? "is" : "are"} behind.`
        }
      >
        <dl className="grid divide-y divide-line overflow-hidden rounded-lg border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3">
            <dt className="text-[12px] text-mute">Collected in {monthWord}</dt>
            <dd className="figures mt-0.5 text-[20px] text-ink">
              {dollars(collectedCents)}
              {chargedCents > 0 ? <span className="text-[13px] text-mute"> of {dollars(chargedCents)}</span> : null}
            </dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-[12px] text-mute">Outstanding</dt>
            <dd className={`figures mt-0.5 text-[20px] ${outstandingCents > 0 ? "text-ink" : "text-good-text"}`}>{dollars(outstandingCents)}</dd>
          </div>
          <div className="px-4 py-3">
            <dt className="text-[12px] text-mute">Next due</dt>
            <dd className="figures mt-0.5 text-[20px] text-ink">
              {nextDue ? shortDate(nextDue, todayKey) : <span className="text-[13px] font-normal text-mute">no schedule yet</span>}
            </dd>
          </div>
        </dl>

        {unitList.length === 0 ? (
          <div className="mt-4">
            <Empty>
              No units yet.{" "}
              <Link href="/building" className="underline underline-offset-2">
                Add them on Building & Owners →
              </Link>
              <br />
              Set each unit&rsquo;s dues, or{" "}
              <Link href="/building/import" className="underline underline-offset-2">
                import them with your units
              </Link>
              .
            </Empty>
          </div>
        ) : (
          <div className="mt-5 space-y-4 border-t border-line pt-5">
            {unitList.map((u) => {
              const s = standingByUnit.get(u.id)!;
              const owner = ownerByUnit.get(u.id);
              const last = lastPaymentByUnit.get(u.id);
              const credit = creditByUnit.get(u.id) ?? 0;
              const plan = planByUnit.get(u.id);
              const year = yearPaidByUnit.get(u.id);
              // Additional Agreed Assessments: required means a charge exists for this year.
              const requiredCharge = chargeLines.find(
                (c) => c.unit_id === u.id && c.charge_type === "special_assessment" && c.period_start === `${yearKey}-01-01`,
              );
              const agreedCents = requiredCharge ? requiredCharge.amountCents : (pledgeByUnit.get(u.id) ?? null);
              const rolled = rolledOverCents(year?.paidCents ?? 0, plan?.plan.annualCents ?? 0);
              const additional = agreedCents
                ? additionalProgress(agreedCents, {
                    contributedCents: year?.contributedCents ?? 0,
                    appliedToChargeCents: year?.appliedToAdditionalCents ?? 0,
                    rolledOverCents: rolled,
                  })
                : null;
              return (
                <UnitCard
                  key={u.id}
                  unitId={u.id}
                  plan={plan?.plan ?? null}
                  canEdit={isBoard}
                  year={yearKey}
                  todayKey={todayKey}
                  paidCents={year?.paidCents ?? 0}
                  pendingCents={year?.pendingCents ?? 0}
                  isAdmin={isBoardAdmin}
                  manager={managerByUnit.get(u.id) ?? null}
                  ownerEmail={owner?.email ?? null}
                  additional={{
                    agreedCents,
                    required: !!requiredCharge,
                    dueOn: requiredCharge?.due_on ?? null,
                    givenCents: additional?.givenCents ?? (year?.contributedCents ?? 0),
                    pct: additional?.pct ?? 0,
                    rolledOverCents: rolled,
                    voluntaryGivenCents: year?.contributedCents ?? 0,
                  }}
                  label={u.label}
                  ownerName={owner?.name ?? null}
                  ownerNoEmail={!!owner && !owner.email}
                  standingLabel={`${STANDING_WORDS[s.standing]}${s.standing === "ahead" && credit > 0 ? ` ${dollars(credit)}` : ""}`}
                  standingTone={STANDING_TONE[s.standing]}
                  owedLabel={s.owedCents > 0 ? dollars(s.owedCents) : "Paid up"}
                  overdue={s.overdueCents > 0}
                  details={
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
                      <div>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Owed</dt>
                        <dd className={`figures ${s.overdueCents > 0 ? "text-bad-text" : "text-ink"}`}>
                          {s.owedCents > 0 ? dollars(s.owedCents) : "—"}
                          {last ? (
                            <div className="text-[11px] font-normal text-mute-soft">
                              last paid {dollars(last.cents)} · {shortDate(last.on, todayKey)}
                            </div>
                          ) : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] font-medium uppercase tracking-wide text-mute">Next charge</dt>
                        <dd className="figures text-mute">
                          {plan?.nextCharge ? (
                            <>
                              {shortDate(plan.nextCharge, todayKey)}
                              {plan.periodStart && !plan.charged ? <div className="text-[11px] text-warning-text">not charged yet</div> : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </dd>
                      </div>
                    </dl>
                  }
                />
              );
            })}
          </div>
        )}

        <CollectionsSection supabase={supabase} associationId={association.id} isBoard={isBoard} preselect={selectParam ?? null} />

        {isBoard && unitList.length > 0 && planByUnit.size === 0 ? (
          <p className="mt-3 text-[12px] text-mute">
            Set each unit&rsquo;s dues in the table: a yearly amount and how often they pay. They don&rsquo;t have to match.
            Then &ldquo;Charge what&rsquo;s due&rdquo; appears under Needs you each period.
          </p>
        ) : null}

        {isBoard && unitList.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-[12px] text-mute">
              Record a payment for a check or cash handed to you. Bank deposits are confirmed below as they arrive.
            </span>
            <PaymentForm
              units={unitList.map((u) => ({ id: u.id, label: u.label, owed: (standingByUnit.get(u.id)?.owedCents ?? 0) / 100 }))}
            />
          </div>
        ) : null}
      </Card>

      {isBoard && needsItems.length > 0 ? (
        <Card navy title="Needs you" hint="One decision each. Nothing here happens on its own.">
          <NeedsYou items={needsItems} units={unitOptions} associationName={association.display_name} />
        </Card>
      ) : null}

      {schedules.length > 0 ? (
        <DuesScheduleCard schedules={schedules} unitCount={unitList.length} canManage={isBoardAdmin} />
      ) : null}

      {isBoard ? (
        <Card navy title="Late fees and one-off charges" hint="Both are proposed or typed by a person, then posted like any other charge.">
          <div className="space-y-4">
            {isBoardAdmin ? (
              <LateFeeRuleForm
                amount={association.dues_late_fee_amount === null ? null : Number(association.dues_late_fee_amount)}
                graceDays={association.dues_late_fee_grace_days}
              />
            ) : null}
            <div className="border-t border-line pt-4">
              <OneOffChargeForm units={unitList.map((u) => ({ id: u.id, label: u.label }))} />
            </div>
          </div>
        </Card>
      ) : null}

      {howToPay}
    </div>
  );
}
