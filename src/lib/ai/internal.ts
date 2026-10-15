import "server-only";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlock, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { AI_MODEL, anthropic, baseParams } from "./client";
import { aiFailure, classifyAiError, describeParseError, type AiErrorCode, type AiFailure } from "./errors";
import type { AiSuccess, RunStructuredOptions } from "./structured";
import { logAiFollowup, usageFromMessages, type AiClaim, type AiUsageRecord } from "./usage";

/**
 * The one place that calls messages.create for structured output.
 *
 * Imported only from inside src/lib/ai/ (tests/unit/ai-internal-imports.test.ts):
 * callStructured makes a call without touching the quota, so area code must
 * reach it only through runStructured, which claims first.
 */

/** Text produced after the last fallback marker, joined. Exported for tests. */
export function finalText(content: BetaContentBlock[]): string {
  const lastFallback = content.map((b) => b.type).lastIndexOf("fallback");
  return content
    .slice(lastFallback + 1)
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** One structured call, unmetered. Returns the outcome and the usage row to write. */
export async function callStructured<T>(
  opts: Omit<RunStructuredOptions<T>, "claim" | "supabase" | "associationId">,
): Promise<{ result: AiSuccess<T> | AiFailure; usage: AiUsageRecord }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])]);
  // The helper turns the zod schema into the JSON schema the API expects. We
  // send only { type, schema } and parse ourselves after checking stop_reason:
  // the helper's own parse() wraps zod errors in a message that quotes them.
  const format = betaZodOutputFormat(opts.schema);
  const started = Date.now();
  const base = { model: AI_MODEL, input_tokens: 0, output_tokens: 0 };

  let message: BetaMessage;
  try {
    message = await anthropic().beta.messages.create(
      {
        ...baseParams({ structured: true }),
        max_tokens: Math.min(opts.maxTokens ?? 16_000, 20_000),
        output_config: { effort: opts.effort ?? "medium", format: { type: format.type, schema: format.schema } },
        system: opts.system,
        messages: [{ role: "user", content: opts.content }],
      },
      { signal, timeout: timeoutMs, maxRetries: 1 },
    );
  } catch (e) {
    const { code, detail } = classifyAiError(e, signal);
    return {
      result: aiFailure(code, opts.kind),
      usage: { ...base, ok: false, error_code: code, error: detail, duration_ms: Date.now() - started },
    };
  }

  const u = usageFromMessages([message]);
  const usage = (x: { ok: boolean; error_code?: AiErrorCode; error?: string }): AiUsageRecord => ({
    model: u.model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_tokens,
    fell_back: u.fell_back,
    duration_ms: Date.now() - started,
    ...x,
  });

  switch (message.stop_reason) {
    case "refusal":
      return {
        result: aiFailure("refused", opts.kind),
        usage: usage({ ok: false, error_code: "refused", error: `refusal:${message.stop_details?.category ?? "unknown"}` }),
      };
    case "max_tokens":
    case "model_context_window_exceeded":
      return {
        result: aiFailure("too_long", opts.kind),
        usage: usage({ ok: false, error_code: "too_long", error: message.stop_reason }),
      };
    case "end_turn":
    case "stop_sequence":
      break;
    default: // pause_turn, tool_use, compaction: impossible without tools; never parse a half answer
      return {
        result: aiFailure("incomplete", opts.kind),
        usage: usage({ ok: false, error_code: "incomplete", error: String(message.stop_reason) }),
      };
  }

  let data: T;
  try {
    data = opts.schema.parse(JSON.parse(finalText(message.content)));
  } catch (e) {
    return {
      result: aiFailure("bad_output", opts.kind),
      usage: usage({ ok: false, error_code: "bad_output", error: describeParseError(e) }),
    };
  }
  return {
    result: { ok: true, data, meta: { model: u.model, fellBack: u.fell_back, durationMs: Date.now() - started } },
    usage: usage({ ok: true }),
  };
}

/**
 * For webResearch's structuring step only: callStructured, then logAiFollowup under the
 * research call's claim. Not exported from structured.ts, so area code can't reach a call
 * that skips the quota.
 */
export async function runStructuredUnmetered<T>(
  opts: Omit<RunStructuredOptions<T>, "claim"> & { parent: AiClaim },
): Promise<AiSuccess<T> | AiFailure> {
  const { supabase, parent, ...rest } = opts;
  const r = await callStructured({
    kind: rest.kind,
    system: rest.system,
    content: rest.content,
    schema: rest.schema,
    effort: rest.effort,
    maxTokens: rest.maxTokens,
    timeoutMs: rest.timeoutMs,
    signal: rest.signal,
  });
  await logAiFollowup(supabase, parent, r.usage);
  return r.result;
}
