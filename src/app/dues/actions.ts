"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { currentPeriodStart, perUnitAmount, type DuesFrequency } from "@/lib/dues/period";

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
    supabase.from("associations").select("id").limit(1),
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
    return { error: error.code === "42501" ? "Only a board member can set a dues schedule." : error.message };
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
    if (error) errors.push(error.message);
    else charged += 1;
  }

  revalidatePath("/dues");
  revalidatePath("/");
  revalidatePath("/ledger");
  return { ok: true, charged, skipped: alreadyCharged.size, errors };
}

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
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

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can edit payment instructions." };
  }

  revalidatePath("/dues");
  return { ok: true };
}
