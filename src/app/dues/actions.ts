"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildingTodayIso } from "@/lib/dates";
import { currentPeriodStart, periodLabel, perUnitAmount, type DuesFrequency } from "@/lib/dues/period";
import { PLAN_FREQUENCIES, perPeriodCents, periodStartFor, planStartsOn } from "@/lib/dues/plan";
import { applyCategorizations } from "@/app/bank-feed/actions";

/**
 * A database error as a sentence a person can use. Messages the database raises on purpose for people (22023)
 * pass through; everything else is logged by code and shown as one plain line, so constraint and table names
 * never reach the page (REVIEW-2 #25).
 */
function friendly(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "42501") return "Only a board member can do that.";
  if (error.code === "22023" && error.message) return error.message;
  if (error.code === "23505") return "That was already recorded.";
  console.error("[dues]", error.code ?? "-");
  return "Something went wrong saving that. Try again.";
}

const FREQUENCIES: DuesFrequency[] = ["monthly", "quarterly", "annual", "one_time"];
const ALLOCATIONS = ["fixed_per_unit", "equal"] as const;

/**
 * One assessment_schedules row — the amount and cadence. Nothing is charged
 * until chargeDuesPeriod runs. assessment_schedules_insert (0002) is
 * board-gated by RLS. `percentage` allocation is deliberately not offered:
 * ownership percentages live on unit_owners, not units, and wiring that
 * through is its own piece of work.
 */
export async function createDuesSchedule(_prev: unknown, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Regular assessments";
  const frequency = String(formData.get("frequency") ?? "") as DuesFrequency;
  const allocation = String(formData.get("allocation_method") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const startsOn = String(formData.get("starts_on") ?? "");

  if (!FREQUENCIES.includes(frequency)) return { error: "Choose how often dues are charged." };
  if (!(ALLOCATIONS as readonly string[]).includes(allocation)) {
    return { error: "Choose how the amount is split." };
  }
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount greater than zero." };
  if (!startsOn) return { error: "Choose the first period this applies to." };

  const supabase = await createClient();
  const [{ data: associations }, { data: funds }] = await Promise.all([
    supabase.from("associations").select("id").order("created_at").order("id").limit(1),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };
  const fundId = funds?.[0]?.id;
  if (!fundId) return { error: "No operating fund is set up yet." };

  const { error } = await supabase.from("assessment_schedules").insert({
    association_id: associationId,
    name,
    frequency,
    fund_id: fundId,
    allocation_method: allocation,
    starts_on: startsOn,
    is_special: false,
    total_amount: amount,
  });

  if (error) {
    return { error: error.code === "42501" ? "Only a board member can set a dues schedule." : friendly(error) };
  }

  revalidatePath("/dues");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Records this period's charge for every unit on a schedule, through the
 * same record_assessment_charge RPC (0015) the ledger already trusts — one
 * balanced entry (debit 1200 AR / credit 4000 income) per unit. Units that
 * already have a charge for this schedule + period are skipped, so running
 * it twice is harmless.
 */
export async function chargeDuesPeriod(scheduleId: string) {
  const supabase = await createClient();
  const { data: schedules } = await supabase
    .from("assessment_schedules")
    .select("id, association_id, frequency, allocation_method, total_amount, fund_id, starts_on, ends_on")
    .eq("id", scheduleId)
    .limit(1);
  const schedule = schedules?.[0];
  if (!schedule) return { error: "That schedule isn't visible to you." };
  if (schedule.total_amount === null) return { error: "This schedule has no amount set." };
  if (schedule.allocation_method !== "fixed_per_unit" && schedule.allocation_method !== "equal") {
    return { error: "Only per-unit and equal-split schedules can be charged from here." };
  }

  const today = new Date();
  const periodStart = currentPeriodStart(
    schedule.frequency as DuesFrequency,
    today,
    schedule.starts_on,
    schedule.ends_on,
  );
  if (!periodStart) {
    return { error: `Nothing to charge — this schedule starts ${schedule.starts_on}.` };
  }

  const [{ data: fiscalYears }, { data: accounts }, { data: units }, { data: existing }] = await Promise.all([
    supabase
      .from("fiscal_years")
      .select("id")
      .lte("starts_on", periodStart)
      .gte("ends_on", periodStart)
      .limit(1),
    supabase.from("accounts").select("id, code").in("code", ["1200", "4000"]).eq("is_active", true),
    supabase.from("units").select("id").order("sort_order"),
    supabase
      .from("assessment_charges")
      .select("unit_id")
      .eq("schedule_id", scheduleId)
      .eq("period_start", periodStart),
  ]);

  const fiscalYearId = fiscalYears?.[0]?.id;
  if (!fiscalYearId) return { error: `No fiscal year covers ${periodStart}. Open one first.` };
  const arAccountId = accounts?.find((a) => a.code === "1200")?.id;
  const incomeAccountId = accounts?.find((a) => a.code === "4000")?.id;
  if (!arAccountId || !incomeAccountId) {
    return { error: "The Assessments Receivable (1200) or Regular Assessments (4000) account is missing." };
  }
  if (!units || units.length === 0) return { error: "Add the building's units first." };

  const alreadyCharged = new Set((existing ?? []).map((c) => c.unit_id));
  const amount = perUnitAmount(schedule.allocation_method, Number(schedule.total_amount), units.length);
  if (amount <= 0) return { error: "The per-unit amount works out to zero." };

  let charged = 0;
  const errors: string[] = [];
  for (const unit of units) {
    if (alreadyCharged.has(unit.id)) continue;
    const { error } = await supabase.rpc("record_assessment_charge", {
      p_association_id: schedule.association_id,
      p_fiscal_year_id: fiscalYearId,
      p_unit_id: unit.id,
      p_charge_type: "assessment",
      p_period_start: periodStart,
      p_due_on: periodStart,
      p_amount: amount,
      p_fund_id: schedule.fund_id,
      p_ar_account_id: arAccountId,
      p_income_account_id: incomeAccountId,
      p_schedule_id: scheduleId,
    });
    if (error) errors.push(friendly(error));
    else charged += 1;
  }

  revalidatePath("/dues");
  revalidatePath("/");
  revalidatePath("/ledger");
  return { ok: true, charged, skipped: alreadyCharged.size, errors };
}

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  return associations?.[0]?.id ?? null;
}

export async function updateDuesPaymentInstructions(_prev: unknown, formData: FormData) {
  const fields = {
    dues_payee_name: String(formData.get("dues_payee_name") ?? "").trim() || null,
    dues_bank_name: String(formData.get("dues_bank_name") ?? "").trim() || null,
    dues_account_number: String(formData.get("dues_account_number") ?? "").trim() || null,
    dues_routing_number: String(formData.get("dues_routing_number") ?? "").trim() || null,
    dues_zelle_handle: String(formData.get("dues_zelle_handle") ?? "").trim() || null,
    dues_payment_notes: String(formData.get("dues_payment_notes") ?? "").trim() || null,
  };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update(fields)
    .eq("id", associationId)
    .select("id");

  if (error) return { error: friendly(error) };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can edit payment instructions." };
  }

  revalidatePath("/dues");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dues tab (0044): late-fee rule, proposed fees, one-off charges, and owner
// payment reports. Nothing here moves money or sends anything; every write
// is a board member's (or an owner's own report), and every ledger write
// goes through the existing RPCs.
// ---------------------------------------------------------------------------

export async function saveLateFeeRule(_prev: unknown, formData: FormData) {
  const rawAmount = String(formData.get("amount") ?? "").trim();
  const rawGrace = String(formData.get("grace_days") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  const amount = rawAmount === "" ? null : Number(rawAmount);
  const grace = rawGrace === "" ? null : Number(rawGrace);
  if (enabled) {
    if (amount === null || !Number.isFinite(amount) || amount <= 0) return { error: "Enter the late fee amount." };
    if (grace === null || !Number.isInteger(grace) || grace < 0) return { error: "Enter the grace period in days." };
  }

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("associations")
    .update({
      dues_late_fee_amount: enabled ? amount : null,
      dues_late_fee_grace_days: enabled ? grace : null,
    })
    .eq("id", associationId)
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data || data.length === 0) return { error: "Only a board admin can change the late-fee rule." };

  revalidatePath("/dues");
  return { ok: true };
}

/**
 * Adds one charge to one unit through record_assessment_charge — a late fee
 * (income 4020), a one-off charge (income 4000) or a required Additional Agreed
 * Assessment (income 4010). Always a person's click;
 * the Dues page proposes, it never applies.
 */
export async function addUnitCharge(input: {
  unitId: string;
  amount: number;
  kind: "late_fee" | "other" | "special_assessment";
  /** The period the charge belongs to (for a late fee, the overdue assessment's period). */
  periodStart: string;
  dueOn?: string;
  /** What the owner sees on their statement. */
  memo?: string;
}) {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return { error: "Enter an amount greater than zero." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  // A late fee is the association's own rule, not whatever the browser sent, and it is charged once per unit
  // and period (REVIEW-2 #21): the amount comes from the rule, and a second click or a second board member
  // finds the first charge and stops.
  let amount = input.amount;
  if (input.kind === "late_fee") {
    const [{ data: rule }, { data: existing }] = await Promise.all([
      supabase.from("associations").select("dues_late_fee_amount").eq("id", associationId).limit(1),
      supabase
        .from("assessment_charges")
        .select("id")
        .eq("unit_id", input.unitId)
        .eq("charge_type", "late_fee")
        .eq("period_start", input.periodStart)
        .is("waived_at", null)
        .is("written_off_at", null)
        .limit(1),
    ]);
    const ruleAmount = Number(rule?.[0]?.dues_late_fee_amount ?? 0);
    if (!Number.isFinite(ruleAmount) || ruleAmount <= 0) return { error: "Set the late fee on the Dues page first." };
    if (existing?.length) return { error: "A late fee for that period was already added." };
    amount = ruleAmount;
  }

  const dueOn = input.dueOn ?? new Date().toISOString().slice(0, 10);
  const incomeCode = input.kind === "late_fee" ? "4020" : input.kind === "special_assessment" ? "4010" : "4000";
  const [{ data: fiscalYears }, { data: accounts }, { data: funds }] = await Promise.all([
    supabase.from("fiscal_years").select("id").lte("starts_on", dueOn).gte("ends_on", dueOn).limit(1),
    supabase.from("accounts").select("id, code").in("code", ["1200", incomeCode]).eq("is_active", true),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  const fiscalYearId = fiscalYears?.[0]?.id;
  if (!fiscalYearId) return { error: `No fiscal year covers ${dueOn}. Open one first.` };
  const ar = accounts?.find((a) => a.code === "1200")?.id;
  const income = accounts?.find((a) => a.code === incomeCode)?.id;
  if (!ar || !income) return { error: `The Assessments Receivable (1200) or income (${incomeCode}) account is missing.` };
  const fundId = funds?.[0]?.id;
  if (!fundId) return { error: "No operating fund is set up yet." };

  const { error } = await supabase.rpc("record_assessment_charge", {
    p_association_id: associationId,
    p_fiscal_year_id: fiscalYearId,
    p_unit_id: input.unitId,
    p_charge_type: input.kind,
    p_period_start: input.periodStart,
    p_due_on: dueOn,
    p_amount: Math.round(amount * 100) / 100,
    p_fund_id: fundId,
    p_ar_account_id: ar,
    p_income_account_id: income,
    p_schedule_id: null,
    p_memo: input.memo ?? null,
  });
  if (error) return { error: friendly(error) };

  revalidatePath("/dues");
  revalidatePath("/delinquency");
  revalidatePath("/");
  return { ok: true };
}

export async function addOneOffCharge(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const reason = String(formData.get("reason") ?? "").trim();
  if (!unitId) return { error: "Choose a unit." };
  if (!reason) return { error: "Say what the charge is for — it appears on the owner's statement." };
  const today = new Date().toISOString().slice(0, 10);
  const result = await addUnitCharge({ unitId, amount, kind: "other", periodStart: today, dueOn: today, memo: reason });
  return result.error ? { error: result.error as string } : { ok: true as const };
}

/** An owner (or a board member on their behalf) says a payment was made outside Walkup. */
export async function reportOutsidePayment(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const amount = Number(String(formData.get("amount") ?? "").trim());
  const paidOn = String(formData.get("paid_on") ?? "");
  const method = String(formData.get("method") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!unitId) return { error: "Choose the unit." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount you paid." };
  if (!paidOn) return { error: "Enter the date you paid." };
  if (paidOn > buildingTodayIso()) return { error: "Enter the date you paid, not a future date." };
  if (!["zelle", "check", "cash", "bank_transfer", "other"].includes(method)) return { error: "Choose how you paid." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { error } = await supabase.from("dues_payment_reports").insert({
    association_id: associationId,
    unit_id: unitId,
    reported_by: user.id,
    amount: Math.round(amount * 100) / 100,
    paid_on: paidOn,
    method,
    note,
  });
  if (error) {
    // 0054's cap trigger: ten pending reports per unit (hint report_cap).
    if (error.code === "53400") {
      return { error: "There are already ten reports waiting for this unit. The board will answer them first." };
    }
    return { error: error.code === "42501" ? "You can only report a payment for your own unit." : friendly(error) };
  }

  revalidatePath("/dues");
  revalidatePath("/owner/pay");
  revalidatePath("/owner");
  revalidatePath("/");
  return { ok: true };
}

/**
 * The treasurer confirms a bank deposit as a unit's dues. This categorizes
 * and posts the bank row through the bank feed's own path (0036) — the one
 * place dues enter the ledger — and, if an owner's report described it,
 * marks that report matched to this exact transaction.
 */
export async function confirmDepositAsDues(input: {
  bankTransactionId: string;
  unitId: string;
  reportId?: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const posted = await applyCategorizations({
    items: [{ id: input.bankTransactionId, kind: "dues", accountId: null, unitId: input.unitId, vendorId: null }],
    postNow: true,
  });
  if (posted.error) return { error: posted.error };
  if (posted.errors && posted.errors.length > 0 && (posted.posted ?? 0) === 0) return { error: posted.errors[0] };

  if (input.reportId) {
    const { error } = await supabase
      .from("dues_payment_reports")
      .update({
        status: "matched",
        matched_bank_transaction_id: input.bankTransactionId,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      })
      .eq("id", input.reportId)
      .eq("status", "pending");
    if (error) return { ok: true, warning: `Posted, but the owner's report couldn't be marked matched: ${friendly(error)}` };
  }

  revalidatePath("/dues");
  revalidatePath("/bank-feed");
  revalidatePath("/");
  return { ok: true };
}

/** "We never received this" — keeps the report, with the reason, for the owner to see. */
export async function dismissPaymentReport(reportId: string, note: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };
  const { data, error } = await supabase
    .from("dues_payment_reports")
    .update({
      status: "dismissed",
      resolution_note: note.trim() || "The board could not find this payment.",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", reportId)
    .eq("status", "pending")
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data || data.length === 0) return { error: "Only a board member can resolve a report." };
  revalidatePath("/dues");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-unit dues plans (0044): one schedule per unit, its own yearly amount
// and cadence. Charges still go through record_assessment_charge.
// ---------------------------------------------------------------------------

export async function saveUnitDues(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const annual = Number(String(formData.get("annual_amount") ?? "").replace(/[^0-9.]/g, ""));
  const frequency = String(formData.get("frequency") ?? "") as (typeof PLAN_FREQUENCIES)[number];
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!unitId) return { error: "Choose the unit." };
  if (!Number.isFinite(annual) || annual <= 0) return { error: "Enter the yearly dues for this unit." };
  if (!PLAN_FREQUENCIES.includes(frequency)) return { error: "Choose how often this unit pays." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const today = new Date();
  const periodStart = periodStartFor(frequency, today);

  const [{ data: funds }, { data: units }, { data: existing }, { count: chargedThisPeriod }] = await Promise.all([
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
    supabase.from("units").select("label").eq("id", unitId).limit(1),
    supabase
      .from("assessment_schedules")
      .select("id, starts_on")
      .eq("unit_id", unitId)
      .eq("is_special", false)
      .is("ends_on", null)
      .order("starts_on", { ascending: false })
      .limit(1),
    supabase
      .from("assessment_charges")
      .select("id", { count: "exact", head: true })
      .eq("unit_id", unitId)
      .eq("charge_type", "assessment")
      .eq("period_start", periodStart),
  ]);
  const fundId = funds?.[0]?.id;
  if (!fundId) return { error: "No operating fund is set up yet." };
  const label = units?.[0]?.label ?? "Unit";
  const startsOn = planStartsOn(frequency, today, (chargedThisPeriod ?? 0) > 0);
  const perPeriod = perPeriodCents(Math.round(annual * 100), frequency) / 100;

  const row = existing?.[0];
  const { error } = row
    ? await supabase
        .from("assessment_schedules")
        .update({
          frequency,
          total_amount: perPeriod,
          annual_amount: annual,
          note,
          // A plan that hasn't begun yet moves with the new cadence; one already running keeps its start.
          ...(row.starts_on > startsOn ? { starts_on: startsOn } : {}),
        })
        .eq("id", row.id)
    : await supabase.from("assessment_schedules").insert({
        association_id: associationId,
        unit_id: unitId,
        name: `${label} dues`,
        frequency,
        fund_id: fundId,
        allocation_method: "fixed_per_unit",
        starts_on: startsOn,
        is_special: false,
        total_amount: perPeriod,
        annual_amount: annual,
        note,
      });
  if (error) {
    return { error: error.code === "42501" ? "Only a board member can set a unit's dues." : friendly(error) };
  }

  revalidatePath("/dues");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Charges every unit whose own plan has a period due that isn't in the books
 * yet. Running it twice is harmless — a unit already charged for the period
 * is skipped. One balanced entry per unit, memo "Dues · October 2026".
 */
export async function chargeDueNow() {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [{ data: plans }, { data: accounts }] = await Promise.all([
    supabase
      .from("assessment_schedules")
      .select("id, unit_id, frequency, total_amount, fund_id, starts_on, ends_on")
      .not("unit_id", "is", null)
      .eq("is_special", false)
      .or(`ends_on.is.null,ends_on.gte.${todayIso}`),
    supabase.from("accounts").select("id, code").in("code", ["1200", "4000"]).eq("is_active", true),
  ]);
  const ar = accounts?.find((a) => a.code === "1200")?.id;
  const income = accounts?.find((a) => a.code === "4000")?.id;
  if (!ar || !income) return { error: "The Assessments Receivable (1200) or Regular Assessments (4000) account is missing." };
  if (!plans || plans.length === 0) return { ok: true, charged: 0, skipped: 0, errors: [] as string[] };

  const due = plans
    .map((p) => ({
      ...p,
      periodStart: currentPeriodStart(p.frequency as DuesFrequency, today, p.starts_on, p.ends_on),
    }))
    .filter((p): p is typeof p & { periodStart: string } => p.periodStart !== null && p.total_amount !== null);

  const { data: existing } =
    due.length > 0
      ? await supabase
          .from("assessment_charges")
          .select("schedule_id, period_start")
          .in(
            "schedule_id",
            due.map((d) => d.id),
          )
      : { data: [] };
  const already = new Set((existing ?? []).map((c) => `${c.schedule_id}:${c.period_start}`));

  const fyCache = new Map<string, string | null>();
  const fiscalYearFor = async (d: string) => {
    if (!fyCache.has(d)) {
      const { data } = await supabase.from("fiscal_years").select("id").lte("starts_on", d).gte("ends_on", d).limit(1);
      fyCache.set(d, data?.[0]?.id ?? null);
    }
    return fyCache.get(d) ?? null;
  };

  let charged = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const p of due) {
    if (already.has(`${p.id}:${p.periodStart}`)) {
      skipped += 1;
      continue;
    }
    const fy = await fiscalYearFor(p.periodStart);
    if (!fy) {
      errors.push(`No fiscal year covers ${p.periodStart}.`);
      continue;
    }
    const { error } = await supabase.rpc("record_assessment_charge", {
      p_association_id: associationId,
      p_fiscal_year_id: fy,
      p_unit_id: p.unit_id,
      p_charge_type: "assessment",
      p_period_start: p.periodStart,
      p_due_on: p.periodStart,
      p_amount: Number(p.total_amount),
      p_fund_id: p.fund_id,
      p_ar_account_id: ar,
      p_income_account_id: income,
      p_schedule_id: p.id,
      p_memo: `Dues · ${periodLabel(p.frequency as DuesFrequency, p.periodStart)}`,
    });
    if (error) errors.push(friendly(error));
    else charged += 1;
  }

  revalidatePath("/dues");
  revalidatePath("/");
  revalidatePath("/ledger");
  if (charged === 0 && errors.length > 0) return { error: errors[0] };
  return { ok: true, charged, skipped, errors };
}

// ---------------------------------------------------------------------------
// Additional Agreed Assessments: an extra yearly amount a unit agrees to put
// toward the reserve, on top of regular dues.
//
// Voluntary (the default): nothing is owed, so no due date, no late fee, and it
// never changes the unit's standing. Each unit may have an agreed amount (an
// assessment_schedules row with is_special = true, kept apart from the dues
// plan, which every dues query already filters to is_special = false). Money
// given is an income line on account 4010 (Special Assessments), tagged to the
// unit, source "manual".
//
// Required (a board admin's choice): the amount is charged to the unit like any
// other charge (type special_assessment, income 4010), so it is owed, shows in
// the unit's standing and statement, and payments apply to it. Once charged it
// is a ledger fact and is not switched back here.
// ---------------------------------------------------------------------------

/** Sets, changes or ends a unit's agreed amount (voluntary). A blank or zero amount ends it. */
async function setAgreedAmount(unitId: string, amount: number) {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const todayKey = buildingTodayIso();
  const yearStart = `${todayKey.slice(0, 4)}-01-01`;

  const [{ data: funds }, { data: units }, { data: existing }] = await Promise.all([
    supabase.from("funds").select("id").eq("kind", "reserve").limit(1),
    supabase.from("units").select("label").eq("id", unitId).limit(1),
    supabase
      .from("assessment_schedules")
      .select("id, starts_on")
      .eq("unit_id", unitId)
      .eq("is_special", true)
      .is("ends_on", null)
      .order("starts_on", { ascending: false })
      .limit(1),
  ]);
  const row = existing?.[0];

  if (amount === 0) {
    if (!row) return { ok: true as const };
    // Ending it keeps the history: the row stays, with an end date.
    const yesterday = new Date(`${todayKey}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const endsOn = yesterday.toISOString().slice(0, 10);
    const { error } = await supabase
      .from("assessment_schedules")
      .update({ ends_on: endsOn < row.starts_on ? row.starts_on : endsOn })
      .eq("id", row.id);
    if (error) return { error: friendly(error) };
    return { ok: true as const };
  }

  const fundId = funds?.[0]?.id;
  if (!fundId) return { error: "No reserve fund is set up yet." };
  const label = units?.[0]?.label ?? "Unit";

  const { error } = row
    ? await supabase.from("assessment_schedules").update({ total_amount: amount, annual_amount: amount }).eq("id", row.id)
    : await supabase.from("assessment_schedules").insert({
        association_id: associationId,
        unit_id: unitId,
        name: `${label} additional agreed assessment`,
        frequency: "annual",
        fund_id: fundId,
        allocation_method: "fixed_per_unit",
        starts_on: yearStart,
        is_special: true,
        total_amount: amount,
        annual_amount: amount,
      });
  if (error) {
    return { error: error.code === "42501" ? "Only a board member can set a unit's agreed assessment." : friendly(error) };
  }
  return { ok: true as const };
}

/**
 * Saves a unit's Additional Agreed Assessment. "voluntary" sets the agreed
 * amount (any board member). "required" is a board admin's choice: it charges
 * the amount to the unit for this calendar year, due on the date given.
 */
export async function saveAdditionalAssessment(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const amount = Number(String(formData.get("agreed_amount") ?? "").replace(/[^0-9.]/g, "") || "0");
  const mode = String(formData.get("mode") ?? "voluntary");
  if (!unitId) return { error: "Choose the unit." };
  if (!Number.isFinite(amount) || amount < 0) return { error: "Enter a dollar amount." };

  if (mode !== "required") {
    const result = await setAgreedAmount(unitId, amount);
    if ("error" in result) return result;
    revalidatePath("/dues");
    return { ok: true as const };
  }

  // Required: a board admin only, and it is charged now.
  if (amount <= 0) return { error: "Enter the amount that is required." };
  const dueOn = String(formData.get("due_on") ?? "");
  const todayKey = buildingTodayIso();
  const year = todayKey.slice(0, 4);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) return { error: "Choose the date it is due." };
  if (dueOn.slice(0, 4) !== year) return { error: `It must be due in ${year}.` };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const { data: isAdmin } = await supabase.rpc("has_role_in", { assoc: associationId, roles: ["board_admin"] });
  if (isAdmin !== true) return { error: "Only a board admin can make an assessment required." };

  const periodStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const [{ data: already }, { data: given }] = await Promise.all([
    supabase
      .from("assessment_charges")
      .select("id")
      .eq("unit_id", unitId)
      .eq("charge_type", "special_assessment")
      .eq("period_start", periodStart)
      .is("waived_at", null)
      .is("written_off_at", null)
      .limit(1),
    supabase
      .from("journal_lines")
      .select("id, accounts!inner(code), journal_entries!inner(entry_date, is_posted, source)")
      .eq("accounts.code", "4010")
      .eq("unit_id", unitId)
      .eq("journal_entries.is_posted", true)
      .eq("journal_entries.source", "manual")
      .gte("journal_entries.entry_date", periodStart)
      .lte("journal_entries.entry_date", yearEnd)
      .limit(1),
  ]);
  if (already?.length) return { error: "This unit's assessment is already required for this year." };
  if (given?.length) {
    return { error: "This unit already gave voluntarily this year. Make it required next year, so the two don't overlap." };
  }

  const saved = await setAgreedAmount(unitId, amount);
  if ("error" in saved) return saved;
  const charged = await addUnitCharge({
    unitId,
    amount,
    kind: "special_assessment",
    periodStart,
    dueOn,
    memo: "Additional agreed assessment",
  });
  if (charged.error) return { error: charged.error as string };
  revalidatePath("/dues");
  return { ok: true as const };
}

/**
 * Records money a unit gave toward a voluntary Additional Agreed Assessment:
 * debit Reserve Cash (1010), credit Special Assessments (4010), both in the
 * reserve fund and tagged to the unit. One balanced entry, in the fiscal year
 * that covers the date. Use it for a check or cash, or money already in the
 * reserve account. A deposit that is also in the bank feed must not be
 * recorded twice. For a required assessment, record a payment instead: it
 * applies to the charge.
 */
export async function recordReserveContribution(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const amount = Number(String(formData.get("contribution_amount") ?? "").replace(/[^0-9.]/g, ""));
  const receivedOn = String(formData.get("received_on") ?? "") || buildingTodayIso();
  if (!unitId) return { error: "Choose the unit." };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter the amount given." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) return { error: "Enter the date it was received." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const [{ data: accounts }, { data: funds }, { data: years }, { data: units }, { data: required }] = await Promise.all([
    supabase.from("accounts").select("id, code").in("code", ["1010", "4010"]).eq("is_active", true),
    supabase.from("funds").select("id").eq("kind", "reserve").limit(1),
    supabase.from("fiscal_years").select("id").lte("starts_on", receivedOn).gte("ends_on", receivedOn).limit(1),
    supabase.from("units").select("label").eq("id", unitId).limit(1),
    supabase
      .from("assessment_charges")
      .select("id")
      .eq("unit_id", unitId)
      .eq("charge_type", "special_assessment")
      .eq("period_start", `${receivedOn.slice(0, 4)}-01-01`)
      .is("waived_at", null)
      .is("written_off_at", null)
      .limit(1),
  ]);
  if (required?.length) return { error: "This unit's assessment is required this year. Record the money as a payment, so it applies to the charge." };
  const cash = accounts?.find((a) => a.code === "1010")?.id;
  const income = accounts?.find((a) => a.code === "4010")?.id;
  const fundId = funds?.[0]?.id;
  const fiscalYearId = years?.[0]?.id;
  if (!cash || !income) return { error: "The Reserve Cash (1010) or Special Assessments (4010) account is missing from the chart of accounts." };
  if (!fundId) return { error: "No reserve fund is set up yet." };
  if (!fiscalYearId) return { error: "No fiscal year covers that date." };

  const label = units?.[0]?.label ?? "Unit";
  const cents = Math.round(amount * 100);
  const { error } = await supabase.rpc("post_journal_entry", {
    p_association_id: associationId,
    p_fiscal_year_id: fiscalYearId,
    p_entry_date: receivedOn,
    p_memo: `Additional agreed assessment · ${label}`,
    p_source: "manual",
    p_lines: [
      { account_id: cash, fund_id: fundId, unit_id: unitId, debit: cents / 100 },
      { account_id: income, fund_id: fundId, unit_id: unitId, credit: cents / 100 },
    ],
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/dues");
  revalidatePath("/");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Property manager and main contact for a unit (0066).
//
// A unit can have one property manager: a person record (no login) linked to
// the unit. The main contact is who Walkup's own email goes to by default for
// that unit. It starts as the owner, and only becomes the manager when a board
// member says so. Walkup's email to a unit's manager covers that unit only.
// ---------------------------------------------------------------------------

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Adds or updates a unit's property manager. A board member's action. */
export async function savePropertyManager(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const name = String(formData.get("manager_name") ?? "").trim();
  const email = String(formData.get("manager_email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("manager_phone") ?? "").trim();
  const company = String(formData.get("manager_company") ?? "").trim();
  if (!unitId) return { error: "Choose the unit." };
  if (!name) return { error: "Enter the manager's name." };
  if (name.length > 120) return { error: "That name is too long." };
  if (email && !EMAIL_OK.test(email)) return { error: "Enter a valid email address, or leave it blank." };
  if (phone.length > 40) return { error: "That phone number is too long." };
  if (company.length > 120) return { error: "That company name is too long." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data: existing } = await supabase
    .from("unit_property_managers")
    .select("person_id, main_contact")
    .eq("unit_id", unitId)
    .limit(1);
  const current = existing?.[0];

  let personId = current?.person_id as string | undefined;
  if (personId) {
    const { error } = await supabase
      .from("persons")
      .update({ full_name: name, email: email || null, phone: phone || null })
      .eq("id", personId);
    if (error) return { error: error.code === "42501" ? "Only a board member can change a manager." : friendly(error) };
    const { error: linkError } = await supabase
      .from("unit_property_managers")
      // With no email the manager cannot be the main contact, so it goes back to the owner.
      .update({ company: company || null, ...(email ? {} : { main_contact: "owner" }) })
      .eq("unit_id", unitId);
    if (linkError) return { error: friendly(linkError) };
  } else {
    const { data: created, error } = await supabase
      .from("persons")
      .insert({ association_id: associationId, full_name: name, email: email || null, phone: phone || null })
      .select("id")
      .limit(1);
    if (error || !created?.[0]) {
      return { error: error?.code === "42501" ? "Only a board member can add a manager." : error ? friendly(error) : "Couldn't add the manager." };
    }
    personId = created[0].id as string;
    const { error: linkError } = await supabase.from("unit_property_managers").insert({
      unit_id: unitId,
      association_id: associationId,
      person_id: personId,
      company: company || null,
      main_contact: "owner",
    });
    if (linkError) return { error: friendly(linkError) };
  }

  revalidatePath("/dues");
  revalidatePath("/building");
  return { ok: true as const };
}

/** Chooses who Walkup's email goes to for this unit: the owner (the default) or the property manager. */
export async function setMainContact(unitId: string, main: "owner" | "manager"): Promise<{ ok: true } | { error: string }> {
  if (!unitId || (main !== "owner" && main !== "manager")) return { error: "Choose the owner or the property manager." };
  const supabase = await createClient();
  const { data } = await supabase
    .from("unit_property_managers")
    .select("persons(email)")
    .eq("unit_id", unitId)
    .limit(1);
  const manager = data?.[0] as { persons: { email: string | null } | null } | undefined;
  if (!manager) return { error: "Add a property manager first." };
  if (main === "manager" && !(manager.persons?.email ?? "").trim()) {
    return { error: "Add the manager's email address first. Without it Walkup has nowhere to send." };
  }
  const { error } = await supabase.from("unit_property_managers").update({ main_contact: main }).eq("unit_id", unitId);
  if (error) return { error: error.code === "42501" ? "Only a board member can change the main contact." : friendly(error) };
  revalidatePath("/dues");
  revalidatePath("/delinquency");
  return { ok: true };
}

/** Removes the property manager from a unit. The person stays on the Building & Owners list. */
export async function removePropertyManager(unitId: string): Promise<{ ok: true } | { error: string }> {
  if (!unitId) return { error: "Choose the unit." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("unit_property_managers").delete().eq("unit_id", unitId).select("unit_id");
  if (error) return { error: friendly(error) };
  if (!data || data.length === 0) return { error: "Only a board member can remove a manager." };
  revalidatePath("/dues");
  revalidatePath("/delinquency");
  return { ok: true };
}
