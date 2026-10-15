import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { AI_MODEL, aiConfigured } from "./client";
import { aiFailure, type AiFailure } from "./errors";
import { callStructured } from "./internal";
import { nativeInputProblem } from "./native-input";
import { claimAiCall, finishAiCall, type AiClaim, type AiKind, type Supabase } from "./usage";

/**
 * One metered structured-output call: claim the quota, call the model, record
 * the outcome. The only structured entry point area code may use; the
 * unmetered variant lives in internal.ts so nothing outside src/lib/ai can
 * skip the quota (unit test ai-internal-imports enforces it).
 */

export interface RunStructuredOptions<T> {
  kind: AiKind;
  supabase: Supabase;
  associationId: string;
  system: string;
  content: Anthropic.MessageParam["content"];   // text, document or image blocks
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high";           // default "medium"
  maxTokens?: number;                           // default 16_000; never above 20_000 (non-streaming guard)
  timeoutMs?: number;                           // overall deadline, default 120_000
  claim?: AiClaim;                              // pre-claimed by a background action (5.3); else claimed here
  signal?: AbortSignal;
}

export type AiSuccess<T> = { ok: true; data: T; meta: { model: string; fellBack: boolean; durationMs: number } };

/** A pre-claimed AiClaim must be for this kind and association: a mismatch is a programmer error. */
export function assertClaimMatches(claim: AiClaim, kind: AiKind, associationId: string): void {
  if (claim.kind !== kind || claim.associationId !== associationId) {
    throw new Error(`AI claim mismatch: claimed ${claim.kind} for another call (${kind}).`);
  }
}

export async function runStructured<T>(opts: RunStructuredOptions<T>): Promise<AiSuccess<T> | AiFailure> {
  if (opts.claim) assertClaimMatches(opts.claim, opts.kind, opts.associationId);

  // A background action that claimed up front gets its row closed as
  // not_started when nothing is sent, so it neither counts nor lingers.
  const release = async () => {
    if (opts.claim) {
      await finishAiCall(opts.supabase, opts.claim, {
        model: AI_MODEL, input_tokens: 0, output_tokens: 0, ok: false, error_code: "not_started",
      });
    }
  };

  if (!aiConfigured()) {
    await release();
    return aiFailure("not_configured", opts.kind);
  }

  const problem = nativeInputProblem(opts.content);
  if (problem) {
    await release();
    return aiFailure(problem, opts.kind);
  }

  let claim = opts.claim;
  if (!claim) {
    const claimed = await claimAiCall(opts.supabase, opts.associationId, opts.kind);
    if (!claimed.ok) return claimed;
    claim = claimed.claim;
  }

  const r = await callStructured({
    kind: opts.kind,
    system: opts.system,
    content: opts.content,
    schema: opts.schema,
    effort: opts.effort,
    maxTokens: opts.maxTokens,
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });
  await finishAiCall(opts.supabase, claim, r.usage);
  return r.result;
}
