"use server";

import { scrubIdentifiers } from "@/lib/tax/copy";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { autofill, derivedSettings, isReadyToSign, mergeWithExisting, type AutofillInput, type FieldMap } from "@/lib/tax/autofill";
import { run1120hTests, type FormCode } from "@/lib/tax/determine";
import { storeGeneratedDocument } from "@/lib/documents/store-generated";
import { isInformationReturn, loadTaxContext, type SentSnapshot, type TaxContext } from "./data";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FORM_CODES: FormCode[] = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report"];

const NO_FISCAL_YEAR = "No fiscal year is set up yet.";
const onlyBoard = (what: string) => `Only a board member can ${what}.`;

/** A tax_forms row, as much of it as the actions here need. */
interface FormRow {
  id: string;
  association_id: string;
  form_code: string;
  tax_year: number;
  vendor_id: string | null;
  fiscal_year_id: string | null;
  template_id: string | null;
  status: string;
}

function revalidateTax(formId?: string) {
  revalidatePath("/tax");
  if (formId) revalidatePath(`/tax/forms/${formId}`);
  revalidatePath("/");
}

async function currentAssociationId(supabase: Supabase) {
  const { data: associations } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  return (associations?.[0]?.id as string | undefined) ?? null;
}

async function loadForm(supabase: Supabase, formId: string): Promise<FormRow | null> {
  const { data } = await supabase
    .from("tax_forms")
    .select("id, association_id, form_code, tax_year, vendor_id, fiscal_year_id, template_id, status")
    .eq("id", formId)
    .limit(1);
  return (data?.[0] as FormRow | undefined) ?? null;
}

/**
 * The context for a form's own year — the fiscal year it reports, or the
 * payment year for a 1099/1096 — never whichever year the tab happens to be
 * showing. A 2025 return filled in 2027 still reads 2025's books and 2025's
 * rules.
 */
async function contextForForm(supabase: Supabase, form: FormRow): Promise<{ ctx: TaxContext } | { error: string }> {
  const ctx = await loadTaxContext(supabase, {
    fiscalYearId: form.fiscal_year_id ?? undefined,
    contractorYear: isInformationReturn(form.form_code) ? form.tax_year : undefined,
  });
  if (!ctx) return { error: NO_FISCAL_YEAR };
  if (form.fiscal_year_id && ctx.fiscalYear.id !== form.fiscal_year_id) return { error: "This form's fiscal year isn't on file any more." };
  return { ctx };
}

/**
 * The context for a card's year before its form exists: the payment year for
 * a 1099/1096, else the fiscal year ending in `taxYear` — the tab may be
 * showing an earlier year through `?fy=`, and the card belongs to that one.
 */
async function contextForYear(supabase: Supabase, formCode: string, taxYear: number): Promise<{ ctx: TaxContext } | { error: string }> {
  if (isInformationReturn(formCode)) {
    const ctx = await loadTaxContext(supabase, { contractorYear: taxYear });
    return ctx ? { ctx } : { error: NO_FISCAL_YEAR };
  }
  const ctx = await loadTaxContext(supabase);
  if (!ctx) return { error: NO_FISCAL_YEAR };
  if (ctx.fiscalYear.taxYear === taxYear) return { ctx };
  const fy = ctx.fiscalYears.find((f) => Number(f.ends_on.slice(0, 4)) === taxYear);
  if (!fy) return { error: `No fiscal year on file ends in ${taxYear}.` };
  const forThatYear = await loadTaxContext(supabase, { fiscalYearId: fy.id });
  return forThatYear ? { ctx: forThatYear } : { error: NO_FISCAL_YEAR };
}

/** The key deadlines.ts gives a form, so a tax_forms row finds its date in ctx.deadlines. */
const deadlineKey = (formCode: string, taxYear: number, vendorId: string | null) =>
  vendorId ? `${formCode}:${taxYear}:${vendorId}` : `${formCode}:${taxYear}`;

function outcomeFor(ctx: TaxContext, formCode: string, taxYear: number, vendorId: string | null) {
  return ctx.forms.find((f) => f.formCode === formCode && f.taxYear === taxYear && (f.vendorId ?? null) === vendorId) ?? null;
}

/**
 * What the tab says about a form today — its determination and the date from
 * the one list every reminder reads (a verified rule, else the labeled
 * estimate, else null) — as a tax_forms patch. A form whose deadline has
 * rolled to a later year, or that has dropped off the list, keeps what it has.
 */
function refreshPatch(ctx: TaxContext, form: Pick<FormRow, "form_code" | "tax_year" | "vendor_id">): Record<string, unknown> {
  const vendorId = form.vendor_id ?? null;
  const outcome = outcomeFor(ctx, form.form_code, form.tax_year, vendorId);
  const deadline = ctx.deadlines.find((d) => d.key === deadlineKey(form.form_code, form.tax_year, vendorId));
  const patch: Record<string, unknown> = {};
  if (deadline) patch.due_on = deadline.dueOn;
  else if (outcome) patch.due_on = outcome.dueOn;
  if (outcome) {
    patch.determination = outcome.determination;
    patch.determination_reason = outcome.reason;
  }
  return patch;
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

/**
 * The inputs a form's field map can read, built from the same context the tab
 * shows — for the form's own year. `entered` is what the person has typed on
 * the manual lines so far, which the calculated lines add up.
 */
function autofillInputFor(
  ctx: TaxContext,
  form: { taxYear: number; vendorId: string | null },
  entered: AutofillInput["entered"],
): AutofillInput {
  const a = ctx.association;
  const f = ctx.input.figures;
  const tests = run1120hTests(ctx.input);
  const unsettledReasons = [
    ctx.input.unconfirmedIncomeAccounts.length > 0 ? "Some income isn't classified yet." : null,
    tests?.some((t) => t.nearThreshold) ? "A 1120-H test is within 5 points of its threshold." : null,
    ctx.overridesThisYear > 0 ? "Some transactions were reclassified by hand this year." : null,
  ].filter(Boolean) as string[];
  const c = form.vendorId ? ctx.contractorRows.find((r) => r.vendorId === form.vendorId) : null;
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
      // MM/DD/YYYY, the non-calendar header boxes and the form's year, spelled in one tested place.
      ...derivedSettings({
        incorporatedOn: a.incorporated_on,
        fiscalYear: { startsOn: ctx.fiscalYear.starts_on, endsOn: ctx.fiscalYear.ends_on },
        taxYear: form.taxYear,
      }),
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
    entered,
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
 * map, for the form's own year. Never touches a field a person confirmed or
 * typed — a newer value is kept aside as "your records now say…" — except the
 * calculated lines, which follow their operands and confirm themselves.
 * Whatever the template situation, the form's due date and determination are
 * brought back in step with the tab.
 */
async function runAutofill(supabase: Supabase, formId: string): Promise<{ error?: string; noTemplate?: boolean }> {
  const form = await loadForm(supabase, formId);
  if (!form) return { error: "Form not found." };
  if (form.status === "filed") return { error: "This form is filed; it can't be refilled." };

  const loaded = await contextForForm(supabase, form);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;
  const refresh = refreshPatch(ctx, form);
  const now = new Date().toISOString();

  const { data: templates } = await supabase
    .from("tax_form_templates")
    .select("id, kind, field_map_json")
    .eq("form_code", form.form_code)
    .eq("tax_year", form.tax_year)
    .eq("active", true)
    .limit(1);
  const template = templates?.[0];
  if (!template || template.kind !== "pdf") {
    // Nothing to fill: no template, or a link-only one (its id is kept so the
    // form page and the export can read its rules, but it has no fields).
    await supabase
      .from("tax_forms")
      .update({ template_id: template?.id ?? null, status: "draft", ...refresh, updated_at: now })
      .eq("id", formId);
    return { noTemplate: true };
  }

  const { data: existingRows } = await supabase
    .from("tax_form_fields")
    .select("pdf_field_name, value, user_edited, confirmed_at, confirmed_by, leave_blank, source_ref_json")
    .eq("tax_form_id", formId);
  const existing = new Map((existingRows ?? []).map((e) => [e.pdf_field_name as string, e]));
  const entered = Object.fromEntries(
    (existingRows ?? []).map((e) => [e.pdf_field_name as string, { value: (e.value as string | null) ?? null, leaveBlank: e.leave_blank === true }]),
  );

  const filled = autofill(template.field_map_json as FieldMap, autofillInputFor(ctx, { taxYear: form.tax_year, vendorId: form.vendor_id }, entered));
  const rows = filled.map((f) => {
    const prev = existing.get(f.pdfFieldName);
    const merged = mergeWithExisting(
      f,
      prev
        ? {
            value: prev.value,
            userEdited: prev.user_edited,
            confirmedAt: prev.confirmed_at,
            leaveBlank: prev.leave_blank,
            dismissedValue: ((prev.source_ref_json as Record<string, unknown> | null)?.dismissed_records_value as string | undefined) ?? null,
          }
        : undefined,
    );
    const keep = merged.keepConfirmation;
    const dismissed = ((prev?.source_ref_json as Record<string, unknown> | null)?.dismissed_records_value as string | undefined) ?? null;
    // A calculated line is derived from the others, so it needs no click: it
    // is confirmed the moment it has a value, and again whenever that value
    // changes. Nobody confirms it, so confirmed_by stays empty.
    const calculated = f.source === "calculated";
    const confirmedAt = calculated
      ? merged.value === null ? null : keep ? (prev?.confirmed_at ?? now) : now
      : keep ? (prev?.confirmed_at ?? null) : null;
    const confirmedBy = calculated ? (keep ? (prev?.confirmed_by ?? null) : null) : keep ? (prev?.confirmed_by ?? null) : null;
    return {
      association_id: form.association_id,
      tax_form_id: formId,
      pdf_field_name: f.pdfFieldName,
      label: f.label,
      section: f.section,
      citation: f.citation,
      value: merged.value,
      source: f.source,
      source_ref_json: dismissed !== null && dismissed === f.value ? { ...f.sourceRef, dismissed_records_value: dismissed } : f.sourceRef,
      confidence: f.confidence,
      proposed_value: merged.proposedValue,
      user_edited: !calculated && keep ? (prev?.user_edited ?? false) : false,
      leave_blank: !calculated && keep ? (prev?.leave_blank ?? false) : false,
      confirmed_at: confirmedAt,
      confirmed_by: confirmedBy,
      updated_at: now,
    };
  });
  if (rows.length > 0) {
    const { error } = await supabase.from("tax_form_fields").upsert(rows, { onConflict: "tax_form_id,pdf_field_name" });
    if (error) return { error: error.message };
  }
  await supabase.from("tax_forms").update({ template_id: template.id, ...refresh, updated_at: now }).eq("id", formId);
  await recomputeStatus(supabase, formId);
  return {};
}

/** "Start" on a form card: record the determination and the due date, fill it, open it. */
export async function startForm(formCode: string, taxYear: number, vendorId: string | null) {
  if (!FORM_CODES.includes(formCode as FormCode)) return { error: "Unknown form." };
  const supabase = await createClient();
  const loaded = await contextForYear(supabase, formCode, taxYear);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;
  const outcome = outcomeFor(ctx, formCode, taxYear, vendorId);
  if (!outcome) return { error: "This form isn't on this year's list." };
  // The date every reminder shows: a verified rule, else the labeled estimate, else none.
  const deadline = ctx.deadlines.find((d) => d.key === deadlineKey(formCode, taxYear, vendorId));
  const dueOn = deadline ? deadline.dueOn : (outcome.dueOn ?? null);

  const { data: existing } = await supabase
    .from("tax_forms")
    .select("id, status")
    .eq("form_code", formCode)
    .eq("tax_year", taxYear)
    .filter("vendor_id", vendorId ? "eq" : "is", vendorId ?? null)
    .limit(1);
  let formId = existing?.[0]?.id as string | undefined;
  if (formId && existing?.[0]?.status === "filed") redirect(`/tax/forms/${formId}`);

  if (!formId) {
    const { data, error } = await supabase
      .from("tax_forms")
      .insert({
        association_id: ctx.association.id,
        form_code: formCode,
        tax_year: taxYear,
        fiscal_year_id: isInformationReturn(formCode) ? null : ctx.fiscalYear.id,
        vendor_id: vendorId,
        determination: outcome.determination,
        determination_reason: outcome.reason,
        due_on: dueOn,
        status: "draft",
      })
      .select("id");
    if (error) return { error: error.code === "42501" ? onlyBoard("start a tax form") : error.message };
    formId = data![0].id as string;
  } else {
    await supabase
      .from("tax_forms")
      .update({ determination: outcome.determination, determination_reason: outcome.reason, due_on: dueOn })
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

/**
 * One field changed by a person. The calculated lines read the manual ones,
 * so the form is refilled after every change (the person's own entries are
 * never overwritten), then its status settled either way.
 */
async function updateField(fieldId: string, patch: Record<string, unknown>) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tax_form_fields")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", fieldId)
    .select("tax_form_id");
  if (error) return { error: error.message };
  const formId = data?.[0]?.tax_form_id as string | undefined;
  if (!formId) return { error: onlyBoard("change a form") };
  const r = await runAutofill(supabase, formId);
  await recomputeStatus(supabase, formId);
  revalidateTax(formId);
  return r.error ? { ok: true, warning: `Saved, but the calculated lines couldn't be refreshed: ${r.error}` } : { ok: true };
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
  const { data } = await supabase.from("tax_form_fields").select("proposed_value, source_ref_json").eq("id", fieldId).limit(1);
  const proposed = data?.[0]?.proposed_value ?? null;
  if (take === "records") {
    return updateField(fieldId, { value: proposed, proposed_value: null, user_edited: false, confirmed_at: null, confirmed_by: null, leave_blank: false });
  }
  // Remember what was ignored, so the next refresh doesn't ask again while the records still say it.
  const ref = (data?.[0]?.source_ref_json ?? {}) as Record<string, unknown>;
  return updateField(fieldId, { proposed_value: null, source_ref_json: { ...ref, dismissed_records_value: proposed } });
}

/**
 * "Mark as filed" — with the date and, optionally, proof. Allowed once every
 * line is confirmed, or when there is nothing to confirm in Walkup (no PDF
 * template and no lines: filed by hand or by the accountant). For the 1120-H
 * this is also the one place the year's figures get saved and locked (0022),
 * so the filed return and the frozen figures can't drift apart.
 */
export async function markFormFiled(_prev: unknown, formData: FormData) {
  const formId = String(formData.get("form_id") ?? "");
  const filedOn = String(formData.get("filed_on") ?? "").trim();
  if (!formId || !filedOn) return { error: "Enter the date it was filed." };
  const proof = formData.get("proof");
  const hasProof = proof instanceof File && proof.size > 0;
  if (hasProof && proof.size > 25 * 1024 * 1024) return { error: "The proof file is larger than 25 MB." };

  const supabase = await createClient();
  const form = await loadForm(supabase, formId);
  if (!form) return { error: "Form not found." };
  if (form.status === "filed") return { error: "This form is already marked filed." };

  if (form.status !== "ready_to_sign") {
    const [{ data: templates }, { count }] = await Promise.all([
      form.template_id
        ? supabase.from("tax_form_templates").select("kind").eq("id", form.template_id).limit(1)
        : Promise.resolve({ data: null }),
      supabase.from("tax_form_fields").select("id", { count: "exact", head: true }).eq("tax_form_id", formId),
    ]);
    const hasPdfTemplate = templates?.[0]?.kind === "pdf";
    if (hasPdfTemplate || (count ?? 0) > 0) return { error: "Every figure needs confirming before this can be marked filed." };
  }

  if (form.form_code === "irs_1120h" && form.fiscal_year_id) {
    const { data: filings } = await supabase
      .from("tax_filings")
      .select("id, locked_at")
      .eq("fiscal_year_id", form.fiscal_year_id)
      .eq("form", "1120-H")
      .limit(1);
    let filingId = filings?.[0]?.id as string | undefined;
    const alreadyLocked = Boolean(filings?.[0]?.locked_at);
    if (!filingId) {
      const { data, error } = await supabase.rpc("compute_and_save_tax_filing", {
        p_association_id: form.association_id,
        p_fiscal_year_id: form.fiscal_year_id,
      });
      if (error) {
        return { error: error.code === "42501" ? onlyBoard("mark a form as filed") : `The year's figures couldn't be saved first: ${error.message}` };
      }
      filingId = (data as string | null) ?? undefined;
    }
    if (filingId && !alreadyLocked) {
      const { error } = await supabase.rpc("lock_tax_filing", { p_filing_id: filingId, p_filed_on: filedOn });
      if (error) return { error: error.code === "42501" ? onlyBoard("mark a form as filed") : error.message };
    }
  }

  let proofId: string | null = null;
  if (hasProof) {
    const stored = await storeGeneratedDocument(supabase, {
      associationId: form.association_id,
      bytes: new Uint8Array(await proof.arrayBuffer()),
      filename: proof.name,
      mimeType: proof.type || "application/pdf",
      categorySlug: "tax_form",
      title: `Proof of filing: ${form.form_code} ${form.tax_year}`,
      link: { targetTable: "tax_forms", targetId: formId, relation: "proof_of_filing" },
    });
    if ("error" in stored) return { error: stored.error };
    proofId = stored.id;
  }

  const { data: updated, error } = await supabase
    .from("tax_forms")
    .update({ status: "filed", filed_on: filedOn, filed_proof_document_id: proofId, updated_at: new Date().toISOString() })
    .eq("id", formId)
    .select("id");
  if (error) return { error: error.message };
  if (!updated?.length) return { error: onlyBoard("mark a form as filed") };

  revalidateTax(formId);
  return { ok: true };
}

/**
 * Name the accountant: a persons row (DECISIONS #30) found by email or added,
 * then pointed at through set_accountant() (board members too — it's a
 * contact, not an access grant). Fields: full_name, firm, email.
 */
export async function setAccountant(_prev: unknown, formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const firm = String(formData.get("firm") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim();
  if (!fullName) return { error: "Give your accountant a name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter your accountant's email address. The drafts are addressed to it." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  // The board can see everyone in the building, so a miss here means there is
  // no such person yet. A handful of rows; matching lower(email) in code is
  // simpler than a LIKE pattern with its wildcards escaped.
  const { data: people } = await supabase.from("persons").select("id, full_name, email").eq("association_id", associationId).not("email", "is", null);
  const wanted = email.toLowerCase();
  const found = (people ?? []).find((p) => String(p.email).toLowerCase() === wanted);
  let personId = found?.id as string | undefined;
  if (found) {
    // Never rename an existing person from here: the name on a persons row is
    // that person's data (DECISIONS #30); the card shows what's on file.
  } else {
    const { data, error } = await supabase.from("persons").insert({ association_id: associationId, full_name: fullName, email }).select("id");
    if (error) {
      if (error.code === "42501") return { error: onlyBoard("set the accountant") };
      if (error.code === "23505") return { error: "Someone with that email is already on file." };
      return { error: error.message };
    }
    personId = data?.[0]?.id as string | undefined;
    if (!personId) return { error: onlyBoard("set the accountant") };
  }

  const { error } = await supabase.rpc("set_accountant", { p_association_id: associationId, p_person_id: personId, p_firm: firm });
  if (error) return { error: error.code === "42501" ? onlyBoard("set the accountant") : error.message };
  revalidateTax();
  revalidatePath("/building");
  return { ok: true as const };
}

/** Forget the accountant (and the firm). The persons row stays — it may be a member, and persons are redacted, never deleted. */
export async function clearAccountant() {
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  const { error } = await supabase.rpc("set_accountant", { p_association_id: associationId, p_person_id: null, p_firm: null });
  if (error) return { error: error.code === "42501" ? onlyBoard("change the accountant") : error.message };
  revalidateTax();
  return { ok: true as const };
}

/**
 * The stored copy of a draft keeps its figures and filenames but not the
 * names in it: the greeting ("Hi Jane,") and the sender's sign-off line are
 * replaced, so the snapshot holds no person's name outside persons
 * (DECISIONS #30 — tax_forms is audited, and redact_person() doesn't scrub
 * this column). The accountant is referenced by id instead.
 */
function withoutNames(body: string): string {
  const lines = body.split(/\r?\n/);
  if (/^Hi\b.*,\s*$/.test(lines[0] ?? "")) lines[0] = "[greeting removed]";
  const thanks = lines.lastIndexOf("Thanks,");
  if (thanks >= 0 && thanks + 1 < lines.length) lines[thanks + 1] = "[sender removed]";
  return lines.join("\n");
}

/**
 * "Mark as sent" after the person opened the mailto draft — Walkup never sent
 * anything. Records when, by whom, and a snapshot of what the draft said and
 * the figures behind it (for the form's own year).
 */
export async function markSentToAccountant(formId: string, draft: { subject: string; body: string; attachments: string[] }) {
  const supabase = await createClient();
  const user = await getUser();
  if (!user) return { error: "Sign in to record this." };
  const form = await loadForm(supabase, formId);
  if (!form) return { error: "Form not found." };
  if (form.status === "filed") return { error: "This form is already filed." };
  const loaded = await contextForForm(supabase, form);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;

  const fig = ctx.input.figures;
  const contractor = form.vendor_id ? (ctx.contractorRows.find((c) => c.vendorId === form.vendor_id) ?? null) : null;
  const now = new Date().toISOString();
  const snapshot: SentSnapshot = {
    subject: scrubIdentifiers(String(draft.subject ?? "")).slice(0, 300),
    body: withoutNames(scrubIdentifiers(String(draft.body ?? ""))).slice(0, 20000),
    attachments: (draft.attachments ?? []).map((a) => String(a).slice(0, 200)).slice(0, 10),
    accountantPersonId: ctx.accountant?.personId ?? null,
    figures: {
      exemptIncomeCents: fig.exemptIncomeCents,
      nonexemptIncomeCents: fig.grossIncomeCents - fig.exemptIncomeCents,
      grossIncomeCents: fig.grossIncomeCents,
      exemptExpendituresCents: fig.exemptExpendituresCents,
      totalExpendituresCents: fig.totalExpendituresCents,
      contractorTotalCents: contractor?.totalCents ?? null,
    },
    asOf: ctx.asOf,
    sentAt: now,
  };

  // sent_to_accountant_by needs sent_to_accountant_at in the same write (CHECK tax_forms_sent_by_needs_when).
  const { data, error } = await supabase
    .from("tax_forms")
    .update({ sent_to_accountant_at: now, sent_to_accountant_by: user.id, sent_snapshot_json: snapshot, updated_at: now })
    .eq("id", formId)
    .select("id");
  if (error) return { error: error.code === "42501" ? onlyBoard("mark a form as sent") : error.message };
  if (!data?.length) return { error: onlyBoard("mark a form as sent") };
  revalidateTax(formId);
  return { ok: true as const, sentAt: now };
}

/**
 * "How do you file 1099s with the IRS?" and the Illinois SOS file number.
 * One RPC writes both, and the two controls submit separately, so a submit
 * that carries only one field keeps the other's current value. Fields:
 * information_returns_filing (paper | electronic | blank = not sure yet),
 * il_sos_file_number.
 */
export async function setFilingSettings(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const { data: associations } = await supabase.from("associations").select("id, information_returns_filing, il_sos_file_number").limit(1);
  const association = associations?.[0];
  if (!association) return { error: "No association is visible to you." };

  let method: "paper" | "electronic" | null =
    association.information_returns_filing === "paper" || association.information_returns_filing === "electronic"
      ? association.information_returns_filing
      : null;
  if (formData.has("information_returns_filing")) {
    const raw = String(formData.get("information_returns_filing") ?? "").trim();
    if (raw === "paper" || raw === "electronic") method = raw;
    else if (raw === "" || raw === "unknown" || raw === "not_sure") method = null;
    else return { error: "Choose on paper, electronically, or not sure yet." };
  }
  const fileNumber = formData.has("il_sos_file_number")
    ? String(formData.get("il_sos_file_number") ?? "").trim() || null
    : ((association.il_sos_file_number as string | null) ?? null);

  const { error } = await supabase.rpc("set_tax_filing_settings", {
    p_association_id: association.id,
    p_information_returns_filing: method,
    p_il_sos_file_number: fileNumber,
  });
  if (error) return { error: error.code === "42501" ? onlyBoard("change these settings") : error.message };
  revalidateTax();
  return { ok: true as const };
}
