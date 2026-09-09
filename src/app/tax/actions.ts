"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  return associations?.[0]?.id ?? null;
}

function revalidateTax() {
  revalidatePath("/tax");
  revalidatePath("/");
}

/** Freezes this year's worksheet figures, with provenance, from the ledger. */
export async function saveTaxFiling(_prev: unknown, formData: FormData) {
  const fiscalYearId = String(formData.get("fiscal_year_id") ?? "");
  if (!fiscalYearId) return { error: "Missing which fiscal year to save." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase.rpc("compute_and_save_tax_filing", {
    p_association_id: associationId,
    p_fiscal_year_id: fiscalYearId,
  });

  if (error) {
    if (error.code === "42501") return { error: "Only the board can save this year's figures." };
    return { error: error.message };
  }

  revalidateTax();
  return { ok: true as const };
}

/** Marks a saved filing as filed. Freezes it — no further recompute or edit. */
export async function markTaxFilingFiled(_prev: unknown, formData: FormData) {
  const filingId = String(formData.get("filing_id") ?? "");
  const filedOn = String(formData.get("filed_on") ?? "").trim();
  if (!filingId) return { error: "Missing which filing to mark as filed." };
  if (!filedOn) return { error: "Enter the date it was filed." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("lock_tax_filing", {
    p_filing_id: filingId,
    p_filed_on: filedOn,
  });

  if (error) {
    if (error.code === "42501") return { error: "Only the board can mark a filing as filed." };
    return { error: error.message };
  }

  revalidateTax();
  return { ok: true as const };
}

/**
 * Sets or clears a transaction's tax treatment. This does not touch the
 * ledger — journal_lines are immutable once posted — it layers an override
 * on top, the way a document's tag can be corrected without editing the file.
 */
export async function setLineClassification(_prev: unknown, formData: FormData) {
  const journalLineId = String(formData.get("journal_line_id") ?? "");
  const isExempt = formData.get("is_exempt") === "true";
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!journalLineId) return { error: "Missing which transaction to reclassify." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("tax_line_classifications").upsert(
    {
      association_id: associationId,
      journal_line_id: journalLineId,
      is_exempt: isExempt,
      note,
      updated_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "journal_line_id" },
  );

  if (error) {
    if (error.message.includes("row-level security")) {
      return { error: "Only the board can change a transaction's tax treatment." };
    }
    return { error: error.message };
  }

  revalidateTax();
  return { ok: true as const };
}

/** Reverts a transaction to its account's default tax treatment. */
export async function clearLineClassification(_prev: unknown, formData: FormData) {
  const journalLineId = String(formData.get("journal_line_id") ?? "");
  if (!journalLineId) return { error: "Missing which transaction to revert." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tax_line_classifications")
    .delete({ count: "exact" })
    .eq("journal_line_id", journalLineId);

  if (error) return { error: error.message };
  if (!count) return { error: "Only the board can change a transaction's tax treatment." };

  revalidateTax();
  return { ok: true as const };
}
