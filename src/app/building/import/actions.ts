"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { suggestMapping, type AiPreview } from "@/lib/import/ai-mapping";
import { dropRedundant, type AiSuggestion } from "@/lib/import/ai-verify";
import { detectColumns } from "@/lib/import/columns";
import { IMPORT_LIMITS } from "@/lib/import/limits";
import { FIELDS, IMPORT_KINDS, missingRequired, missingRequiredSentence, type ImportKind } from "@/lib/import/kinds";
import { alreadyImportedBatchId, importErrorMessage, GENERIC_IMPORT_ERROR } from "@/lib/import/messages";
import { distinctValues, initialOptions, mergeOptions, optionsPatchSchema, type AccountLite, type Options } from "@/lib/import/options";
import { isSensitiveHeader } from "@/lib/import/sensitive";
import {
  boardAdminContext, IMPORT_TITLE_PREFIX, isImportUpload, loadAndParse, purgeImportUpload,
  type Supabase,
} from "@/lib/import/server";
import { buildStagedRows, normalizeEdit } from "@/lib/import/stage";
import { equalShares } from "@/lib/import/split";
import type { ImportSummary } from "@/lib/import/types";
import type { DateHint } from "@/lib/import/normalize";

/**
 * The import wizard's server actions (import-spec 11.3). Every one starts by
 * checking the caller is a board admin and then does its work through the
 * import_* functions of migration 0056, which check again. Nothing here
 * writes a ledger row, a unit or a person directly.
 */

export type { ImportSummary };

const REVALIDATE_AFTER_CHANGE = ["/building/import", "/", "/ledger", "/tax", "/dues", "/building", "/contractors", "/budget", "/documents"];

function revalidateWizardPaths() {
  for (const p of REVALIDATE_AFTER_CHANGE) revalidatePath(p);
}

const mappingSchema = z.record(z.string().regex(/^[a-z_]{1,30}$/), z.number().int().min(0).max(39).nullable());
const dateHintSchema = z.enum(["mdy", "dmy", "ymd", "auto"]);
const kindSchema = z.enum(IMPORT_KINDS as unknown as [ImportKind, ...ImportKind[]]);

const startSchema = z
  .object({
    kind: kindSchema,
    documentId: z.guid(),
    mapping: mappingSchema,
    dateHint: dateHintSchema,
    keepCopy: z.boolean(),
  })
  .strict();

type Fail = { error: string };

async function validateBatch(supabase: Supabase, batchId: string): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  const { data, error } = await supabase.rpc("import_validate", { p_batch_id: batchId });
  if (error) {
    console.error("import_validate", error.code, error.message);
    return { error: importErrorMessage(error).message };
  }
  return { ok: true, summary: data as ImportSummary };
}

async function loadBooks(supabase: Supabase, associationId: string) {
  const [{ data: accounts }, { data: funds }] = await Promise.all([
    supabase.from("accounts").select("id, code, name, type, is_cash_account, is_active").eq("association_id", associationId),
    supabase.from("funds").select("id, name, kind").eq("association_id", associationId),
  ]);
  return {
    accounts: (accounts ?? []) as AccountLite[],
    funds: (funds ?? []) as { id: string; name: string; kind: string }[],
  };
}

// ============================================================================
// Start
// ============================================================================

export async function startImport(
  input: {
    kind: ImportKind;
    documentId: string;
    mapping: Record<string, number | null>;
    dateHint: DateHint;
    keepCopy: boolean;
  },
): Promise<
  | { ok: true; batchId: string; notes: string[] }
  | { error: string; alreadyImported?: { batchId: string; on: string | null } }
> {
  const parsedInput = startSchema.safeParse(input);
  if (!parsedInput.success) return { error: "Something about that request was not right. Start the import again." };
  const { kind, documentId, mapping, dateHint, keepCopy } = parsedInput.data;

  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { supabase, associationId } = ctx;

  const fieldKeys = new Set(FIELDS[kind].map((f) => f.key));
  if (Object.keys(mapping).some((k) => !fieldKeys.has(k))) return { error: "Something about that request was not right. Start the import again." };

  const loaded = await loadAndParse(supabase, documentId, kind);
  if (!loaded.ok) return { error: loaded.error };
  const { doc, file } = loaded;

  // Columns must exist, be used once, and never be a sensitive one.
  const used = new Set<number>();
  const safeMapping: Record<string, number | null> = {};
  for (const [key, index] of Object.entries(mapping)) {
    if (index === null) continue;
    if (index >= file.headers.length || used.has(index) || isSensitiveHeader(file.headers[index])) {
      return { error: "Something about that request was not right. Match the columns again." };
    }
    used.add(index);
    safeMapping[key] = index;
  }
  const missing = missingRequired(kind, safeMapping);
  if (missing.length) return { error: missingRequiredSentence(missing) };

  const { rows, notes } = buildStagedRows({ kind, file, mapping: safeMapping, dateHint });
  if (rows.length === 0) return { error: "We didn't find any rows with data in the columns you matched." };

  const purgeable = isImportUpload(doc);
  const cleanUp = async (batchId: string | null) => {
    if (batchId) await supabase.rpc("import_cancel", { p_batch_id: batchId });
    if (purgeable) await purgeImportUpload(supabase, documentId);
  };

  const { data: batchId, error: startError } = await supabase.rpc("import_start", {
    p_association_id: associationId,
    p_kind: kind,
    p_filename: doc.filename,
    p_file_sha256: file.sha256,
    p_source_document_id: keepCopy ? documentId : null,
    p_row_count: rows.length,
  });
  if (startError || typeof batchId !== "string") {
    const mapped = importErrorMessage(startError);
    const earlier = alreadyImportedBatchId(mapped.hint);
    if (earlier) {
      const { data } = await supabase.from("import_batches").select("committed_at").eq("id", earlier).limit(1);
      const on = (data?.[0] as { committed_at: string | null } | undefined)?.committed_at ?? null;
      return { error: "You imported this file before.", alreadyImported: { batchId: earlier, on } };
    }
    console.error("import_start", startError?.code, startError?.message);
    return { error: mapped.message };
  }

  try {
    for (let i = 0; i < rows.length; i += IMPORT_LIMITS.stageChunk) {
      const chunk = rows.slice(i, i + IMPORT_LIMITS.stageChunk);
      const { error } = await supabase.rpc("import_stage_rows", { p_batch_id: batchId, p_rows: chunk });
      if (error) throw error;
    }

    // Starting options: only answers with one obvious value, and exact-name category matches.
    const books = await loadBooks(supabase, associationId);
    const options: Options = initialOptions(kind, books, {
      categories: distinctValues(rows, "category_key").map((d) => d.sample),
      funds: distinctValues(rows, "fund_key").map((d) => d.sample),
    });
    const { error: optError } = await supabase.rpc("import_set_options", {
      p_batch_id: batchId,
      p_mapping: { ...safeMapping, _date_hint: dateHint, _notes: notes },
      p_options: options,
    });
    if (optError) throw optError;

    if (!keepCopy && purgeable) {
      const removed = await purgeImportUpload(supabase, documentId);
      if (!removed) notes.push("We couldn't remove the uploaded file. Remove it from Documents.");
    }

    const validated = await validateBatch(supabase, batchId);
    if ("error" in validated) throw new Error(validated.error);
  } catch (e) {
    console.error("startImport", e);
    await cleanUp(batchId);
    const err = e as { code?: string; message?: string; hint?: string };
    return { error: err.code ? importErrorMessage(err).message : GENERIC_IMPORT_ERROR };
  }

  revalidatePath("/building/import");
  return { ok: true, batchId, notes };
}

// ============================================================================
// Options, fixes, decisions
// ============================================================================

async function batchOf(supabase: Supabase, batchId: string) {
  const { data } = await supabase
    .from("import_batches")
    .select("id, kind, status, options, mapping, source_document_id, file_sha256")
    .eq("id", batchId)
    .limit(1);
  return (data?.[0] as
    | { id: string; kind: ImportKind; status: string; options: Options; mapping: Record<string, unknown>; source_document_id: string | null; file_sha256: string }
    | undefined) ?? null;
}

export async function saveImportOptions(
  batchId: string,
  patch: Record<string, unknown>,
): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const batch = await batchOf(ctx.supabase, batchId);
  if (!batch) return { error: "We couldn't find that import." };
  const checked = optionsPatchSchema(batch.kind).safeParse(patch);
  if (!checked.success) return { error: "One of those answers was not valid. Check it and try again." };
  const merged = mergeOptions(batch.options ?? {}, checked.data as Options);
  const { error } = await ctx.supabase.rpc("import_set_options", { p_batch_id: batchId, p_mapping: null, p_options: merged });
  if (error) return { error: importErrorMessage(error).message };
  const r = await validateBatch(ctx.supabase, batchId);
  if ("error" in r) return r;
  revalidatePath(`/building/import/${batchId}`);
  return r;
}

export async function revalidateImport(batchId: string): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const r = await validateBatch(ctx.supabase, batchId);
  if ("error" in r) return r;
  revalidatePath(`/building/import/${batchId}`);
  return r;
}

const fixSchema = z.record(z.string().regex(/^[a-z_]{1,30}$/), z.string().max(300));

export async function fixImportRow(
  rowId: string,
  values: Record<string, string>,
): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(rowId).success) return { error: GENERIC_IMPORT_ERROR };
  const parsed = fixSchema.safeParse(values);
  if (!parsed.success) return { error: "One of those values was not valid." };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data } = await ctx.supabase.from("import_rows").select("id, batch_id").eq("id", rowId).limit(1);
  const row = data?.[0] as { id: string; batch_id: string } | undefined;
  if (!row) return { error: "We couldn't find that row." };
  const batch = await batchOf(ctx.supabase, row.batch_id);
  if (!batch) return { error: "We couldn't find that import." };
  const allowed = new Set(FIELDS[batch.kind].map((f) => f.key));
  allowed.add("trade_slug");
  const hint = ((batch.mapping?._date_hint as DateHint | undefined) ?? "mdy") as DateHint;
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    // "This is a second, separate transaction": the one flag that is not a file column.
    if (k === "confirmed_separate" && batch.kind === "transactions") {
      cleaned[k] = v === "true" ? "true" : "";
      continue;
    }
    if (!allowed.has(k) || k === "money_in" || k === "money_out") continue;
    cleaned[k] = normalizeEdit(batch.kind, k, v, hint);
  }
  const { error } = await ctx.supabase.rpc("import_update_row", { p_row_id: rowId, p_mapped: cleaned });
  if (error) return { error: importErrorMessage(error).message };
  const r = await validateBatch(ctx.supabase, row.batch_id);
  if ("error" in r) return r;
  revalidatePath(`/building/import/${row.batch_id}`);
  return r;
}

export async function setRowDecision(
  rowId: string,
  decision: "import" | "skip",
): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(rowId).success || (decision !== "import" && decision !== "skip")) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data } = await ctx.supabase.from("import_rows").select("batch_id").eq("id", rowId).limit(1);
  const batchId = (data?.[0] as { batch_id: string } | undefined)?.batch_id;
  if (!batchId) return { error: "We couldn't find that row." };
  const { error } = await ctx.supabase.rpc("import_set_row_decision", { p_row_id: rowId, p_decision: decision });
  if (error) return { error: importErrorMessage(error).message };
  const r = await validateBatch(ctx.supabase, batchId);
  if ("error" in r) return r;
  revalidatePath(`/building/import/${batchId}`);
  return r;
}

export async function skipProblemRows(batchId: string): Promise<{ ok: true; skipped: number; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("import_skip_problem_rows", { p_batch_id: batchId });
  if (error) return { error: importErrorMessage(error).message };
  const r = await validateBatch(ctx.supabase, batchId);
  if ("error" in r) return r;
  revalidatePath(`/building/import/${batchId}`);
  return { ok: true, skipped: Number(data ?? 0), summary: r.summary };
}

/** "Split equally": each unit in the file gets its share on its first row. */
export async function splitSharesEqually(batchId: string): Promise<{ ok: true; summary: ImportSummary } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const batch = await batchOf(ctx.supabase, batchId);
  if (!batch || batch.kind !== "units_owners") return { error: "We couldn't find that import." };

  const all: { id: string; row_number: number; mapped: Record<string, string>; decision: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase
      .from("import_rows")
      .select("id, row_number, mapped, decision")
      .eq("batch_id", batchId)
      .order("row_number")
      .range(from, from + 999);
    if (error) return { error: GENERIC_IMPORT_ERROR };
    all.push(...((data ?? []) as typeof all));
    if (!data || data.length < 1000) break;
  }
  const live = all.filter((r) => r.decision === "import" && (r.mapped.unit_label ?? "").trim() !== "");
  const order: string[] = [];
  const firstRow = new Map<string, string>();
  for (const r of live) {
    const key = r.mapped.unit_label.trim().toLowerCase();
    if (!firstRow.has(key)) {
      firstRow.set(key, r.id);
      order.push(key);
    }
  }
  if (order.length === 0) return { error: "There are no units in this file." };
  const { data: existing } = await ctx.supabase.from("units").select("label").eq("association_id", ctx.associationId);
  const outside = ((existing ?? []) as { label: string }[]).filter((u) => !firstRow.has(u.label.trim().toLowerCase()));
  if (outside.length > 0) {
    return { error: "Some of your existing units are not in this file, so the shares would not add up. Add them to the file, or leave percentages out for now." };
  }
  const shares = equalShares(order.length);
  const shareOf = new Map(order.map((k, i) => [firstRow.get(k) as string, shares[i]]));
  for (const r of live) {
    const share = shareOf.get(r.id);
    const want = share ?? "";
    if ((r.mapped.ownership_percent ?? "") === want) continue;
    const { error } = await ctx.supabase.rpc("import_update_row", { p_row_id: r.id, p_mapped: { ownership_percent: want } });
    if (error) return { error: importErrorMessage(error).message };
  }
  const v = await validateBatch(ctx.supabase, batchId);
  if ("error" in v) return v;
  revalidatePath(`/building/import/${batchId}`);
  return v;
}

// ============================================================================
// New categories and fiscal years
// ============================================================================

export async function createImportCategory(input: {
  name: string;
  type: "expense" | "income";
  isExempt: boolean | null;
}): Promise<{ ok: true; accountId: string } | Fail> {
  // Checked before anything else, and before any call: the tax answer has no default.
  if (input?.isExempt === null || input?.isExempt === undefined) {
    return { error: "Say whether this counts toward your tax-exempt activity." };
  }
  const checked = z
    .object({ name: z.string().trim().min(1).max(80), type: z.enum(["expense", "income"]), isExempt: z.boolean() })
    .safeParse(input);
  if (!checked.success) return { error: "Give the category a name of 1 to 80 characters, and say whether it is money in or money out." };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("import_create_account", {
    p_association_id: ctx.associationId,
    p_name: checked.data.name,
    p_type: checked.data.type,
    p_is_exempt: checked.data.isExempt,
  });
  if (error || typeof data !== "string") return { error: importErrorMessage(error).message };
  revalidatePath("/budget");
  revalidatePath("/tax");
  return { ok: true, accountId: data };
}

export async function ensureFiscalYear(year: number): Promise<{ ok: true } | Fail> {
  if (!Number.isInteger(year)) return { error: "That year is out of range." };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("import_ensure_fiscal_year", { p_association_id: ctx.associationId, p_year: year });
  if (error) return { error: importErrorMessage(error).message };
  revalidateWizardPaths();
  return { ok: true };
}

// ============================================================================
// Commit, undo, cancel
// ============================================================================

export async function commitImport(
  batchId: string,
  digest: string,
): Promise<{ ok: true; summary: ImportSummary } | { error: string; hint?: "preview_stale" | "already_imported"; alreadyImported?: { batchId: string; on: string | null } }> {
  if (!z.guid().safeParse(batchId).success || typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
    return { error: GENERIC_IMPORT_ERROR };
  }
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data, error } = await ctx.supabase.rpc("import_commit", { p_batch_id: batchId, p_digest: digest });
  if (error) {
    const mapped = importErrorMessage(error);
    if (mapped.hint === "preview_stale") {
      // Re-run the preview so the page shows what is true now.
      await ctx.supabase.rpc("import_validate", { p_batch_id: batchId });
      revalidatePath(`/building/import/${batchId}`);
      return { error: mapped.message, hint: "preview_stale" };
    }
    if (error.code === "23505") {
      const batch = await batchOf(ctx.supabase, batchId);
      if (batch) {
        const { data: earlier } = await ctx.supabase
          .from("import_batches")
          .select("id, committed_at")
          .eq("association_id", ctx.associationId)
          .eq("kind", batch.kind)
          .eq("status", "committed")
          .limit(1);
        const e = earlier?.[0] as { id: string; committed_at: string | null } | undefined;
        if (e) return { error: mapped.message, hint: "already_imported", alreadyImported: { batchId: e.id, on: e.committed_at } };
      }
      return { error: mapped.message, hint: "already_imported" };
    }
    console.error("import_commit", error.code, error.message);
    return { error: mapped.message };
  }
  revalidateWizardPaths();
  return { ok: true, summary: data as ImportSummary };
}

export async function undoImport(batchId: string): Promise<{ ok: true } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("import_undo", { p_batch_id: batchId });
  if (error) {
    console.error("import_undo", error.code, error.message);
    return { error: importErrorMessage(error).message };
  }
  revalidateWizardPaths();
  return { ok: true };
}

export async function cancelImport(batchId: string): Promise<{ ok: true } | Fail> {
  if (!z.guid().safeParse(batchId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { error } = await ctx.supabase.rpc("import_cancel", { p_batch_id: batchId });
  if (error) return { error: importErrorMessage(error).message };
  // A copy the board chose to keep stays in Documents, where they can delete it.
  revalidatePath("/building/import");
  return { ok: true };
}

// ============================================================================
// Uploads that have not become a batch
// ============================================================================

/**
 * Called right after DirectUpload finishes. Titles the new document "Import:
 * <file>" so the wizard (and only the wizard) may remove it later. A document
 * that was already in Documents, or is old, is left exactly as it is
 * and is never removed by the wizard.
 */
export async function markImportUpload(documentId: string): Promise<{ ok: true; marked: boolean } | Fail> {
  if (!z.guid().safeParse(documentId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const { data } = await ctx.supabase
    .from("documents")
    .select("id, filename, title, uploaded_at, uploaded_by")
    .eq("id", documentId)
    .limit(1);
  const doc = data?.[0] as { id: string; filename: string; title: string | null; uploaded_at: string; uploaded_by: string | null } | undefined;
  if (!doc) return { error: "We couldn't find that upload. Upload the file again." };
  if (isImportUpload(doc)) return { ok: true, marked: true };

  const fresh = Date.now() - new Date(doc.uploaded_at).getTime() < 24 * 3_600_000;
  const untouched = doc.title === null || doc.title === doc.filename || doc.title === "";
  const { data: links } = await ctx.supabase.from("document_links").select("id").eq("document_id", documentId).limit(1);
  if (!fresh || !untouched || (links?.length ?? 0) > 0) return { ok: true, marked: false };

  const { error } = await ctx.supabase
    .from("documents")
    .update({ title: `${IMPORT_TITLE_PREFIX}${doc.filename}`.slice(0, 250) })
    .eq("id", documentId);
  if (error) return { ok: true, marked: false };
  revalidatePath("/building/import");
  return { ok: true, marked: true };
}

export async function removeUnfinishedUpload(documentId: string): Promise<{ ok: true } | Fail> {
  if (!z.guid().safeParse(documentId).success) return { error: GENERIC_IMPORT_ERROR };
  const ctx = await boardAdminContext();
  if (!ctx.ok) return { error: ctx.error };
  const removed = await purgeImportUpload(ctx.supabase, documentId);
  if (!removed) return { error: "We couldn't remove that file. Remove it from Documents." };
  revalidatePath("/building/import");
  return { ok: true };
}

// ============================================================================
// Optional AI help with column names
// ============================================================================

export type SuggestResult =
  | { ok: true; suggestion: AiSuggestion[]; sent: AiPreview }
  | { ok: false; error: string; code: string; reason: string; configured: boolean; quota?: boolean; counted: boolean };

export async function suggestColumnMapping(input: { kind: ImportKind; documentId: string }): Promise<SuggestResult> {
  const checked = z.object({ kind: kindSchema, documentId: z.guid() }).strict().safeParse(input);
  const fail = (error: string): SuggestResult => ({ ok: false, error, code: "bad_request", reason: error, configured: true, counted: false });
  if (!checked.success) return fail(GENERIC_IMPORT_ERROR);
  const ctx = await boardAdminContext();
  if (!ctx.ok) return fail(ctx.error);
  const loaded = await loadAndParse(ctx.supabase, checked.data.documentId, checked.data.kind);
  if (!loaded.ok) return fail(loaded.error);
  const r = await suggestMapping({
    supabase: ctx.supabase,
    associationId: ctx.associationId,
    kind: checked.data.kind,
    headers: loaded.file.headers,
    sampleRows: loaded.file.rows.slice(0, 20),
  });
  if (!r.ok) {
    return { ok: false, error: r.reason, code: r.code, reason: r.reason, configured: r.configured, quota: r.quota, counted: r.counted };
  }
  const detected = detectColumns(checked.data.kind, loaded.file.headers, loaded.file.rows.slice(0, 8)).detected;
  return { ok: true, suggestion: dropRedundant(r.suggestion, detected), sent: r.sent };
}
