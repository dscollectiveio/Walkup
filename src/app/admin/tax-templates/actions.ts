"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { enumerateFields, isOfficialFormUrl, sha256Hex } from "@/lib/tax/pdf";
import { parseDueRule } from "@/lib/tax/due-rules";
import { CONTRACTOR_KEYS, LEDGER_KEYS, SETTING_KEYS, type FieldMap } from "@/lib/tax/autofill";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const FORM_CODES = ["irs_1120h", "irs_1120", "il_1120", "irs_1099_nec", "irs_1096", "il_sos_annual_report", "other"];
const MAX_BYTES = 15 * 1024 * 1024;

async function requireAdmin(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true ? null : "Only a platform admin can manage form templates.";
}

/** Download an official PDF. Only the IRS and Illinois sites; only real PDFs. */
async function fetchOfficialPdf(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  if (!isOfficialFormUrl(url)) return { error: "Only https links on irs.gov, tax.illinois.gov or ilsos.gov are accepted." };
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch (cause) {
    return { error: `Couldn't reach that address: ${(cause as Error).message}` };
  }
  if (!res.ok) return { error: `The server answered ${res.status}.` };
  if (!isOfficialFormUrl(res.url)) return { error: "That link redirected away from an official site." };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return { error: "That file is larger than 15 MB." };
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return { error: "That link isn't a PDF." };
  return { bytes };
}

async function storeTemplate(
  supabase: Supabase,
  opts: { formCode: string; taxYear: number; revision: string | null; sourceUrl: string; bytes: Uint8Array; note?: string },
) {
  const sha = await sha256Hex(opts.bytes);
  const { data: dup } = await supabase
    .from("tax_form_templates")
    .select("id")
    .eq("form_code", opts.formCode)
    .eq("tax_year", opts.taxYear)
    .eq("sha256", sha)
    .limit(1);
  if (dup?.[0]) return { id: dup[0].id as string, unchanged: true };

  let fields;
  try {
    fields = await enumerateFields(opts.bytes);
  } catch (cause) {
    return { error: `That PDF couldn't be opened: ${(cause as Error).message}` };
  }
  const path = `${opts.formCode}/${opts.taxYear}/${sha}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("tax-templates")
    .upload(path, new Blob([opts.bytes as unknown as ArrayBuffer], { type: "application/pdf" }), {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) return { error: upErr.message };

  const { data, error } = await supabase
    .from("tax_form_templates")
    .insert({
      form_code: opts.formCode,
      tax_year: opts.taxYear,
      revision: opts.revision,
      source_url: opts.sourceUrl,
      storage_path: path,
      sha256: sha,
      field_names_json: fields,
      notes: opts.note ?? null,
      active: false,
    })
    .select("id");
  if (error) return { error: error.message };
  return { id: data![0].id as string, unchanged: false };
}

export async function fetchTemplate(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };

  const formCode = String(formData.get("form_code") ?? "");
  const taxYear = Number(formData.get("tax_year") ?? "");
  const url = String(formData.get("source_url") ?? "").trim();
  const revision = String(formData.get("revision") ?? "").trim() || null;
  if (!FORM_CODES.includes(formCode)) return { error: "Choose a form." };
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) return { error: "Enter the tax year the form is for." };

  const fetched = await fetchOfficialPdf(url);
  if ("error" in fetched) return { error: fetched.error };
  const stored = await storeTemplate(supabase, { formCode, taxYear, revision, sourceUrl: url, bytes: fetched.bytes });
  if ("error" in stored) return { error: stored.error };
  revalidatePath("/admin/tax-templates");
  redirect(`/admin/tax-templates/${stored.id}`);
}

/**
 * Save the field map. Every mapped field must cite the line or label of the
 * official instructions it was derived from, and use a rule the auto-fill
 * understands — an entry that doesn't is refused, not saved and ignored.
 */
export async function saveFieldMap(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const id = String(formData.get("id") ?? "");

  const { data: rows } = await supabase.from("tax_form_templates").select("field_names_json, active").eq("id", id).limit(1);
  const template = rows?.[0];
  if (!template) return { error: "Template not found." };
  if (template.active) return { error: "Deactivate the template before changing its map." };
  const names = new Set(((template.field_names_json ?? []) as { name: string }[]).map((f) => f.name));

  const map: FieldMap = {};
  for (const name of names) {
    const source = String(formData.get(`src:${name}`) ?? "");
    if (!source) continue;
    const entry = {
      label: String(formData.get(`label:${name}`) ?? "").trim(),
      section: String(formData.get(`section:${name}`) ?? "").trim() || undefined,
      source: source as FieldMap[string]["source"],
      rule: String(formData.get(`rule:${name}`) ?? "").trim(),
      citation: String(formData.get(`cite:${name}`) ?? "").trim(),
    };
    if (!entry.label) return { error: `${name}: give the line a plain label.` };
    if (!entry.citation) return { error: `${name}: cite the instructions line or label this mapping comes from.` };
    const allowed: Record<string, readonly string[] | null> = {
      setting: SETTING_KEYS,
      ledger: LEDGER_KEYS,
      contractors: CONTRACTOR_KEYS,
      calculated: null,
      manual: null,
    };
    if (!(entry.source in allowed)) return { error: `${name}: unknown source.` };
    const keys = allowed[entry.source];
    if (keys && !keys.includes(entry.rule)) return { error: `${name}: “${entry.rule}” isn't a ${entry.source} value Walkup can fill.` };
    if (entry.source === "calculated" && !/^(add|sub|mul|max0)\(/.test(entry.rule)) {
      return { error: `${name}: a calculation must be add(…), sub(…), mul(…) or max0(…) of other fields.` };
    }
    map[name] = entry;
  }

  const dueRule = String(formData.get("due_rule") ?? "").trim() || null;
  if (dueRule && !parseDueRule(dueRule)) return { error: "The due rule isn't in a form Walkup can read." };
  const dueCitation = String(formData.get("due_rule_citation") ?? "").trim() || null;
  if (dueRule && !dueCitation) return { error: "Cite where the due rule comes from." };
  const instructions = String(formData.get("filing_instructions") ?? "").trim() || null;
  const filingCitation = String(formData.get("filing_citation") ?? "").trim() || null;
  if (instructions && !filingCitation) return { error: "Cite where the filing instructions come from." };

  const { error } = await supabase
    .from("tax_form_templates")
    .update({
      field_map_json: map,
      due_rule: dueRule,
      due_rule_citation: dueCitation,
      filing_instructions: instructions,
      filing_citation: filingCitation,
      notes: String(formData.get("notes") ?? "").trim() || null,
      revision: String(formData.get("revision") ?? "").trim() || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/admin/tax-templates/${id}`);
  return { ok: true };
}

/** A person has checked the map against the printed form. Only then does anything fill from it. */
export async function verifyAndActivate(id: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const user = await getUser();
  const { data: rows } = await supabase.from("tax_form_templates").select("form_code, tax_year").eq("id", id).limit(1);
  const t = rows?.[0];
  if (!t) return { error: "Template not found." };
  await supabase.from("tax_form_templates").update({ active: false }).eq("form_code", t.form_code).eq("tax_year", t.tax_year).eq("active", true);
  const { error } = await supabase
    .from("tax_form_templates")
    .update({ verified_at: new Date().toISOString(), verified_by: user?.id ?? null, active: true })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/tax-templates");
  revalidatePath(`/admin/tax-templates/${id}`);
  revalidatePath("/tax");
  return { ok: true };
}

export async function deactivate(id: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { error } = await supabase.from("tax_form_templates").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/admin/tax-templates");
  revalidatePath(`/admin/tax-templates/${id}`);
  return { ok: true };
}

/**
 * Re-download every active template's source and compare checksums. A changed
 * file becomes a new, inactive template to review — never an automatic
 * switch. Run by hand (prompted each January on the admin page) rather than
 * by a job, which would need the service role (DECISIONS #28 stays narrow).
 */
export async function checkForUpdates() {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { data: active } = await supabase
    .from("tax_form_templates")
    .select("form_code, tax_year, revision, source_url, sha256")
    .eq("active", true);
  const changed: string[] = [];
  const failed: string[] = [];
  for (const t of active ?? []) {
    const fetched = await fetchOfficialPdf(t.source_url);
    if ("error" in fetched) {
      failed.push(`${t.form_code} ${t.tax_year}: ${fetched.error}`);
      continue;
    }
    if ((await sha256Hex(fetched.bytes)) === t.sha256) continue;
    const stored = await storeTemplate(supabase, {
      formCode: t.form_code,
      taxYear: t.tax_year,
      revision: t.revision,
      sourceUrl: t.source_url,
      bytes: fetched.bytes,
      note: `The published file changed; detected ${new Date().toISOString().slice(0, 10)}. Review before activating.`,
    });
    if ("error" in stored) failed.push(`${t.form_code} ${t.tax_year}: ${stored.error}`);
    else if (!stored.unchanged) changed.push(`${t.form_code} ${t.tax_year}`);
  }
  revalidatePath("/admin/tax-templates");
  return { ok: true, checked: (active ?? []).length, changed, failed };
}
