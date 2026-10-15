import "server-only";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "./client";
import { aiFailure, AiQuotaError, type AiErrorCode, type AiFailure, type AiQuotaScope } from "./errors";
import { AI_DAILY_LIMITS, AI_KINDS, type AiKind } from "./kinds";

/**
 * Metering (brief decision 10). The database is the gate: claim_ai_call()
 * counts under an advisory lock and inserts an in_flight row before any model
 * call, so two tabs can't both spend the last search. Everything here talks
 * to the 0051 RPCs under the caller's own session; ai_calls never holds a
 * prompt or an answer, only tokens, timings and an error code.
 */

export {
  AI_DAILY_LIMITS, AI_KIND_LABEL, AI_KIND_UNIT, AI_KINDS, AI_PERSON_TRIAGE_LIMIT, remainingLine,
  type AiKind,
} from "./kinds";

export type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Opaque proof that a main row was claimed. Only claimAiCall() makes one. */
export interface AiClaim {
  readonly id: string;
  readonly kind: AiKind;
  readonly associationId: string;
  readonly __brand: "AiClaim";
}

export interface AiUsageRecord {
  model: string;
  input_tokens: number;
  output_tokens: number;
  web_searches?: number;
  ok: boolean;
  error?: string;
  error_code?: AiErrorCode | "not_started";
  cache_read_tokens?: number;
  duration_ms?: number;
  fell_back?: boolean;
}

interface RpcError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

const QUOTA_HINTS: Record<string, AiQuotaScope> = {
  ai_quota: "building",
  ai_attempts: "attempts",
  ai_quota_person: "person",
};

/** "4/4" -> 4 (the limit side of the detail claim_ai_call raises). */
function limitFromDetail(detail: string | null | undefined): number | undefined {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(detail ?? "");
  return m ? Number(m[2]) : undefined;
}

/**
 * The quota gate. rpc("claim_ai_call", { p_association_id, p_kind }).
 *   ok             -> { ok: true, claim }
 *   P0001 ai_quota / ai_attempts / ai_quota_person -> aiFailure("quota", kind, { scope, limit })
 *   42501          -> quota_unknown with "You can't use this AI feature."
 *   anything else  -> quota_unknown: fail closed.
 */
export async function claimAiCall(
  supabase: Supabase,
  associationId: string,
  kind: AiKind,
): Promise<{ ok: true; claim: AiClaim } | AiFailure> {
  let data: unknown;
  let error: RpcError | null;
  try {
    ({ data, error } = await supabase.rpc("claim_ai_call", {
      p_association_id: associationId,
      p_kind: kind,
    }));
  } catch {
    return aiFailure("quota_unknown", kind);
  }

  if (error) {
    const scope = error.code === "P0001" && error.hint ? QUOTA_HINTS[error.hint] : undefined;
    if (scope) {
      const limit = limitFromDetail(error.details) ?? AI_DAILY_LIMITS[kind];
      return aiFailure("quota", kind, { scope, limit });
    }
    if (error.code === "42501") {
      return { ...aiFailure("quota_unknown", kind), reason: "You can't use this AI feature." };
    }
    console.error("claim_ai_call failed", error.code);
    return aiFailure("quota_unknown", kind);
  }

  if (typeof data !== "string" || !data) return aiFailure("quota_unknown", kind);
  return { ok: true, claim: { id: data, kind, associationId, __brand: "AiClaim" } };
}

function usageArgs(usage: AiUsageRecord) {
  return {
    p_ok: usage.ok,
    p_error_code: usage.error_code ?? null,
    p_error: usage.error ? usage.error.slice(0, 500) : null,
    p_model: usage.model,
    p_input_tokens: Math.max(0, Math.round(usage.input_tokens || 0)),
    p_output_tokens: Math.max(0, Math.round(usage.output_tokens || 0)),
    p_cache_read_tokens: Math.max(0, Math.round(usage.cache_read_tokens ?? 0)),
    p_web_searches: Math.max(0, Math.round(usage.web_searches ?? 0)),
    p_duration_ms: usage.duration_ms === undefined ? null : Math.max(0, Math.round(usage.duration_ms)),
    p_fell_back: usage.fell_back ?? false,
  };
}

/** rpc("finish_ai_call", ...). Never throws; logs console.error("ai_calls finish failed", code). */
export async function finishAiCall(supabase: Supabase, claim: AiClaim, usage: AiUsageRecord): Promise<void> {
  try {
    const { error } = await supabase.rpc("finish_ai_call", { p_id: claim.id, ...usageArgs(usage) });
    if (error) console.error("ai_calls finish failed", error.code);
  } catch (e) {
    console.error("ai_calls finish failed", e instanceof Error ? e.name : "unknown");
  }
}

/** rpc("record_ai_call", { p_parent_id: parent.id, ... }) for a followup row. Never throws. */
export async function logAiFollowup(supabase: Supabase, parent: AiClaim, usage: AiUsageRecord): Promise<void> {
  try {
    const { error } = await supabase.rpc("record_ai_call", { p_parent_id: parent.id, ...usageArgs(usage) });
    if (error) console.error("ai_calls followup failed", error.code);
  } catch (e) {
    console.error("ai_calls followup failed", e instanceof Error ? e.name : "unknown");
  }
}

/**
 * Contract name, kept. Writes the outcome row: with usage.claim -> finishAiCall; with
 * usage.parent -> logAiFollowup. Area code doesn't call it (runStructured / webResearch do).
 */
export async function logAiCall(
  supabase: Supabase,
  associationId: string,
  kind: AiKind,
  usage: AiUsageRecord & ({ claim: AiClaim } | { parent: AiClaim }),
): Promise<void> {
  const owner = "claim" in usage ? usage.claim : usage.parent;
  if (owner.associationId !== associationId || owner.kind !== kind) {
    throw new Error("logAiCall: the claim belongs to a different association or kind.");
  }
  if ("claim" in usage) {
    const { claim, ...rest } = usage;
    await finishAiCall(supabase, claim, rest);
  } else {
    const { parent, ...rest } = usage;
    await logAiFollowup(supabase, parent, rest);
  }
}

/**
 * Contract name, kept: a read-only pre-check for UI and early exits. Throws
 * AiQuotaError at the limit, a plain Error when the count can't be read. It
 * does not reserve anything; the binding check is claimAiCall().
 */
export async function assertAiQuota(supabase: Supabase, associationId: string, kind: AiKind): Promise<void> {
  const { data, error } = await supabase.rpc("ai_calls_today", {
    p_association_id: associationId,
    p_kind: kind,
  });
  if (error || typeof data !== "number") {
    throw new Error("Walkup couldn't read today's AI usage.");
  }
  const limit = AI_DAILY_LIMITS[kind];
  if (data >= limit) throw new AiQuotaError(kind, "building", limit, data);
}

/** Board view of today's usage: rpc("ai_quota_status"). Null when the caller isn't board, or on error. */
export async function aiUsageToday(
  supabase: Supabase,
  associationId: string,
): Promise<Record<AiKind, { used: number; attempts: number; limit: number }> | null> {
  try {
    const { data, error } = await supabase.rpc("ai_quota_status", { p_association_id: associationId });
    if (error || !Array.isArray(data)) return null;
    const out = {} as Record<AiKind, { used: number; attempts: number; limit: number }>;
    for (const kind of AI_KINDS) out[kind] = { used: 0, attempts: 0, limit: AI_DAILY_LIMITS[kind] };
    for (const row of data as { kind: string; used: number; attempts: number; daily_limit: number }[]) {
      if (!(AI_KINDS as readonly string[]).includes(row.kind)) continue;
      out[row.kind as AiKind] = {
        used: Number(row.used) || 0,
        attempts: Number(row.attempts) || 0,
        limit: Number(row.daily_limit) || AI_DAILY_LIMITS[row.kind as AiKind],
      };
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Sum usage across one or more responses (pause_turn continuations). Per
 * message: when usage.iterations has entries, sum over them (top-level usage
 * covers only the final attempt) and mark fell_back on a fallback_message
 * entry; otherwise use the top-level fields. A fallback content block also
 * marks fell_back. model is the last message's model (AI_MODEL when none).
 */
export function usageFromMessages(messages: BetaMessage[]): {
  model: string; input_tokens: number; output_tokens: number;
  cache_read_tokens: number; web_searches: number; fell_back: boolean;
} {
  const total = { model: AI_MODEL as string, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, web_searches: 0, fell_back: false };
  for (const m of messages) {
    const u = m.usage;
    const iterations = u?.iterations ?? [];
    if (iterations.length > 0) {
      for (const it of iterations) {
        total.input_tokens += it.input_tokens ?? 0;
        total.output_tokens += it.output_tokens ?? 0;
        total.cache_read_tokens += it.cache_read_input_tokens ?? 0;
        if (it.type === "fallback_message") total.fell_back = true;
      }
    } else if (u) {
      total.input_tokens += u.input_tokens ?? 0;
      total.output_tokens += u.output_tokens ?? 0;
      total.cache_read_tokens += u.cache_read_input_tokens ?? 0;
    }
    total.web_searches += u?.server_tool_use?.web_search_requests ?? 0;
    if (m.content?.some((b) => b.type === "fallback")) total.fell_back = true;
    if (m.model) total.model = m.model;
  }
  return total;
}
