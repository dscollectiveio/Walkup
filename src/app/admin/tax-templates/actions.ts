"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, getUser } from "@/lib/supabase/server";
import { enumerateFields, getTitle, isOfficialFormUrl, sha256Hex } from "@/lib/tax/pdf";
import { parseDueRule } from "@/lib/tax/due-rules";
import { isOfficialLinkUrl, type LinkKind } from "@/lib/tax/links";
import { suggestedByKey } from "@/lib/tax/suggested";
import { todayIso } from "@/lib/dates";
import type { FieldMap } from "@/lib/tax/autofill";
import {
  LINK_FORM_CODES,
  LINK_KINDS,
  LINK_SORT_ORDER,
  TEMPLATE_FORM_CODES,
  classifyLinkCheck,
  isOfficialTemplateUrl,
  parseIncludePages,
  parseMirror,
  suggestionDecision,
  validateFieldMap,
  type InspectedPdf,
  type RawMapEntry,
} from "./rules";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const MAX_BYTES = 15 * 1024 * 1024;

/** What the automatic link check sends. irs.gov answers anything; ilsos.gov answers only browsers, and we record "blocked" rather than pretend. */
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

async function requireAdmin(supabase: Supabase): Promise<string | null> {
  const { data } = await supabase.rpc("is_platform_admin");
  return data === true ? null : "Only a platform admin can manage form templates. Sign in with your second factor if you are one.";
}

const str = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

/** The pages that tell boards what the admin changed. */
function revalidateAdmin(templateId?: string) {
  revalidatePath("/admin/tax-templates");
  if (templateId) revalidatePath(`/admin/tax-templates/${templateId}`);
  revalidatePath("/tax");
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

/** Everything a stored template records about the file itself. */
async function inspectPdf(bytes: Uint8Array): Promise<(InspectedPdf & { fields: { name: string; type: string }[] }) | { error: string }> {
  try {
    const fields = await enumerateFields(bytes);
    return { sha: await sha256Hex(bytes), title: await getTitle(bytes), names: new Set(fields.map((f) => f.name)), fields };
  } catch (cause) {
    return { error: `That PDF couldn't be opened: ${(cause as Error).message}` };
  }
}

/** The cited rules a template carries besides its file; the same five columns whether typed or suggested. */
interface TemplateRules {
  due_rule: string | null;
  due_rule_citation: string | null;
  filing_instructions: string | null;
  filing_citation: string | null;
  instructions_url: string | null;
}

/** Columns a caller may set on a new PDF template beyond the file: the rules, a map, and where the map came from. */
interface TemplateExtras extends Partial<TemplateRules> {
  field_map_json?: FieldMap;
  include_pages?: number[] | null;
  mirror_json?: { from: string; to: string }[];
  suggested_from?: string;
}

/**
 * Store a fetched PDF as a new, inactive template: file in the private
 * bucket (named by its own hash), fields enumerated, title captured so a
 * silent re-issue is noticed later. The same bytes for the same form and
 * year are never stored twice. No `upsert` — the bucket has no update
 * policy, and an object already at that path is this very file, left by an
 * earlier attempt whose row insert failed.
 */
async function storeTemplate(
  supabase: Supabase,
  opts: { formCode: string; taxYear: number; revision: string | null; sourceUrl: string; bytes: Uint8Array; note?: string | null; extra?: TemplateExtras },
): Promise<{ id: string; unchanged: boolean } | { error: string }> {
  const sha = await sha256Hex(opts.bytes);
  const { data: dup } = await supabase
    .from("tax_form_templates")
    .select("id")
    .eq("form_code", opts.formCode)
    .eq("tax_year", opts.taxYear)
    .eq("sha256", sha)
    .limit(1);
  if (dup?.[0]) return { id: dup[0].id as string, unchanged: true };

  const inspected = await inspectPdf(opts.bytes);
  if ("error" in inspected) return { error: inspected.error };

  const path = `${opts.formCode}/${opts.taxYear}/${sha}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("tax-templates")
    .upload(path, new Blob([opts.bytes as unknown as ArrayBuffer], { type: "application/pdf" }), { contentType: "application/pdf" });
  const alreadyThere = upErr && ((upErr as { statusCode?: string }).statusCode === "409" || /already exists/i.test(upErr.message));
  if (upErr && !alreadyThere) return { error: upErr.message };

  const { data, error } = await supabase
    .from("tax_form_templates")
    .insert({
      form_code: opts.formCode,
      tax_year: opts.taxYear,
      kind: "pdf",
      revision: opts.revision,
      revision_title: inspected.title,
      source_url: opts.sourceUrl,
      storage_path: path,
      sha256: sha,
      field_names_json: inspected.fields,
      notes: opts.note ?? null,
      active: false,
      ...opts.extra,
    })
    .select("id");
  if (error) return { error: error.message };
  return { id: data![0].id as string, unchanged: false };
}

export async function fetchTemplate(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };

  const formCode = str(formData, "form_code");
  const taxYear = Number(formData.get("tax_year") ?? "");
  const url = str(formData, "source_url");
  const revision = str(formData, "revision") || null;
  if (!(TEMPLATE_FORM_CODES as readonly string[]).includes(formCode)) return { error: "Choose a form." };
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) return { error: "Enter the tax year the form is for." };

  const fetched = await fetchOfficialPdf(url);
  if ("error" in fetched) return { error: fetched.error };
  const stored = await storeTemplate(supabase, { formCode, taxYear, revision, sourceUrl: url, bytes: fetched.bytes });
  if ("error" in stored) return { error: stored.error };
  revalidatePath("/admin/tax-templates");
  redirect(`/admin/tax-templates/${stored.id}${stored.unchanged ? "?setup=exists" : ""}`);
}

/** The due rule, filing instructions and instructions link as typed, each citation required with its rule. */
function readRules(formData: FormData): TemplateRules | { error: string } {
  const dueRule = str(formData, "due_rule") || null;
  if (dueRule && !parseDueRule(dueRule)) return { error: "The due rule isn't in a form Walkup can read." };
  const dueCitation = str(formData, "due_rule_citation") || null;
  if (dueRule && !dueCitation) return { error: "Cite where the due rule comes from." };
  const instructions = str(formData, "filing_instructions") || null;
  const filingCitation = str(formData, "filing_citation") || null;
  if (instructions && !filingCitation) return { error: "Cite where the filing instructions come from." };
  const instructionsUrl = str(formData, "instructions_url") || null;
  if (instructionsUrl && !isOfficialTemplateUrl(instructionsUrl)) {
    return { error: "The instructions link must be an https page on irs.gov, tax.illinois.gov or ilsos.gov." };
  }
  return {
    due_rule: dueRule,
    due_rule_citation: dueCitation,
    filing_instructions: instructions,
    filing_citation: filingCitation,
    instructions_url: instructionsUrl,
  };
}

/**
 * Save the field map and rules. Every mapped field must cite the line or
 * label of the official instructions it was derived from, and use a rule
 * the auto-fill understands — an entry that doesn't is refused, not saved
 * and ignored. The same validator applySuggestedTemplate uses (rules.ts).
 */
export async function saveFieldMap(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const id = str(formData, "id");

  const { data: rows } = await supabase.from("tax_form_templates").select("field_names_json, active, kind").eq("id", id).limit(1);
  const template = rows?.[0];
  if (!template) return { error: "Template not found." };
  if (template.active) return { error: "Deactivate the template before changing its map." };
  const isPdf = template.kind !== "link_only";
  const names = new Set(((template.field_names_json ?? []) as { name: string }[]).map((f) => f.name));

  const entries: Record<string, RawMapEntry> = {};
  for (const name of names) {
    const source = String(formData.get(`src:${name}`) ?? "");
    if (!source) continue;
    entries[name] = {
      label: str(formData, `label:${name}`),
      section: str(formData, `section:${name}`),
      source,
      rule: str(formData, `rule:${name}`),
      citation: str(formData, `cite:${name}`),
      kind: str(formData, `kind:${name}`),
      review: formData.get(`review:${name}`) === "on",
      zeroOk: formData.get(`zero:${name}`) === "on",
      hint: str(formData, `hint:${name}`),
    };
  }
  const validated = validateFieldMap(entries, names);
  if ("error" in validated) return { error: validated.error };

  const rules = readRules(formData);
  if ("error" in rules) return { error: rules.error };

  // Pages and mirroring only mean something for a PDF; a link-only template keeps the defaults.
  const pages = isPdf ? parseIncludePages(str(formData, "include_pages")) : { pages: null };
  if ("error" in pages) return { error: pages.error };
  const mirror = isPdf ? parseMirror(String(formData.get("mirror") ?? "")) : { mirror: [] };
  if ("error" in mirror) return { error: mirror.error };

  const { error } = await supabase
    .from("tax_form_templates")
    .update({
      field_map_json: validated.map,
      include_pages: pages.pages,
      mirror_json: mirror.mirror,
      ...rules,
      notes: str(formData, "notes") || null,
      revision: str(formData, "revision") || null,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/admin/tax-templates/${id}`);
  return { ok: true };
}

/**
 * A link-only template: a cited due rule and filing instructions for a form
 * Walkup never fills (the Illinois annual report, IL-1120, Form 1096). No
 * PDF, no map, the same verify-and-activate gate.
 */
export async function createLinkOnlyTemplate(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };

  const formCode = str(formData, "form_code");
  const taxYear = Number(formData.get("tax_year") ?? "");
  const sourceUrl = str(formData, "source_url");
  if (!(TEMPLATE_FORM_CODES as readonly string[]).includes(formCode)) return { error: "Choose a form." };
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) return { error: "Enter the tax year the rule is for." };
  if (!isOfficialTemplateUrl(sourceUrl)) return { error: "The official source must be an https page on irs.gov, tax.illinois.gov or ilsos.gov." };
  const rules = readRules(formData);
  if ("error" in rules) return { error: rules.error };
  if (!rules.due_rule && !rules.filing_instructions) return { error: "A link-only template carries a due rule or filing instructions — add at least one." };

  const { data, error } = await supabase
    .from("tax_form_templates")
    .insert({
      form_code: formCode,
      tax_year: taxYear,
      kind: "link_only",
      revision: str(formData, "revision") || null,
      source_url: sourceUrl,
      storage_path: null,
      sha256: null,
      field_names_json: [],
      field_map_json: {},
      ...rules,
      notes: str(formData, "notes") || null,
      active: false,
    })
    .select("id");
  if (error) return { error: error.message };
  revalidatePath("/admin/tax-templates");
  redirect(`/admin/tax-templates/${data![0].id}?setup=created`);
}

/**
 * One click installs one of Walkup's suggested templates (src/lib/tax/suggested),
 * still inactive. For a PDF: fetch the pinned official file through the same
 * path as "Fetch a form", and apply the authored map only if the file's
 * sha256 AND title are the ones it was written against and every mapped
 * name is a box on it — otherwise the template is stored with a note and no
 * map (§3.2). The same file already stored by hand gets the suggestion
 * applied to it instead of a duplicate, unless it is active. Nothing here
 * verifies or activates; that stays a person's click on the detail page.
 */
export async function applySuggestedTemplate(key: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const entry = suggestedByKey(key);
  if (!entry) return { error: "That suggestion isn't in this version of Walkup." };

  const rules: TemplateRules = {
    due_rule: entry.dueRule,
    due_rule_citation: entry.dueRuleCitation,
    filing_instructions: entry.filingInstructions,
    filing_citation: entry.filingCitation,
    instructions_url: entry.instructionsUrl,
  };

  if (entry.kind === "link_only") {
    const { data: existing } = await supabase
      .from("tax_form_templates")
      .select("id, active")
      .eq("suggested_from", entry.key)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = existing?.[0];
    if (row?.active) redirect(`/admin/tax-templates/${row.id}?setup=active`);
    const columns = { ...rules, notes: entry.notes, revision: entry.revision, suggested_from: entry.key };
    let id: string;
    if (row) {
      const { error } = await supabase.from("tax_form_templates").update(columns).eq("id", row.id);
      if (error) return { error: error.message };
      id = row.id as string;
    } else {
      const { data, error } = await supabase
        .from("tax_form_templates")
        .insert({
          form_code: entry.formCode,
          tax_year: entry.taxYear,
          kind: "link_only",
          source_url: entry.sourceUrl,
          storage_path: null,
          sha256: null,
          field_names_json: [],
          field_map_json: {},
          active: false,
          ...columns,
        })
        .select("id");
      if (error) return { error: error.message };
      id = data![0].id as string;
    }
    revalidateAdmin(id);
    redirect(`/admin/tax-templates/${id}?setup=link_only`);
  }

  const fetched = await fetchOfficialPdf(entry.sourceUrl);
  if ("error" in fetched) return { error: fetched.error };
  const inspected = await inspectPdf(fetched.bytes);
  if ("error" in inspected) return { error: inspected.error };

  const decision = suggestionDecision(entry, inspected);
  const extra: TemplateExtras = decision.apply
    ? { ...rules, suggested_from: entry.key, field_map_json: decision.map, include_pages: entry.includePages, mirror_json: entry.mirror }
    : { ...rules, suggested_from: entry.key, field_map_json: {}, include_pages: null, mirror_json: [] };
  const note = decision.apply ? entry.notes : decision.note;
  const outcome = decision.apply ? "applied" : "refused";

  // The same bytes already stored (fetched by hand earlier): apply the suggestion to that row rather than add a twin.
  const { data: dup } = await supabase
    .from("tax_form_templates")
    .select("id, active")
    .eq("form_code", entry.formCode)
    .eq("tax_year", entry.taxYear)
    .eq("sha256", inspected.sha)
    .limit(1);
  if (dup?.[0]) {
    const row = dup[0];
    if (row.active) redirect(`/admin/tax-templates/${row.id}?setup=active`);
    const { error } = await supabase
      .from("tax_form_templates")
      .update({ ...extra, notes: note, revision: entry.revision, revision_title: inspected.title })
      .eq("id", row.id);
    if (error) return { error: error.message };
    revalidateAdmin(row.id as string);
    redirect(`/admin/tax-templates/${row.id}?setup=${outcome}`);
  }

  const stored = await storeTemplate(supabase, {
    formCode: entry.formCode,
    taxYear: entry.taxYear,
    revision: entry.revision,
    sourceUrl: entry.sourceUrl,
    bytes: fetched.bytes,
    note,
    extra,
  });
  if ("error" in stored) return { error: stored.error };
  revalidateAdmin(stored.id);
  redirect(`/admin/tax-templates/${stored.id}?setup=${stored.unchanged ? "exists" : outcome}`);
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
  revalidateAdmin(id);
  revalidatePath("/");
  return { ok: true };
}

export async function deactivate(id: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { error } = await supabase.from("tax_form_templates").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  revalidateAdmin(id);
  revalidatePath("/");
  return { ok: true };
}

/**
 * Re-download every active PDF template's source and compare checksums. A
 * changed file becomes a new, inactive template to review — never an
 * automatic switch — and a changed title is called out, because that is
 * usually next year's form published at the same address, not a correction.
 * Link-only templates have no file to compare. Run by hand (prompted each
 * January on the admin page) rather than by a job, which would need the
 * service role (DECISIONS #28 stays narrow).
 */
export async function checkForUpdates() {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { data: active } = await supabase
    .from("tax_form_templates")
    .select("form_code, tax_year, revision, revision_title, source_url, sha256")
    .eq("active", true)
    .eq("kind", "pdf");
  const changed: string[] = [];
  const failed: string[] = [];
  for (const t of active ?? []) {
    const fetched = await fetchOfficialPdf(t.source_url);
    if ("error" in fetched) {
      failed.push(`${t.form_code} ${t.tax_year}: ${fetched.error}`);
      continue;
    }
    if ((await sha256Hex(fetched.bytes)) === t.sha256) continue;
    const title = await getTitle(fetched.bytes).catch(() => null);
    const titleChanged = t.revision_title && title && title !== t.revision_title;
    const titleNote = titleChanged ? ` Title changed from “${t.revision_title}” to “${title}” — probably next year's form; set its tax year by hand.` : "";
    const stored = await storeTemplate(supabase, {
      formCode: t.form_code,
      taxYear: t.tax_year,
      revision: t.revision,
      sourceUrl: t.source_url,
      bytes: fetched.bytes,
      note: `The published file changed; detected ${todayIso()}. Review before activating.${titleNote}`,
    });
    if ("error" in stored) failed.push(`${t.form_code} ${t.tax_year}: ${stored.error}`);
    else if (!stored.unchanged) changed.push(`${t.form_code} ${t.tax_year}${titleNote ? ` (title now “${title}” — probably next year's form; set its tax year by hand)` : ""}`);
  }
  revalidatePath("/admin/tax-templates");
  return { ok: true, checked: (active ?? []).length, changed, failed };
}

// ---------------------------------------------------------------------------
// Official links (tax_form_links)
// ---------------------------------------------------------------------------

/** "I opened this and it's current." The only thing that ever sets verified_at — a person, by name. */
export async function verifyLink(id: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const user = await getUser();
  const { error } = await supabase
    .from("tax_form_links")
    .update({ verified_at: new Date().toISOString(), verified_by: user?.id ?? null })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateAdmin();
  return { ok: true };
}

/** Retire a link boards shouldn't see any more, or bring one back. Nothing is deleted. */
export async function setLinkActive(id: string, active: boolean) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { error } = await supabase.from("tax_form_links").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidateAdmin();
  return { ok: true };
}

/** Add an official link by hand. Retrieved today, not yet checked by a person — that is the next click. */
export async function addLink(_prev: unknown, formData: FormData) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };

  const formCode = str(formData, "form_code");
  const kind = str(formData, "kind");
  const label = str(formData, "label");
  const url = str(formData, "url");
  const state = str(formData, "state_code").toUpperCase();
  if (!(LINK_FORM_CODES as readonly string[]).includes(formCode)) return { error: "Choose the form the link is for." };
  if (!(LINK_KINDS as readonly string[]).includes(kind)) return { error: "Choose what kind of link it is." };
  if (!label) return { error: "Give the link a plain label." };
  if (!isOfficialLinkUrl(url)) return { error: "Only https links on irs.gov, illinois.gov, ilsos.gov or ilga.gov (or their subdomains) are accepted." };
  if (state && !/^[A-Z]{2}$/.test(state)) return { error: "State is a two-letter code, or blank for a federal link." };

  const today = todayIso();
  const { error } = await supabase.from("tax_form_links").insert({
    form_code: formCode,
    kind,
    label,
    url,
    state_code: state || null,
    retrieved_on: today,
    retrieved_note: `Added by a platform admin on ${today}. Not yet checked by a person.`,
    sort_order: LINK_SORT_ORDER[kind as LinkKind],
  });
  if (error) return { error: error.code === "23505" ? "That link is already in the registry (same form, kind and address)." : error.message };
  revalidateAdmin();
  return { ok: true };
}

/** One GET, as a browser would send it, with ten seconds to answer; the body is never downloaded. */
async function checkOneLink(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    await res.body?.cancel().catch(() => undefined);
    return classifyLinkCheck(url, { status: res.status, finalUrl: res.url });
  } catch (cause) {
    return classifyLinkCheck(url, { failed: (cause as Error).message });
  }
}

/**
 * GET every active link and record what came back: '200', 'blocked' (403, or
 * ilsos.gov dropping a non-browser) or 'error: …'. Informational — it tells
 * the admin which links to open themselves; it never sets verified_at.
 * Checked in parallel so twenty links take ten seconds at worst, not three
 * minutes.
 */
export async function checkLinks() {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { data: links } = await supabase.from("tax_form_links").select("id, label, url").eq("active", true);
  const rows = (links ?? []) as { id: string; label: string; url: string }[];
  const checkedAt = new Date().toISOString();
  const results = await Promise.all(rows.map(async (r) => ({ ...r, status: await checkOneLink(r.url) })));
  const writes = await Promise.all(
    results.map((r) => supabase.from("tax_form_links").update({ last_checked_at: checkedAt, last_check_status: r.status }).eq("id", r.id)),
  );
  const writeError = writes.find((w) => w.error)?.error;
  if (writeError) return { error: writeError.message };
  revalidateAdmin();
  return {
    ok: true,
    checked: results.length,
    answered: results.filter((r) => r.status === "200").length,
    blocked: results.filter((r) => r.status === "blocked").map((r) => r.label),
    errors: results.filter((r) => r.status.startsWith("error")).map((r) => `${r.label}: ${r.status}`),
  };
}

// ---------------------------------------------------------------------------
// Rules and thresholds (tax_parameters)
// ---------------------------------------------------------------------------

/** "Mark checked today": a person read the source and the figure is current. The RPC is the only write path to tax_parameters. */
export async function verifyParameter(id: string) {
  const supabase = await createClient();
  const denied = await requireAdmin(supabase);
  if (denied) return { error: denied };
  const { error } = await supabase.rpc("verify_tax_parameter", { p_id: id });
  if (error) {
    if (error.code === "42501") return { error: "Only a platform admin signed in with a second factor can mark a rule checked." };
    if (error.code === "P0002") return { error: "That rule isn't on file any more." };
    return { error: error.message };
  }
  revalidateAdmin();
  revalidatePath("/");
  return { ok: true };
}
