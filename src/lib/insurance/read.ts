import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { aiConfigured } from "@/lib/ai/client";
import type { AiErrorCode, AiFailure } from "@/lib/ai/errors";
import { runStructured } from "@/lib/ai/structured";
import { extractDocxPages } from "@/lib/documents/docx-text";
import { extractPdfPages } from "@/lib/documents/extract-text";
import { isCoverageType } from "./coverage";
import { fieldsFor } from "./fields";
import {
  DOCX_MIME, IMAGE_NOTE, NATIVE_NOTE, OUTLINE_PROMPT, OutlineSchema, PolicyDetailSchema, READ_DEADLINE_MS, READ_LIMITS, READ_SYSTEM,
  buildDetailPrompt, chooseReadMethod, joinTextPages, postProcessRead,
  type DetailError, type DetailOutcome, type Outline, type ReadMode, type StoredRead,
} from "./read-schema";
import type { Supabase } from "./queries";

/**
 * Reads one insurance document (insurance-spec §7.1.7). Runs in after(),
 * never during a render. The read row is the state machine: claim it, check
 * the file is still filed as Insurance, pick the method (text layer, or the
 * PDF or photo itself per decision 7), outline the policies, read each one's
 * details, post-process (redaction, clamping, quote mode never pre-fills),
 * and write the outcome. Every write is guarded by the claimed started_at so
 * a run reclaimed after going stale can't overwrite the newer one.
 *
 * Metering: Foundation's runStructured has no unmetered follow-up step, so
 * each pass-2 call is its own metered call (see the I3 progress note).
 */

export type ReadOutcome = {
  state: "done" | "failed" | "unreadable" | "not_configured" | "quota" | "timed_out" | "skipped";
  detail?: string;
};

interface ClaimedRead {
  id: string;
  association_id: string;
  document_id: string;
  mode: ReadMode;
  attempts: number;
  started_at: string;
}

export const READ_COPY = {
  notInsurance:
    "This file is no longer filed as Insurance, so Walkup won't read it. File it as Insurance in Documents and try again.",
  noFile: "Walkup couldn't open the stored file. Try uploading it again.",
  notConfigured: "Reading isn't set up on this Walkup.",
  quota: "Walkup has read as many documents as it can for your building today. Try again tomorrow, or enter the details by hand.",
  timedOut: "Reading took too long and stopped.",
  tooLarge: "This file is too large or unusual for Walkup to read. Upload just the declarations pages, or a screenshot of them.",
  busy: "Walkup's reader is busy. Try again in a minute.",
  failed: "Walkup couldn't read this file this time.",
} as const;

type FailState = "quota" | "not_configured" | "timed_out" | "unreadable" | "failed";

/** §7.1.7 step 7: an AiFailure code to the read's state, its copy, and whether the attempt is given back. */
export function readStateFor(code: AiErrorCode, method: StoredRead["method"]): { state: FailState; error: string; giveBack: boolean } {
  switch (code) {
    case "quota":
    case "quota_unknown":
      return { state: "quota", error: READ_COPY.quota, giveBack: true };
    case "not_configured":
      return { state: "not_configured", error: READ_COPY.notConfigured, giveBack: true };
    case "timeout":
      return { state: "timed_out", error: READ_COPY.timedOut, giveBack: false };
    case "too_long":
    case "bad_request":
    case "unsupported_file":
      return method === "text" && code === "bad_request"
        ? { state: "failed", error: READ_COPY.failed, giveBack: false }
        : { state: "unreadable", error: READ_COPY.tooLarge, giveBack: false };
    case "busy":
    case "unreachable":
      return { state: "failed", error: READ_COPY.busy, giveBack: false };
    default:
      return { state: "failed", error: READ_COPY.failed, giveBack: false };
  }
}

function detailErrorFor(code: AiErrorCode): DetailError {
  return code === "timeout" ? "timeout" : code === "too_long" ? "too_long" : "failed";
}

/** PDF page count from the unpdf proxy; null when it can't be opened. A copy is passed: pdf.js may detach the buffer. */
async function pdfPageCount(bytes: Uint8Array): Promise<number | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes.slice());
    return typeof pdf.numPages === "number" && pdf.numPages > 0 ? pdf.numPages : null;
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

type Content = Exclude<Anthropic.MessageParam["content"], string>;

/** Runs `fn` over items with at most `limit` in flight, keeping order. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    const settled = await Promise.allSettled(batch.map((item, i) => fn(item, start + i)));
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") out[start + i] = s.value;
      else throw s.reason;
    });
  }
  return out;
}

export async function runInsuranceRead(supabase: Supabase, readId: string): Promise<ReadOutcome> {
  // 1. Claim. A set: an empty array means another tab has it, or the cap is reached.
  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_insurance_read", { p_read_id: readId });
  const claimed = (Array.isArray(claimedRows) ? claimedRows[0] : null) as ClaimedRead | null;
  if (claimError || !claimed) return { state: "skipped" };
  const claimedAt = Date.now();
  const deadline = claimedAt + READ_DEADLINE_MS;

  const write = async (patch: Record<string, unknown>) => {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("insurance_document_reads")
      .update({ ...patch, updated_at: now })
      .eq("id", readId)
      .eq("state", "running")
      .eq("started_at", claimed.started_at);
    if (error) console.error("insurance read write failed", error.code);
  };
  const end = async (state: FailState, error: string, extra: Record<string, unknown> = {}): Promise<ReadOutcome> => {
    await write({ state, error: error.slice(0, 300), finished_at: new Date().toISOString(), ...extra });
    return { state, detail: error };
  };
  const giveBack = { attempts: Math.max(0, claimed.attempts - 1) };

  try {
    // 2. The file, and its category (it could have changed since queueing).
    const { data: doc } = await supabase
      .from("documents")
      .select("storage_path, mime_type, byte_size, filename, document_categories(slug)")
      .eq("id", claimed.document_id)
      .maybeSingle();
    const d = doc as {
      storage_path: string; mime_type: string | null; byte_size: number | null; filename: string;
      document_categories: { slug: string } | { slug: string }[] | null;
    } | null;
    if (!d) return end("failed", READ_COPY.noFile);
    const category = Array.isArray(d.document_categories) ? d.document_categories[0] : d.document_categories;
    if (category?.slug !== "insurance") return end("unreadable", READ_COPY.notInsurance);

    const { data: blob, error: downloadError } = await supabase.storage.from("documents").download(d.storage_path);
    if (downloadError || !blob) return end("failed", READ_COPY.noFile);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // 3. Method.
    const mime = (d.mime_type ?? "").toLowerCase();
    const isPdf = mime === "application/pdf";
    const pages = isPdf
      ? await extractPdfPages(mime, bytes.slice())
      : mime === DOCX_MIME
        ? await extractDocxPages(bytes.slice())
        : null;
    const pageCount = isPdf ? await pdfPageCount(bytes) : null;
    const choice = chooseReadMethod({ mime: d.mime_type, byteSize: d.byte_size ?? bytes.byteLength, pages, pageCount });
    if (choice.method === "unreadable") return end("unreadable", choice.reason);
    const method: StoredRead["method"] = choice.method;

    // 4. Configured?
    if (!aiConfigured()) return end("not_configured", READ_COPY.notConfigured, giveBack);

    const mode: ReadMode = claimed.mode === "quote" ? "quote" : "policy";
    const textPages = choice.method === "text" ? choice.pages : [];
    const note = method === "native_pdf" ? NATIVE_NOTE : method === "image" ? IMAGE_NOTE : null;
    const fileBlock = (): Content =>
      choice.method === "native_pdf"
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64(bytes) } }]
        : choice.method === "image"
          ? [{ type: "image", source: { type: "base64", media_type: choice.mediaType, data: base64(bytes) } }]
          : [];
    const textBlock = (only: number[]): Content => [
      { type: "text", text: `The document's text, page by page:\n\n${joinTextPages(textPages, only)}` },
    ];
    const prompt = (text: string): Content => [{ type: "text", text: note ? `${text}\n\n${note}` : text }];

    // 5. Pass 1: the outline.
    const outlineRun = await runStructured({
      kind: "insurance_read",
      supabase,
      associationId: claimed.association_id,
      system: READ_SYSTEM,
      content: [...(method === "text" ? textBlock([]) : fileBlock()), ...prompt(OUTLINE_PROMPT)],
      schema: OutlineSchema,
      effort: "low",
      maxTokens: 8_000,
      timeoutMs: Math.max(1_000, Math.min(90_000, deadline - Date.now())),
    });
    if (!outlineRun.ok) {
      const m = readStateFor(outlineRun.code, method);
      return end(m.state, m.error, { error: (outlineRun.reason || m.error).slice(0, 300), ...(m.giveBack ? giveBack : {}) });
    }
    const outline: Outline = outlineRun.data;
    const effectivePageCount = method === "text" ? textPages.length : method === "image" ? 1 : pageCount ?? READ_LIMITS.maxNativePages;

    // 6. Pass 2: each found policy's details, 3 at a time.
    const items = outline.documentKind === "not_insurance" ? [] : outline.policies.slice(0, READ_LIMITS.maxPolicies);
    const associationId = claimed.association_id;
    const failures: AiFailure[] = [];
    const details: DetailOutcome[] = await pooled(items, 3, async (item): Promise<DetailOutcome> => {
      const timeoutMs = deadline - Date.now() - 5_000;
      if (timeoutMs < 5_000) return { error: "timeout" };
      const coverage = isCoverageType(item.coverage) ? item.coverage : "other";
      const defs = fieldsFor(coverage, item.sections ?? [], mode);
      const pageList = [...new Set((item.pages ?? []).filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b);
      const detailPrompt = buildDetailPrompt(defs, pageList, mode, {
        coverage, carrierName: item.carrierName, policyNumber: item.policyNumber,
      });
      const onlyPages = method === "native_pdf" && pageList.length
        ? `\n\nRead only pages ${pageList.join(", ")} of this PDF. Ignore the other pages.`
        : "";
      const r = await runStructured({
        kind: "insurance_read",
        supabase,
        associationId,
        system: READ_SYSTEM,
        content: [...(method === "text" ? textBlock(pageList) : fileBlock()), ...prompt(`${detailPrompt}${onlyPages}`)],
        schema: PolicyDetailSchema,
        effort: "medium",
        maxTokens: 16_000,
        timeoutMs,
      });
      if (r.ok) return { detail: r.data };
      failures.push(r);
      return { error: detailErrorFor(r.code) };
    });

    if (items.length > 0 && details.every((x) => x !== null && "error" in x)) {
      const first = failures[0];
      const m = first ? readStateFor(first.code, method) : readStateFor("timeout", method);
      return end(m.state, m.error, { error: (first?.reason || m.error).slice(0, 300), ...(m.giveBack ? giveBack : {}) });
    }

    // 8. Done.
    const result = postProcessRead(outline, details, { pageCount: effectivePageCount, method, mode });
    await write({
      state: "done",
      method,
      page_count: method === "image" ? 1 : method === "text" ? Math.max(1, textPages.length) : pageCount,
      result,
      error: null,
      finished_at: new Date().toISOString(),
    });
    return { state: "done" };
  } catch (e) {
    console.error("insurance read failed", e instanceof Error ? e.name : "unknown");
    return end("failed", READ_COPY.failed);
  }
}
