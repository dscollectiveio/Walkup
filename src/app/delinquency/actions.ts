"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The RPC (record_payment, 0015) has existed with no way to call it from the
 * app — every payment on record was written by a migration or seed script.
 * This is the form.
 *
 * Allocated oldest-charge-first, not left unallocated. record_payment
 * supports an unallocated payment (prepaid assessment / unapplied cash), but
 * this form is reached from the Who-owes page specifically to pay down what
 * a unit is behind on — leaving it unallocated would record the cash
 * correctly while the aging table kept showing the unit as fully
 * delinquent, since delinquency_aging reads charge_balances, which is
 * driven by payment_allocations, not by the payment total. Any amount left
 * over after every open charge is covered is passed through unallocated on
 * purpose, as a genuine prepayment.
 */
export async function recordPayment(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const amount = Number(formData.get("amount") ?? "");
  const receivedOn = String(formData.get("received_on") ?? "");
  const method = String(formData.get("method") ?? "").trim() || null;
  const reference = String(formData.get("reference") ?? "").trim() || null;

  if (!unitId) return { error: "Choose a unit." };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Enter an amount greater than zero." };
  }
  if (!receivedOn) return { error: "Enter the date received." };

  const supabase = await createClient();

  const [{ data: associations }, { data: fiscalYears }, { data: accounts }, { data: funds }, { data: openCharges }] =
    await Promise.all([
      supabase.from("associations").select("id").limit(1),
      supabase.from("fiscal_years").select("id").order("starts_on", { ascending: false }).limit(1),
      // Operating Cash (1000) and Assessments Receivable (1200) — the fixed
      // codes seed_chart_of_accounts always uses. Same assumption the rest
      // of this app already makes implicitly (delinquency_aging, the tax
      // views); nothing here introduces a new dependency on it.
      supabase.from("accounts").select("id, code").in("code", ["1000", "1200"]),
      supabase.from("funds").select("id, kind").eq("kind", "operating").limit(1),
      supabase
        .from("charge_balances")
        .select("id, balance, due_on")
        .eq("unit_id", unitId)
        .in("status", ["open", "partial"])
        .order("due_on", { ascending: true }),
    ]);

  const associationId = associations?.[0]?.id;
  const fiscalYearId = fiscalYears?.[0]?.id;
  const cashAccountId = accounts?.find((a) => a.code === "1000")?.id;
  const arAccountId = accounts?.find((a) => a.code === "1200")?.id;
  const fundId = funds?.[0]?.id;

  if (!associationId || !fiscalYearId || !cashAccountId || !arAccountId || !fundId) {
    return { error: "Couldn't find the accounts a payment needs. Check the chart of accounts." };
  }

  let remaining = amount;
  const allocations: { charge_id: string; amount: number }[] = [];
  for (const charge of openCharges ?? []) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, Number(charge.balance));
    if (applied <= 0) continue;
    allocations.push({ charge_id: charge.id, amount: Math.round(applied * 100) / 100 });
    remaining = Math.round((remaining - applied) * 100) / 100;
  }

  const { error } = await supabase.rpc("record_payment", {
    p_association_id: associationId,
    p_unit_id: unitId,
    p_fiscal_year_id: fiscalYearId,
    p_received_on: receivedOn,
    p_amount: amount,
    p_fund_id: fundId,
    p_cash_account_id: cashAccountId,
    p_ar_account_id: arAccountId,
    p_method: method,
    p_reference: reference,
    p_allocations: allocations,
  });

  if (error) return { error: error.message };

  revalidatePath("/delinquency");
  revalidatePath("/");
  revalidatePath(`/units/${unitId}`);
  return { ok: true };
}
