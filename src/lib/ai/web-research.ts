import "server-only";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaUserLocation,
  BetaWebSearchTool20260209,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { buildingTodayIso } from "@/lib/dates";
import { AI_MODEL, aiConfigured, anthropic, baseParams } from "./client";
import { aiFailure, classifyAiError, type AiErrorCode, type AiFailure } from "./errors";
import { runStructuredUnmetered } from "./internal";
import { RESEARCH_SYSTEM, STRUCTURE_SYSTEM, researchUserMessage, structureUserMessage } from "./prompts";
import { assertClaimMatches, type AiSuccess } from "./structured";
import { claimAiCall, finishAiCall, usageFromMessages, type AiClaim, type AiKind, type Supabase } from "./usage";
import {
  collectEvidence, normaliseUrl, scrubWebTask, verifyItems,
  type Evidence, type VerifyContext, type Verified,
} from "./verify";

/**
 * Web research with anti-fabrication enforced in code (brief decisions 4, 5).
 *
 * Three steps, because citations and structured output can't share one call:
 *   1. a research call with Anthropic's web search tool (pause_turn loop),
 *      which yields search-result URLs and cited text;
 *   2. a structuring call that turns those notes into the area's item schema
 *      (logged as a followup under the research call's claim, never counted);
 *   3. verifyItems(): every kept item is backed by a URL this search returned,
 *      its name appears in its own sources, and contact details survive only
 *      when cited for it. Then the area's own `verify`.
 */

export {
  appearsInCitations, normaliseUrl, normaliseUrlExact, hostOf, hostInSearch, isAggregatorHost,
  verifyWebsite, verifyRating, verifyClaims, lintMarketingCopy, scrubWebTask, nameAppears,
  AGGREGATOR_HOSTS, type Citation, type VerifyContext, type Verified,
} from "./verify";
export { loadRedactionTerms } from "./redaction";

export interface ResearchResult<T> {
  items: Verified<T>[];
  sources: { url: string; title: string | null }[];   // sources referenced by kept items, deduped
  fetchedAt: string;                                    // ISO timestamp of the research call
  partial: boolean;                                     // the time budget ran out before research finished
  checkedPages: number;                                 // evidence.results.length, for "{n} pages were checked"
}

export interface WebResearchOptions<T extends { sourceUrls: string[] }> {
  kind: AiKind;
  supabase: Supabase;
  associationId: string;
  task: string;                     // built from structured fields and board-written text only
  redact: { names: string[]; addresses: string[]; keep?: string[]; unavailable?: boolean }; // loadRedactionTerms()
  itemSchema: z.ZodType<T>;         // per item; must include sourceUrls: z.array(z.string())
  nameOf: (item: T) => string | null; // the business or insurer name, checked against sources
  itemGuidance?: string;            // one paragraph: what each field means, for the structuring step
  verify: (item: T, ctx: VerifyContext) => T | null;
  claim?: AiClaim;                  // pre-claimed by a background action (5.3)
  maxSearches?: number;             // tool max_uses, default 5, clamped 1..10
  userLocation?: { city?: string; region?: string; country?: string; postal_code?: string };
  effort?: "low" | "medium" | "high"; // research call, default "medium"
  timeoutMs?: number;               // whole operation, default 240_000
}

export const MAX_CONTINUATIONS = 3;
export const STRUCTURE_RESERVE_MS = 60_000;
/** A research turn doesn't start with less than this left after the structuring reserve. */
export const MIN_TURN_MS = 15_000;

/**
 * Assistant content to send back after pause_turn. When a fallback block is
 * present, blocks before the last one that the server can't resume from
 * (thinking, client tool calls, unpaired server tool calls) are dropped;
 * everything after it is kept, including the trailing server_tool_use.
 */
export function echoable(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  if (lastFallback < 0) return content as unknown as BetaContentBlockParam[];
  const answered = new Set(
    content
      .filter((b): b is Extract<BetaContentBlock, { type: "web_search_tool_result" }> => b.type === "web_search_tool_result")
      .map((b) => b.tool_use_id),
  );
  const kept = content.filter((b, i) => {
    if (i >= lastFallback) return true;
    if (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use") return false;
    if (b.type === "server_tool_use") return answered.has(b.id);
    return true;
  });
  return kept as unknown as BetaContentBlockParam[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export async function webResearch<T extends { sourceUrls: string[] }>(
  opts: WebResearchOptions<T>,
): Promise<{ ok: true; result: ResearchResult<T>; meta: AiSuccess<unknown>["meta"] } | AiFailure> {
  const { kind, supabase } = opts;
  if (opts.claim) assertClaimMatches(opts.claim, kind, opts.associationId);

  if (!aiConfigured()) {
    if (opts.claim) {
      await finishAiCall(supabase, opts.claim, {
        model: AI_MODEL, input_tokens: 0, output_tokens: 0, ok: false, error_code: "not_started",
      });
    }
    return aiFailure("not_configured", kind);
  }

  // The names and addresses to remove could not be loaded: nothing leaves, nothing is claimed (REVIEW-2 #11).
  if (opts.redact.unavailable) {
    if (opts.claim) {
      await finishAiCall(supabase, opts.claim, {
        model: AI_MODEL, input_tokens: 0, output_tokens: 0, ok: false, error_code: "not_started",
      });
    }
    return aiFailure("unknown", kind);
  }

  let claim = opts.claim;
  if (!claim) {
    const claimed = await claimAiCall(supabase, opts.associationId, kind);
    if (!claimed.ok) return claimed;
    claim = claimed.claim;
  }

  const timeoutMs = opts.timeoutMs ?? 240_000;
  const started = Date.now();
  const deadline = started + timeoutMs;
  const signal = AbortSignal.timeout(timeoutMs);
  const effort = opts.effort ?? "medium";

  const task = scrubWebTask(opts.task, opts.redact);
  const loc = opts.userLocation;
  const postal = loc?.postal_code && /^\d{5}$/.test(loc.postal_code.trim()) ? loc.postal_code.trim() : undefined;
  const userLocation: BetaUserLocation | undefined =
    loc?.city || loc?.region
      ? {
          type: "approximate",
          ...(loc.city ? { city: loc.city } : {}),
          ...(loc.region ? { region: loc.region } : {}),
          country: loc.country ?? "US",
          timezone: "America/Chicago",
        }
      : undefined;
  const tool: BetaWebSearchTool20260209 = {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: clamp(opts.maxSearches ?? 5, 1, 10),
    ...(userLocation ? { user_location: userLocation } : {}),
  };

  const messages: BetaMessageParam[] = [
    {
      role: "user",
      content: researchUserMessage(
        task,
        loc || postal ? { city: loc?.city, region: loc?.region, postalCode: postal } : null,
        buildingTodayIso(),
      ),
    },
  ];
  const responses: BetaMessage[] = [];
  const fetchedAt = new Date().toISOString();
  let container: string | undefined;
  let partial = false;
  let noteCode: AiErrorCode | undefined;

  const hasResults = () => collectEvidence(responses).results.length > 0;
  const fail = async (code: AiErrorCode, detail: string) => {
    const u = usageFromMessages(responses);
    await finishAiCall(supabase, claim, {
      model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_read_tokens: u.cache_read_tokens, web_searches: u.web_searches, fell_back: u.fell_back,
      duration_ms: Date.now() - started, ok: false, error_code: code, error: detail,
    });
    return aiFailure(code, kind);
  };

  let threw = false;
  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
    const remaining = deadline - Date.now() - STRUCTURE_RESERVE_MS;
    if (remaining < MIN_TURN_MS) {
      if (hasResults()) {
        partial = true;
        noteCode = "timeout";
        break;
      }
      return fail("timeout", "deadline before research finished");
    }
    let res: BetaMessage;
    try {
      res = await anthropic().beta.messages.create(
        {
          ...baseParams({ structured: false }),
          max_tokens: 16_000,
          output_config: { effort },
          system: RESEARCH_SYSTEM,
          tools: [tool],
          messages,
          ...(container ? { container } : {}),
        },
        { signal, timeout: remaining, maxRetries: 1 },
      );
    } catch (e) {
      const { code, detail } = classifyAiError(e, signal);
      if (code === "timeout" && hasResults()) {
        partial = true;
        noteCode = "timeout";
        threw = true;
        break;
      }
      return fail(code, detail);
    }
    responses.push(res);
    container = res.container?.id ?? container;
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: echoable(res.content) });
  }

  if (!partial && !threw) {
    const last = responses[responses.length - 1];
    switch (last?.stop_reason) {
      case "pause_turn":
        if (hasResults()) {
          partial = true;
          noteCode = "incomplete";
        } else return fail("incomplete", "pause_turn after the continuation cap");
        break;
      case "refusal":
        return fail("refused", `refusal:${last.stop_details?.category ?? "unknown"}`);
      case "max_tokens":
      case "model_context_window_exceeded":
        // The evidence gathered is real and verification protects the output.
        noteCode = "too_long";
        break;
      default:
        break;
    }
  }

  const u = usageFromMessages(responses);
  const durationMs = Date.now() - started;
  await finishAiCall(supabase, claim, {
    model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_tokens, web_searches: u.web_searches, fell_back: u.fell_back,
    duration_ms: durationMs, ok: true,
    // ok rows may carry a note: a partial run, or a research turn that hit max_tokens.
    ...(noteCode ? { error_code: noteCode } : {}),
  });
  const meta = { model: u.model, fellBack: u.fell_back, durationMs };

  const evidence: Evidence = collectEvidence(responses);
  if (evidence.results.length === 0) {
    return { ok: true, result: { items: [], sources: [], fetchedAt, partial, checkedPages: 0 }, meta };
  }

  const structured = await runStructuredUnmetered({
    kind,
    supabase,
    associationId: opts.associationId,
    parent: claim,
    system: STRUCTURE_SYSTEM,
    content: structureUserMessage(task, opts.itemGuidance, evidence),
    schema: z.object({ items: z.array(opts.itemSchema) }),
    effort: "medium",
    maxTokens: 16_000,
    timeoutMs: Math.max(15_000, deadline - Date.now()),
    signal,
  });
  if (!structured.ok) return structured;

  const items = verifyItems(structured.data.items as T[], evidence, opts.nameOf, opts.verify);

  const referenced = new Set(items.flatMap((i) => i.sourceUrls.map(normaliseUrl)));
  const sources: { url: string; title: string | null }[] = [];
  const seen = new Set<string>();
  for (const r of evidence.results) {
    const n = normaliseUrl(r.url);
    if (!referenced.has(n) || seen.has(n)) continue;
    seen.add(n);
    sources.push({ url: r.url, title: r.title });
  }
  // A kept URL that only appeared as a citation (not a result block) still gets listed.
  for (const c of evidence.citations) {
    const n = normaliseUrl(c.url);
    if (!referenced.has(n) || seen.has(n)) continue;
    seen.add(n);
    sources.push({ url: c.url, title: c.title });
  }

  return {
    ok: true,
    result: { items, sources, fetchedAt, partial, checkedPages: evidence.results.length },
    meta,
  };
}
