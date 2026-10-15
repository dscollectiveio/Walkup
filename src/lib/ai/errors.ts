import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { redactTaxIds } from "@/lib/documents/redact";
import { AiNotConfiguredError } from "./client";
import { AI_DAILY_LIMITS, AI_KIND_LABEL, type AiKind } from "./kinds";

/**
 * Every way an AI call can fail, as a code the UI can branch on and one
 * plain-English sentence a board member can act on (foundation-spec 10.2).
 * Nothing here ever echoes a prompt or a model answer.
 */

export type AiErrorCode =
  | "not_configured" | "quota" | "quota_unknown" | "refused" | "timeout" | "busy"
  | "unreachable" | "rejected_key" | "bad_request" | "too_long" | "bad_output"
  | "incomplete" | "unsupported_file" | "unknown";

/** Which limit was hit, from the P0001 hint raised by claim_ai_call. */
export type AiQuotaScope = "building" | "attempts" | "person";

export class AiQuotaError extends Error {
  constructor(
    public readonly kind: AiKind,
    public readonly scope: AiQuotaScope,
    public readonly limit: number,
    public readonly used: number,
  ) {
    super(`daily limit reached for ${kind} (${scope}): ${used}/${limit}`);
    this.name = "AiQuotaError";
  }
}

export interface AiFailure {
  ok: false;
  reason: string;          // plain English, safe to show as is (10.2)
  configured: boolean;     // false only for not_configured
  quota?: boolean;         // true for quota
  counted: boolean;        // did this count against today's limit? (10.2 adds the sentence when false)
  code: AiErrorCode;
}

/** Codes that count against the limit (mirrors ai_usage_counts in SQL). */
export const COUNTED_FAILURES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>(["refused", "too_long", "bad_request"]);

const READING_KINDS: ReadonlySet<AiKind> = new Set<AiKind>(["insurance_read", "bid_read", "coi_read", "document_classify"]);
const SEARCH_KINDS: ReadonlySet<AiKind> = new Set<AiKind>(["insurance_market", "contractor_search"]);
const DRAFT_KINDS: ReadonlySet<AiKind> = new Set<AiKind>(["insurance_draft", "contractor_draft"]);

function kindGroup(kind: AiKind | undefined): "reading" | "search" | "draft" | "other" {
  if (!kind) return "other";
  if (READING_KINDS.has(kind)) return "reading";
  if (SEARCH_KINDS.has(kind)) return "search";
  if (DRAFT_KINDS.has(kind)) return "draft";
  return "other";
}

const BAD_REQUEST = {
  reading: "The AI couldn't read this file. Try a clearer scan or a PDF, or enter the details by hand.",
  search: "The web search couldn't run with this request. Try a shorter description.",
  draft: "The AI couldn't write this draft. Use the template instead.",
  other: "The AI couldn't finish this. You can do this part by hand.",
} as const;

const TOO_LONG = {
  reading: "This file is too long for the AI to read in one go. Try just the pages you need, or enter the details by hand.",
  search: "The search found more than the AI could sort through. Try a narrower description.",
  draft: "The draft came out too long. Try again, or use the template instead.",
  other: "This was too long for the AI to finish. You can do this part by hand.",
} as const;

const FIXED: Record<Exclude<AiErrorCode, "quota" | "bad_request" | "too_long">, string> = {
  not_configured: "AI help isn't available on this Walkup account, so this part is by hand.",
  quota_unknown: "Walkup couldn't check today's AI allowance, so it didn't start. Try again in a minute.",
  refused: "The AI service declined this request. You can do this part by hand.",
  timeout: "This took too long and was stopped. Try again, or do this part by hand.",
  busy: "The AI service is busy right now. Try again in a few minutes.",
  unreachable: "Walkup couldn't reach the AI service. Try again shortly.",
  rejected_key: "AI help is unavailable right now. You can do this by hand.",
  unsupported_file: "The AI can't read this kind of file. Upload a PDF, JPEG or PNG, or enter the details by hand.",
  bad_output: "The answer came back in a shape Walkup couldn't use. Try again.",
  incomplete: "The search stopped before it finished. Try again.",
  unknown: "Something went wrong with the AI request. Try again, or do this part by hand.",
};

function quotaReason(kind: AiKind | undefined, scope: AiQuotaScope, limit: number | undefined): string {
  const label = kind ? AI_KIND_LABEL[kind] : "AI help";
  const n = limit ?? (kind ? AI_DAILY_LIMITS[kind] : undefined);
  switch (scope) {
    case "attempts":
      return `Walkup tried ${label} too many times today after errors, so it's paused until midnight.`;
    case "person":
      return `You've reached today's limit for ${label}. It resets at midnight.`;
    default:
      return n === undefined
        ? `Your building has used today's ${label}. It resets at midnight.`
        : `Your building has used today's ${label} (${n} a day). It resets at midnight.`;
  }
}

/**
 * Plain-English reasons (10.2). `kind` picks the kind-specific wording for
 * bad_request, too_long and quota; `quota` carries scope and limit. A bare
 * number is accepted as the building limit (repairs-spec 9.x calls it that way).
 */
export function aiFailure(
  code: AiErrorCode,
  kind?: AiKind,
  quota?: { scope: AiQuotaScope; limit: number } | number,
): AiFailure {
  let reason: string;
  if (code === "quota") {
    const q = typeof quota === "number" ? { scope: "building" as const, limit: quota } : quota;
    reason = quotaReason(kind, q?.scope ?? "building", q?.limit);
  } else if (code === "bad_request") {
    reason = BAD_REQUEST[kindGroup(kind)];
  } else if (code === "too_long") {
    reason = TOO_LONG[kindGroup(kind)];
  } else {
    reason = FIXED[code];
  }
  return {
    ok: false,
    reason,
    configured: code !== "not_configured",
    ...(code === "quota" ? { quota: true } : {}),
    counted: COUNTED_FAILURES.has(code),
    code,
  };
}

function cut(text: string): string {
  return redactTaxIds(text).text.slice(0, 500);
}

function isAbortLike(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

/**
 * Map anything thrown by the SDK (or our deadline) to a code and a short
 * detail for ai_calls.error. Order matters: timeout before connection.
 * detail = `${status ?? "-"} ${type ?? "-"} ${message}`, tax IDs redacted, at
 * most 500 characters. The SDK's messages carry the API's error text, never
 * the request content.
 */
export function classifyAiError(e: unknown, signal?: AbortSignal): { code: AiErrorCode; detail: string } {
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const type = e instanceof Anthropic.APIError ? e.type : undefined;
  const message = e instanceof Error ? e.message : String(e);
  const detail = cut(`${status ?? "-"} ${type ?? "-"} ${message}`);
  const as = (code: AiErrorCode) => ({ code, detail });

  if (
    signal?.aborted ||
    e instanceof Anthropic.APIUserAbortError ||
    e instanceof Anthropic.APIConnectionTimeoutError ||
    isAbortLike(e)
  ) {
    return as("timeout");
  }
  if (e instanceof AiNotConfiguredError) return as("not_configured");
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    // The operator alert: users only see the by-hand message.
    console.error("[walkup-ai] rejected_key", status);
    return as("rejected_key");
  }
  if (e instanceof Anthropic.RateLimitError) return as("busy");
  if (e instanceof Anthropic.InternalServerError) {
    return as(status === 529 || type === "overloaded_error" ? "busy" : "unreachable");
  }
  if (e instanceof Anthropic.APIConnectionError) return as("unreachable");
  if (e instanceof Anthropic.APIError && status === 413) return as("too_long");
  if (e instanceof Anthropic.BadRequestError) {
    return as(/prompt is too long|too large/i.test(message) ? "too_long" : "bad_request");
  }
  if (e instanceof Anthropic.AnthropicError && !(e instanceof Anthropic.APIError)) return as("bad_output");
  return as("unknown");
}

/**
 * Parse failures (JSON or zod) for ai_calls.error without echoing model output: V8's
 * JSON.parse messages quote the text, which for a native insurance read hasn't been through
 * redactTaxIds yet. Returns the error's name plus, for a ZodError, up to five issues as
 * `path:code` (no values, no messages). Example: "ZodError fields.0.value:invalid_type".
 */
export function describeParseError(e: unknown): string {
  if (e instanceof z.ZodError) {
    const issues = e.issues
      .slice(0, 5)
      .map((i) => `${i.path.map((p) => String(p)).join(".")}:${i.code}`)
      .join(" ");
    return cut(issues ? `ZodError ${issues}` : "ZodError");
  }
  const name = e instanceof Error ? e.name : typeof e;
  return cut(name || "Error");
}
