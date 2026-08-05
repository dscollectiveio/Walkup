import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { extractDocumentText } from "./extract-text";
import { classifyDocument, CONFIDENCE_THRESHOLD } from "./classify";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Read a stored document and file it.
 *
 * Runs after the response is sent (Next's `after`), so the uploader sees the
 * file in the list immediately and this happens behind them. That is the whole
 * reason `extraction_state` exists on the row: work that nobody is waiting on
 * is work nobody notices has died, so every stage is written down and a stuck
 * document is visible and re-runnable rather than silently pending forever.
 *
 * Ordering is deliberate: a user's own filing rule wins over the model, and
 * the model never overwrites a category a person already chose.
 */
export async function runExtraction(
  supabase: Supabase,
  documentId: string,
): Promise<{ state: string; detail?: string }> {
  const { data: rows } = await supabase
    .from("documents")
    .select(
      "id, association_id, storage_path, filename, mime_type, category_id, tag_source, extraction_attempts",
    )
    .eq("id", documentId)
    .limit(1);

  const doc = rows?.[0];
  if (!doc) return { state: "failed", detail: "Document not visible." };

  const fail = async (detail: string, state: "failed" | "skipped" = "failed") => {
    await supabase
      .from("documents")
      .update({
        extraction_state: state,
        extraction_error: detail,
        extraction_attempts: (doc.extraction_attempts ?? 0) + 1,
      })
      .eq("id", documentId);
    return { state, detail };
  };

  await supabase
    .from("documents")
    .update({
      extraction_state: "running",
      extraction_error: null,
      extraction_attempts: (doc.extraction_attempts ?? 0) + 1,
    })
    .eq("id", documentId);

  // --- get the bytes back out of storage -----------------------------------
  const { data: blob, error: downloadError } = await supabase.storage
    .from("documents")
    .download(doc.storage_path);

  if (downloadError || !blob) {
    return fail(downloadError?.message ?? "The stored file could not be read.");
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());

  // --- text (redacted at the boundary) -------------------------------------
  const extracted = await extractDocumentText(doc.mime_type, bytes);
  if (!extracted.ok) {
    // Not a failure of the pipeline — the file simply has nothing to read.
    // "skipped" says that plainly instead of showing a red error.
    return fail(extracted.reason, "skipped");
  }

  // --- a board's own rule beats the model ----------------------------------
  const { data: rules } = await supabase
    .from("tag_rules")
    .select("match_type, match_value, set_category_id, set_folder_id")
    .eq("association_id", doc.association_id);

  const matched = (rules ?? []).find((r) => {
    const needle = r.match_value.toLowerCase();
    if (r.match_type === "filename_pattern") return doc.filename.toLowerCase().includes(needle);
    if (r.match_type === "text_contains") return extracted.text.toLowerCase().includes(needle);
    return false; // sender_email applies to email intake, which doesn't exist yet
  });

  if (matched?.set_category_id) {
    await supabase
      .from("documents")
      .update({
        extracted_text: extracted.text,
        category_id: matched.set_category_id,
        folder_id: matched.set_folder_id ?? null,
        tag_source: "manual",
        tag_confidence: null,
        review_state: "ok",
        extraction_state: "done",
        extraction_error: null,
      })
      .eq("id", documentId);
    return { state: "done", detail: "Filed by one of your rules." };
  }

  // --- the model -----------------------------------------------------------
  const { data: categories } = await supabase
    .from("document_categories")
    .select("slug, label")
    .eq("association_id", doc.association_id)
    .order("sort_order");

  const result = await classifyDocument({
    filename: doc.filename,
    mimeType: doc.mime_type,
    text: extracted.text,
    categories: categories ?? [],
  });

  if (!result.ok) {
    // Text was read even though classification failed — keep it, so search
    // works and a person can file it by hand.
    await supabase
      .from("documents")
      .update({ extracted_text: extracted.text })
      .eq("id", documentId);
    return fail(result.reason, result.configured ? "failed" : "skipped");
  }

  const e = result.extraction;
  const category = (categories ?? []).find((c) => c.slug === e.category);

  const { data: categoryRow } = category
    ? await supabase
        .from("document_categories")
        .select("id")
        .eq("association_id", doc.association_id)
        .eq("slug", e.category)
        .limit(1)
    : { data: null };

  const guessedId = categoryRow?.[0]?.id ?? null;
  const confident = e.confidence >= CONFIDENCE_THRESHOLD;

  // A category a person already chose is never overwritten by a guess. The
  // extracted fields still get saved — those are additive.
  const alreadyFiled = doc.category_id !== null && doc.tag_source === "manual";

  await supabase
    .from("documents")
    .update({
      extracted_text: extracted.text,
      extraction: e,
      extraction_state: "done",
      extraction_error: null,
      ...(alreadyFiled
        ? {}
        : {
            category_id: guessedId,
            tag_source: "auto",
            tag_confidence: e.confidence,
            review_state: confident ? "ok" : "needs_review",
          }),
    })
    .eq("id", documentId);

  return {
    state: "done",
    detail: alreadyFiled
      ? "Read; the category you chose was left alone."
      : confident
        ? `Filed as ${category?.label ?? e.category}.`
        : `Guessed ${category?.label ?? e.category} — waiting for someone to confirm.`,
  };
}
