"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { autofill, isReadyToSign, mergeWithExisting, type AutofillInput, type FieldMap } from "@/lib/tax/autofill";
import { run1120hTests, type FormCode } from "@/lib/tax/determine";
import { storeGeneratedDocument } from "@/lib/documents/store-generated";
import { loadTaxContext, type TaxContext } from "./data";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FORM_CODES: FormCode[] = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report"];

function revalidateTax(formId?: string) {
  revalidatePath("/tax");
  if (formId) revalidatePath(`/tax/forms/${formId}`);
  revalidatePath("/");
}

/** Board-only — every tax write goes through RLS as the signed-in board member. */
export async function confirmIncomeClassification(accountId: string, isExempt: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_income_classification", {
    p_account_id: accountId,
    p_is_exempt: isExempt,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can classify income." : error.message };
  revalidateTax();
  return { ok: true };
}

/** The inputs a form's field map can read, built from the same context the tab shows. */
function autofillInputFor(ctx: TaxContext, vendorId: string | null): AutofillInput {
  const a = ctx.association;
  const f = ctx.input.figures;
  const tests = run1120hTests(ctx.input);
  const unsettledReasons = [
    ctx.input.unconfirmedIncomeAccounts.length > 0 ? "Some income isn't classified yet." : null,
    tests?.some((t) => t.nearThreshold) ? "A 1120-H test is within 5 points of its threshold." : null,
    ctx.overridesThisYear > 0 ? "Some transactions were reclassified by hand this year." : null,
  ].filter(Boolean) as string[];
  const c = vendorId ? ctx.contractorRows.find((r) => r.vendorId === vendorId) : null;
  const thresholdCents = Math.round((ctx.input.parameters.find((p) => p.key === "form_1099_nec_threshold")?.value ?? Infinity) * 100);
  const over = ctx.contractorRows.filter((r) => r.totalCents >= thresholdCents);

  return {
    settings: {
      "association.legal_name": a.legal_name,
      "association.ein": a.ein,
      "association.street_address": a.street_address,
      "association.city": a.city,
      "association.state_code": a.state_code,
      "association.postal_code": a.postal_code,
      "association.city_state_zip": [a.city, [a.state_code, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
      "association.incorporated_on": a.incorporated_on,
      "fiscal_year.starts_on": ctx.fiscalYear.starts_on,
      "fiscal_year.ends_on": ctx.fiscalYear.ends_on,
    },
    ledger: {
      exempt_income: { cents: f.exemptIncomeCents, refs: ctx.receiptLineIds.exempt },
      nonexempt_income: { cents: f.grossIncomeCents - f.exemptIncomeCents, refs: ctx.receiptLineIds.nonexempt },
      gross_income: { cents: f.grossIncomeCents, refs: [...ctx.receiptLineIds.exempt, ...ctx.receiptLineIds.nonexempt] },
      exempt_expenditures: { cents: f.exemptExpendituresCents, refs: ctx.disbursementLineIds.exempt },
      total_expenditures: { cents: f.totalExpendituresCents, refs: ctx.disbursementLineIds.all },
    },
    ledgerSettled: unsettledReasons.length === 0,
    ledgerReviewReason: unsettledReasons.join(" ") || null,
    contractor: c ? { name: c.name, address: c.address, totalCents: c.totalCents, expenseIds: c.expenseIds } : null,
    contractors: {
      count: over.length,
      totalCents: over.reduce((s, r) => s + r.totalCents, 0),
      expenseIds: over.flatMap((r) => r.expenseIds),
    },
    parameters: Object.fromEntries(ctx.input.parameters.map((p) => [p.key, p.value])),
  };
}

async function recomputeStatus(supabase: Supabase, formId: string) {
  const { data: form } = await supabase.from("tax_forms").select("status").eq("id", formId).limit(1);
  if (!form?.[0] || form[0].status === "filed") return;
  const { data: fields } = await supabase
    .from("tax_form_fields")
    .select("value, confidence, confirmed_at, leave_blank, proposed_value")
    .eq("tax_form_id", formId);
  const rows = (fields ?? []).map((f) => ({
    value: f.value,
    confidence: f.confidence,
    confirmedAt: f.confirmed_at,
    leaveBlank: f.leave_blank,
    proposedValue: f.proposed_value,
  }));
  const status = rows.length === 0 ? "draft" : isReadyToSign(rows) ? "ready_to_sign" : "in_review";
  await supabase.from("tax_forms").update({ status, updated_at: new Date().toISOString() }).eq("id", formId);
}

/**
 * Fills a form from the association's records through its verified template's
 * map. Never touches a field a person confirmed or typed — a newer value is
 * kept aside as "your records now say…".
 */
async function runAutofill(supabase: Supabase, formId: string): Promise<{ error?: string; noTemplate?: boolean }> {
  const { data: forms } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, vendor_id, status")
    .eq("id", formId)
    .limit(1);
  const form = forms?.[0];
  if (!form) return { error: "Form not found." };
  if (form.status === "filed") return { error: "This form is filed; it can't be refilled." };

  const { data: templates } = await supabase
    .from("tax_form_templates")
    .select("id, field_map_json")
    .eq("form_code", form.form_code)
    .eq("tax_year", form.tax_year)
    .eq("active", true)
    .limit(1);
  const template = templates?.[0];
  if (!template) {
    await supabase.from("tax_forms").update({ template_id: null, status: "draft" }).eq("id", formId);
    return { noTemplate: true };
  }

  const ctx = await loadTaxContext(supabase);
  if (!ctx) return { error: "No fiscal year is set up yet." };

  const filled = autofill(template.field_map_json as FieldMap, autofillInputFor(ctx, form.vendor_id));
  const { data: existingRows } = await supabase
    .from("tax_form_fields")
    .select("pdf_field_name, value, user_edited, confirmed_at, confirmed_by, leave_blank")
    .eq("tax_form_id", formId);
  const existing = new Map((existingRows ?? []).map((e) => [e.pdf_field_name, e]));

  const rows = filled.map((f) => {
    const prev = existing.get(f.pdfFieldName);
    const merged = mergeWithExisting(
      f,
      prev ? { value: prev.value, userEdited: prev.user_edited, confirmedAt: prev.confirmed_at, leaveBlank: prev.leave_blank } : undefined,
    );
    return {
      association_id: form.association_id,
      tax_form_id: formId,
      pdf_field_name: f.pdfFieldName,
      label: f.label,
      section: f.section,
      citation: f.citation,
      value: merged.value,
      source: f.source,
      source_ref_json: f.sourceRef,
      confidence: f.confidence,
      proposed_value: merged.proposedValue,
      user_edited: merged.keepConfirmation ? (prev?.user_edited ?? false) : false,
      leave_blank: merged.keepConfirmation ? (prev?.leave_blank ?? false) : false,
      confirmed_at: merged.keepConfirmation ? (prev?.confirmed_at ?? null) : null,
      confirmed_by: merged.keepConfirmation ? (prev?.confirmed_by ?? null) : null,
      updated_at: new Date().toISOString(),
    };
  });
  if (rows.length > 0) {
    const { error } = await supabase.from("tax_form_fields").upsert(rows, { onConflict: "tax_form_id,pdf_field_name" });
    if (error) return { error: error.message };
  }
  await supabase.from("tax_forms").update({ template_id: template.id }).eq("id", formId);
  await recomputeStatus(supabase, formId);
  return {};
}

/** "Start" on a form card: record the determination, fill it, open it. */
export async function startForm(formCode: string, taxYear: number, vendorId: string | null) {
  if (!FORM_CODES.includes(formCode as FormCode)) return { error: "Unknown form." };
  const supabase = await createClient();
  const ctx = await loadTaxContext(supabase);
  if (!ctx) return { error: "No fiscal year is set up yet." };
  const outcome = ctx.forms.find(
    (f) => f.formCode === formCode && f.taxYear === taxYear && (f.vendorId ?? null) === vendorId,
  );
  if (!outcome) return { error: "This form isn't on this year's list." };

  const { data: existing } = await supabase
    .from("tax_forms")
    .select("id")
    .eq("form_code", formCode)
    .eq("tax_year", taxYear)
    .filter("vendor_id", vendorId ? "eq" : "is", vendorId ?? null)
    .limit(1);
  let formId = existing?.[0]?.id as string | undefined;

  if (!formId) {
    const { data, error } = await supabase
      .from("tax_forms")
      .insert({
        association_id: ctx.association.id,
        form_code: formCode,
        tax_year: taxYear,
        fiscal_year_id: ["irs_1099_nec", "irs_1096"].includes(formCode) ? null : ctx.fiscalYear.id,
        vendor_id: vendorId,
        determination: outcome.determination,
        determination_reason: outcome.reason,
        due_on: outcome.dueOn,
        status: "draft",
      })
      .select("id");
    if (error) return { error: error.code === "42501" ? "Only a board member can start a tax form." : error.message };
    formId = data![0].id as string;
  } else {
    await supabase
      .from("tax_forms")
      .update({ determination: outcome.determination, determination_reason: outcome.reason, due_on: outcome.dueOn })
      .eq("id", formId);
  }

  const r = await runAutofill(supabase, formId);
  if (r.error) return { error: r.error };
  revalidateTax(formId);
  redirect(`/tax/forms/${formId}`);
}

export async function refreshFromRecords(formId: string) {
  const supabase = await createClient();
  const r = await runAutofill(supabase, formId);
  revalidateTax(formId);
  return r.error ? { error: r.error } : { ok: true, noTemplate: r.noTemplate ?? false };
}

async function updateField(fieldId: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_form_fields")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", fieldId)
    .select("tax_form_id");
  if (error) return { error: error.message };
  const formId = data?.[0]?.tax_form_id as string | undefined;
  if (!formId) return { error: "Only a board member can change a form." };
  await recomputeStatus(supabase, formId);
  revalidateTax(formId);
  return { ok: true };
}

export async function confirmField(fieldId: string) {
  const user = await getUser();
  return updateField(fieldId, { confirmed_at: new Date().toISOString(), confirmed_by: user?.id ?? null, leave_blank: false });
}

export async function editField(fieldId: string, value: string) {
  const user = await getUser();
  const v = value.trim();
  return updateField(fieldId, {
    value: v === "" ? null : v,
    user_edited: true,
    proposed_value: null,
    leave_blank: v === "",
    confirmed_at: v === "" ? null : new Date().toISOString(),
    confirmed_by: v === "" ? null : (user?.id ?? null),
  });
}

export async function leaveFieldBlank(fieldId: string) {
  return updateField(fieldId, { value: null, leave_blank: true, confirmed_at: null, confirmed_by: null, proposed_value: null });
}

/** "Your records now say $X, you entered $Y" — take the records' value, or keep yours. */
export async function resolveProposed(fieldId: string, take: "records" | "mine") {
  const supabase = await createClient();
  const { data } = await supabase.from("tax_form_fields").select("proposed_value").eq("id", fieldId).limit(1);
  const proposed = data?.[0]?.proposed_value ?? null;
  if (take === "records") {
    return updateField(fieldId, { value: proposed, proposed_value: null, user_edited: false, confirmed_at: null, confirmed_by: null, leave_blank: false });
  }
  return updateField(fieldId, { proposed_value: null });
}

/** "Mark as filed" — with the date and, optionally, proof. Also locks the 1120-H figures (0022). */
export async function markFormFiled(_prev: unknown, formData: FormData) {
  const formId = String(formData.get("form_id") ?? "");
  const filedOn = String(formData.get("filed_on") ?? "");
  if (!formId || !filedOn) return { error: "Enter the date it was filed." };

  const supabase = await createClient();
  const { data: forms } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, fiscal_year_id, status")
    .eq("id", formId)
    .limit(1);
  const form = forms?.[0];
  if (!form) return { error: "Form not found." };
  if (form.status !== "ready_to_sign") return { error: "Every figure needs confirming before this can be marked filed." };

  let proofId: string | null = null;
  const proof = formData.get("proof");
  if (proof instanceof File && proof.size > 0) {
    if (proof.size > 25 * 1024 * 1024) return { error: "The proof file is larger than 25 MB." };
    const stored = await storeGeneratedDocument(supabase, {
      associationId: form.association_id,
      bytes: new Uint8Array(await proof.arrayBuffer()),
      filename: proof.name,
      mimeType: proof.type || "application/pdf",
      categorySlug: "tax_form",
      title: `Proof of filing — ${form.form_code} ${form.tax_year}`,
      link: { targetTable: "tax_forms", targetId: formId, relation: "proof_of_filing" },
    });
    if ("error" in stored) return { error: stored.error };
    proofId = stored.id;
  }

  const { error } = await supabase
    .from("tax_forms")
    .update({ status: "filed", filed_on: filedOn, filed_proof_document_id: proofId, updated_at: new Date().toISOString() })
    .eq("id", formId);
  if (error) return { error: error.message };

  if (form.form_code === "irs_1120h" && form.fiscal_year_id) {
    const { data: filings } = await supabase
      .from("tax_filings")
      .select("id, locked_at")
      .eq("fiscal_year_id", form.fiscal_year_id)
      .eq("form", "1120-H")
      .limit(1);
    if (filings?.[0] && !filings[0].locked_at) {
      await supabase.rpc("lock_tax_filing", { p_filing_id: filings[0].id, p_filed_on: filedOn });
    }
  }

  revalidateTax(formId);
  return { ok: true };
}
