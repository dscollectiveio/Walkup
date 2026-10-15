import "server-only";
import { z } from "zod";
import { aiConfigured } from "@/lib/ai/client";
import { runStructured } from "@/lib/ai/structured";
import { isCoverageType } from "./coverage";
import { fieldsFor, policySelect, type PolicyRow } from "./fields";
import type { Supabase } from "./queries";
import { SUMMARY_SYSTEM, checkSummary, summaryFacts, summaryRetryNote } from "./summary-check";
import { effectiveSections } from "./status";

/**
 * The plain-English policy summary (insurance-spec §7.2). The model sees only
 * "label: value" lines of the policy's own recorded fields; its draft is
 * kept only if every figure and date in it appears in that input. One retry
 * with the reasons; a second rejection stores nothing and sets
 * summary_error. A board-written summary is never overwritten unless the
 * board asked (force).
 */

export type SummaryError = "check_failed" | "quota" | "not_configured" | "failed";

export type SummaryOutcome =
  | { ok: true; summary: string }
  | { ok: false; code: SummaryError | "board_written" | "not_found"; reason: string; configured?: boolean; quota?: boolean };

const SummarySchema = z.object({ summary: z.string() });

export const SUMMARY_COPY = {
  failed: "Walkup couldn't write a summary it could check. Write one, or try again.",
  quota: "Walkup has written as many summaries as it can today. Try again tomorrow, or write one yourself.",
  notConfigured: "Writing summaries isn't set up on this Walkup. Write one in your own words.",
  boardWritten: "The board wrote this summary. Rewrite it from the policy page if you want Walkup's version.",
  notFound: "That policy was not found.",
} as const;

function errorCopy(code: SummaryError): string {
  return code === "quota" ? SUMMARY_COPY.quota : code === "not_configured" ? SUMMARY_COPY.notConfigured : SUMMARY_COPY.failed;
}

export async function writePolicySummary(
  supabase: Supabase,
  policyId: string,
  opts: { force?: boolean } = {},
): Promise<SummaryOutcome> {
  const { data } = await supabase.from("insurance_policies").select(policySelect()).eq("id", policyId).maybeSingle();
  const policy = (data ?? null) as unknown as (PolicyRow & { association_id: string; summary_source: string | null }) | null;
  if (!policy) return { ok: false, code: "not_found", reason: SUMMARY_COPY.notFound };
  if (policy.summary_source === "board" && !opts.force) {
    return { ok: false, code: "board_written", reason: SUMMARY_COPY.boardWritten };
  }

  // A board summary saved while the model was writing must win, unless the board asked for this one.
  const update = (patch: Record<string, unknown>) => {
    const q = supabase.from("insurance_policies").update(patch).eq("id", policyId);
    return opts.force ? q : q.or("summary_source.is.null,summary_source.neq.board");
  };

  const recordError = async (code: SummaryError): Promise<SummaryOutcome> => {
    const { error } = await update({ summary_error: code });
    if (error) console.error("summary_error write failed", error.code);
    return {
      ok: false, code, reason: errorCopy(code),
      ...(code === "not_configured" ? { configured: false } : {}),
      ...(code === "quota" ? { quota: true } : {}),
    };
  };

  if (!aiConfigured()) return recordError("not_configured");

  const coverage = isCoverageType(policy.coverage) ? policy.coverage : "other";
  const facts = summaryFacts(policy, fieldsFor(coverage, effectiveSections(policy), "policy"));
  const input = facts.join("\n");

  let reasons: string[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await runStructured({
      kind: "insurance_summary",
      supabase,
      associationId: policy.association_id,
      system: SUMMARY_SYSTEM,
      content: reasons ? `${input}\n\n${summaryRetryNote(reasons)}` : input,
      schema: SummarySchema,
      effort: "low",
      maxTokens: 2_000,
      timeoutMs: 60_000,
    });
    if (!r.ok) {
      return recordError(r.code === "quota" || r.code === "quota_unknown" ? "quota" : r.code === "not_configured" ? "not_configured" : "failed");
    }
    const summary = r.data.summary.trim();
    const check = checkSummary(summary, facts);
    if (check.ok) {
      const { error } = await update({
        summary_text: summary, summary_source: "model", summary_written_at: new Date().toISOString(), summary_error: null,
      });
      if (error) {
        console.error("summary write failed", error.code);
        return { ok: false, code: "failed", reason: SUMMARY_COPY.failed };
      }
      return { ok: true, summary };
    }
    reasons = check.reasons;
  }
  return recordError("check_failed");
}
