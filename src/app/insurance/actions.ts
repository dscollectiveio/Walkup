"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uploadDocuments } from "@/app/documents/actions";
import { FIELD_DEFS, parseFieldValue, type FieldDef } from "@/lib/insurance/declarations";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function currentAssociation(supabase: Supabase) {
  const { data } = await supabase.from("associations").select("id, legal_name, state_code").limit(1);
  return data?.[0] ?? null;
}

function revalidateInsurance() {
  revalidatePath("/insurance");
  revalidatePath("/");
}

function optionalText(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function optionalMoney(formData: FormData, key: string): number | null | "invalid" {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

// ============================================================================
// Upload → Document Hub → review
// ============================================================================

/**
 * The declarations page goes through the Document Hub like any other upload,
 * filed under Insurance — which is what triggers the field-by-field read.
 * Then straight to the review screen, which waits for the read to finish.
 */
export async function uploadDeclarations(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { data: cats } = await supabase
    .from("document_categories")
    .select("id")
    .eq("association_id", association.id)
    .eq("slug", "insurance")
    .limit(1);
  const categoryId = cats?.[0]?.id;
  if (!categoryId) return { error: "The Insurance document category is missing." };

  const upload = new FormData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the declarations page first." };
  upload.append("files", file);
  upload.append("category_id", categoryId);

  const result = await uploadDocuments(null, upload);
  if ("error" in result && result.error) return { error: result.error };
  const outcome = "results" in result ? result.results?.[0] : null;
  if (!outcome) return { error: "The upload didn't go through." };
  if (outcome.status === "rejected") return { error: `${outcome.filename} ${outcome.reason}` };

  const documentId = outcome.status === "added" ? outcome.id : outcome.existingId;
  const mode = String(formData.get("mode") ?? "policy");
  const requestId = String(formData.get("request_id") ?? "");
  const qs = new URLSearchParams({ mode });
  if (requestId) qs.set("request", requestId);
  redirect(`/insurance/review/${documentId}?${qs.toString()}`);
}

interface FieldMeta {
  source: "extracted" | "manual" | "quote";
  page: number | null;
  confidence: number | null;
  snippet: string | null;
}

/** Reads every declarations field (f_<key>) and its provenance (m_<key>) from the review form. */
function readReviewedFields(formData: FormData):
  | { error: string }
  | { values: Record<string, string | number | boolean | null>; meta: Map<string, FieldMeta> } {
  const values: Record<string, string | number | boolean | null> = {};
  const meta = new Map<string, FieldMeta>();
  for (const def of FIELD_DEFS) {
    const raw = String(formData.get(`f_${def.key}`) ?? "").trim();
    let value: string | number | boolean | null = null;
    if (raw !== "") {
      const parsed = parseFieldValue(def, raw);
      if (parsed === null) return { error: `${def.label}: “${raw}” isn't a value Walkup can save. ${hintFor(def)}` };
      value = def.kind === "money" ? Number(parsed) : def.kind === "boolean" ? parsed === "true" : parsed;
    }
    if (def.required && value === null) return { error: `${def.label} is needed to save — it's on the declarations page.` };
    values[def.column] = value;
    try {
      const m = JSON.parse(String(formData.get(`m_${def.key}`) ?? "null")) as FieldMeta | null;
      if (value !== null) meta.set(def.key, m ?? { source: "manual", page: null, confidence: null, snippet: null });
    } catch {
      if (value !== null) meta.set(def.key, { source: "manual", page: null, confidence: null, snippet: null });
    }
  }
  if (typeof values.effective_to === "string" && typeof values.effective_from === "string" && values.effective_to <= values.effective_from) {
    return { error: "The renewal date has to be after the start date." };
  }
  return { values, meta };
}

function hintFor(def: FieldDef): string {
  if (def.kind === "money") return "Use digits, like 2400000 or $2,400,000.";
  if (def.kind === "date") return "Use the date picker.";
  return "";
}

export async function savePolicyFromReview(_prev: unknown, formData: FormData) {
  const read = readReviewedFields(formData);
  if ("error" in read) return { error: read.error };
  const documentId = optionalText(formData, "document_id");
  const replacesId = optionalText(formData, "replaces_policy_id");
  const reminderDays = Number(formData.get("renewal_reminder_days") ?? 60);
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
    return { error: "The reminder lead time is a number of days from 0 to 365." };
  }

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { data: inserted, error } = await supabase
    .from("insurance_policies")
    .insert({
      association_id: association.id,
      ...read.values,
      renewal_reminder_days: reminderDays,
      notes: optionalText(formData, "notes"),
      source_document_id: documentId,
      last_reviewed_at: new Date().toISOString(),
    })
    .select("id");
  if (error) return { error: error.code === "42501" ? "Only a board member can save a policy." : error.message };
  const policyId = inserted![0].id as string;

  const sources = [...read.meta.entries()].map(([key, m]) => ({
    association_id: association.id,
    policy_id: policyId,
    field_name: key,
    source: m.source,
    document_id: m.source === "manual" ? null : documentId,
    page_number: m.page,
    confidence: m.confidence,
    raw_text_snippet: m.snippet?.slice(0, 240) ?? null,
  }));
  if (sources.length > 0) {
    const { error: srcError } = await supabase.from("insurance_policy_field_sources").insert(sources);
    if (srcError) return { error: srcError.message };
  }

  if (documentId) {
    await supabase.from("document_links").insert({
      association_id: association.id,
      document_id: documentId,
      target_table: "insurance_policies",
      target_id: policyId,
      relation: "declarations",
    });
  }
  if (replacesId) {
    await supabase.from("insurance_policies").update({ replaced_at: new Date().toISOString() }).eq("id", replacesId);
  }

  const acceptedQuote = optionalText(formData, "accepted_quote_id");
  if (acceptedQuote) {
    const { data: q } = await supabase.from("insurance_quotes").select("quote_request_id").eq("id", acceptedQuote).limit(1);
    await supabase.from("insurance_quotes").update({ was_selected: true }).eq("id", acceptedQuote);
    if (q?.[0]?.quote_request_id) {
      await supabase.from("insurance_quote_requests").update({ status: "accepted" }).eq("id", q[0].quote_request_id);
    }
  }

  revalidateInsurance();
  redirect(`/insurance?policy=${policyId}`);
}

export async function saveQuoteFromReview(_prev: unknown, formData: FormData) {
  const read = readReviewedFields(formData);
  if ("error" in read) return { error: read.error };
  const documentId = optionalText(formData, "document_id");
  const requestId = optionalText(formData, "request_id");

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const v = read.values;
  const { error } = await supabase.from("insurance_quotes").insert({
    association_id: association.id,
    coverage: v.coverage,
    carrier_name: v.carrier_name,
    quoted_on: new Date().toISOString().slice(0, 10),
    covers_from: v.effective_from,
    annual_premium: v.annual_premium,
    deductible: v.property_deductible,
    coverage_limit: v.building_limit,
    valid_until: optionalText(formData, "valid_until"),
    notes: optionalText(formData, "notes"),
    quote_request_id: requestId,
    document_id: documentId,
    building_limit: v.building_limit,
    coverage_form: v.coverage_form ?? "unknown",
    liability_per_occurrence: v.liability_per_occurrence,
    liability_aggregate: v.liability_aggregate,
    do_limit: v.do_limit,
    umbrella_limit: v.umbrella_limit,
    ordinance_or_law: v.ordinance_or_law,
    loss_assessment_limit: v.loss_assessment_limit,
    water_backup_limit: v.water_backup_limit,
    flood_covered: v.flood_covered,
    property_deductible: v.property_deductible,
    water_damage_deductible: v.water_damage_deductible,
    wind_hail_deductible: v.wind_hail_deductible,
    per_unit_deductible: v.per_unit_deductible,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can save a quote." : error.message };

  if (requestId) {
    await supabase
      .from("insurance_quote_requests")
      .update({ status: "quote_received", responded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", requestId);
  }

  revalidateInsurance();
  redirect("/insurance?view=quotes");
}

// ============================================================================
// Claims, premium, policy upkeep
// ============================================================================

export async function addClaim(_prev: unknown, formData: FormData) {
  const policyId = String(formData.get("policy_id") ?? "");
  const dateOfLoss = String(formData.get("date_of_loss") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const claimed = optionalMoney(formData, "amount_claimed");
  if (!policyId) return { error: "Missing policy." };
  if (!dateOfLoss) return { error: "Enter the date of the loss." };
  if (!description) return { error: "Say briefly what happened." };
  if (claimed === "invalid") return { error: "The amount claimed must be a number of zero or more." };

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { error } = await supabase.from("insurance_claims").insert({
    association_id: association.id,
    policy_id: policyId,
    ticket_id: optionalText(formData, "ticket_id"),
    date_of_loss: dateOfLoss,
    claim_number: optionalText(formData, "claim_number"),
    description,
    amount_claimed: claimed,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can add a claim." : error.message };
  revalidateInsurance();
  return { ok: true };
}

export async function updateClaim(claimId: string, status: string, amountPaid: number | null) {
  if (!["open", "paid", "denied", "withdrawn"].includes(status)) return { error: "Unknown status." };
  if (amountPaid !== null && (!Number.isFinite(amountPaid) || amountPaid < 0)) return { error: "Amount paid must be zero or more." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("insurance_claims")
    .update({ status, amount_paid: amountPaid, updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can update a claim." };
  revalidateInsurance();
  return { ok: true };
}

/** Puts the premium on the bills list (recurring_bills), so it shows under "Coming up." */
export async function trackPremiumAsBill(policyId: string, accountId: string) {
  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };
  const [{ data: policies }, { data: funds }] = await Promise.all([
    supabase.from("insurance_policies").select("carrier_name, coverage, annual_premium, effective_to, payment_schedule").eq("id", policyId).limit(1),
    supabase.from("funds").select("id").eq("kind", "operating").limit(1),
  ]);
  const p = policies?.[0];
  if (!p || !funds?.[0]) return { error: "Policy or operating fund not found." };
  const frequency =
    p.payment_schedule === "monthly" ? "monthly" : p.payment_schedule === "quarterly" ? "quarterly" : p.payment_schedule === "semi_annual" ? "semiannual" : "annual";
  const divisor = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[frequency];
  const { error } = await supabase.from("recurring_bills").insert({
    association_id: association.id,
    name: `${p.carrier_name} insurance`,
    account_id: accountId,
    fund_id: funds[0].id,
    frequency,
    typical_amount: Math.round((Number(p.annual_premium) / divisor) * 100) / 100,
    next_due_on: frequency === "annual" ? p.effective_to : null,
    notes: `Premium for the ${String(p.coverage).replace(/_/g, " ")} policy.`,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can add a bill." : error.message };
  revalidateInsurance();
  revalidatePath("/budget");
  revalidatePath("/bills");
  return { ok: true };
}

// ============================================================================
// Get quotes
// ============================================================================

export interface QuoteRequestPayload {
  association: { legal_name: string; address: string; units: number | null; year_built: number | null; construction_type: string | null; stories: number | null; roof_replaced_year: number | null };
  current: { carrier: string | null; premium: number | null; expires_on: string | null };
  wanted: { building_limit: number | null; liability: number | null; do_limit: number | null; umbrella_limit: number | null; flood: boolean | null };
  claims_last_5_years: string;
  contact: { name: string; phone: string | null; email: string };
  anything_else: string | null;
}

/**
 * One draft request per chosen broker. Walkup doesn't send email — the
 * board sends each one from its own mailbox (mailto) and marks it sent,
 * the same way contractor emails work.
 */
export async function createQuoteRequests(_prev: unknown, formData: FormData) {
  const partnerIds = formData.getAll("partner_id").map(String).filter(Boolean);
  if (partnerIds.length === 0) return { error: "Choose at least one broker." };
  if (formData.get("consent") !== "on") return { error: "Tick the box confirming these details can be sent." };

  const num = (k: string) => {
    const raw = String(formData.get(k) ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const contactEmail = String(formData.get("contact_email") ?? "").trim();
  if (!contactName || !contactEmail) return { error: "Add a contact name and email so the broker can reply." };

  const payload: QuoteRequestPayload = {
    association: {
      legal_name: String(formData.get("legal_name") ?? "").trim(),
      address: String(formData.get("address") ?? "").trim(),
      units: num("units"),
      year_built: num("year_built"),
      construction_type: optionalText(formData, "construction_type"),
      stories: num("stories"),
      roof_replaced_year: num("roof_replaced_year"),
    },
    current: {
      carrier: optionalText(formData, "current_carrier"),
      premium: num("current_premium"),
      expires_on: optionalText(formData, "current_expires_on"),
    },
    wanted: {
      building_limit: num("want_building_limit"),
      liability: num("want_liability"),
      do_limit: num("want_do_limit"),
      umbrella_limit: num("want_umbrella_limit"),
      flood: formData.get("want_flood") === "yes" ? true : formData.get("want_flood") === "no" ? false : null,
    },
    claims_last_5_years: String(formData.get("claims") ?? "").trim() || "None reported.",
    contact: { name: contactName, phone: optionalText(formData, "contact_phone"), email: contactEmail },
    anything_else: optionalText(formData, "anything_else"),
  };
  if (!payload.association.legal_name || !payload.association.address) {
    return { error: "The association's legal name and address are needed for a quote." };
  }

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { error } = await supabase.from("insurance_quote_requests").insert(
    partnerIds.map((partnerId) => ({
      association_id: association.id,
      partner_id: partnerId,
      policy_id: optionalText(formData, "policy_id"),
      payload_json: payload,
      status: "draft",
    })),
  );
  if (error) return { error: error.code === "42501" ? "Only a board member can request quotes." : error.message };

  revalidateInsurance();
  return { ok: true };
}

export async function setQuoteRequestStatus(requestId: string, status: "sent" | "quote_received" | "declined" | "expired") {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "sent") patch.sent_at = now;
  if (status === "quote_received" || status === "declined") patch.responded_at = now;
  const supabase = await createClient();
  const { data, error } = await supabase.from("insurance_quote_requests").update(patch).eq("id", requestId).select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can update a request." };
  revalidateInsurance();
  return { ok: true };
}

// ============================================================================
// Platform admin: broker partners (global)
// ============================================================================

export async function savePartner(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) return { error: "Only a platform admin can manage broker partners." };

  const id = optionalText(formData, "id");
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("contact_email") ?? "").trim();
  const states = String(formData.get("states_served") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (!name || !email) return { error: "A name and contact email are required." };
  if (states.length === 0) return { error: "List at least one state, like IL." };

  const row = {
    name,
    contact_email: email,
    phone: optionalText(formData, "phone"),
    states_served: states,
    active: formData.get("active") === "on",
    notes: optionalText(formData, "notes"),
  };
  const { error } = id
    ? await supabase.from("insurance_partners").update(row).eq("id", id)
    : await supabase.from("insurance_partners").insert(row);
  if (error) return { error: error.message };
  revalidatePath("/admin/partners");
  revalidateInsurance();
  return { ok: true };
}
