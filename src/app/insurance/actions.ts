"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const COVERAGE_TYPES = [
  "property",
  "general_liability",
  "umbrella",
  "directors_officers",
  "flood",
  "workers_comp",
  "other",
] as const;

function optionalText(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function optionalMoney(formData: FormData, key: string): number | null | "invalid" {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

/**
 * Records a policy the board already holds — Walkup is not a broker and
 * this is bookkeeping, not advice. insurance_policies_insert (0013) permits
 * board members; anyone else's insert matches zero rows.
 */
export async function recordInsurancePolicy(_prev: unknown, formData: FormData) {
  const coverage = String(formData.get("coverage") ?? "");
  const carrierName = String(formData.get("carrier_name") ?? "").trim();
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const effectiveTo = String(formData.get("effective_to") ?? "");
  const annualPremium = optionalMoney(formData, "annual_premium");
  const deductible = optionalMoney(formData, "deductible");
  const coverageLimit = optionalMoney(formData, "coverage_limit");

  if (!(COVERAGE_TYPES as readonly string[]).includes(coverage)) {
    return { error: "Choose what the policy covers." };
  }
  if (!carrierName) return { error: "Enter the insurer's name." };
  if (!effectiveFrom || !effectiveTo) return { error: "Enter the policy's start and end dates." };
  if (effectiveTo <= effectiveFrom) return { error: "The end date has to be after the start date." };
  if (annualPremium === null || annualPremium === "invalid") {
    return { error: "Enter the annual premium as a number of zero or more." };
  }
  if (deductible === "invalid" || coverageLimit === "invalid") {
    return { error: "Deductible and coverage limit must be numbers of zero or more." };
  }

  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  const associationId = associations?.[0]?.id;
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.from("insurance_policies").insert({
    association_id: associationId,
    coverage,
    carrier_name: carrierName,
    broker_name: optionalText(formData, "broker_name"),
    broker_email: optionalText(formData, "broker_email"),
    policy_number: optionalText(formData, "policy_number"),
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    annual_premium: annualPremium,
    deductible,
    coverage_limit: coverageLimit,
    notes: optionalText(formData, "notes"),
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Only a board member can record a policy."
          : error.message,
    };
  }

  revalidatePath("/insurance");
  revalidatePath("/");
  return { ok: true };
}
