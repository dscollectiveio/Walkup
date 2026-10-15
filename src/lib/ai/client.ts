import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBeta } from "@anthropic-ai/sdk/resources/beta/beta";

/**
 * The one Anthropic client factory for new code (brief decision 11).
 *
 * Every request goes through `client.beta.messages.create` because the
 * server-side refusal fallback (`fallbacks: "default"`) exists only on the
 * beta Messages params in SDK 0.115.0. Nothing outside src/lib/ai builds a
 * client (tests/unit/ai-sdk-import-guard.test.ts).
 */

export const AI_MODEL = "claude-opus-5-5";
/** Server-side refusal fallback, "default" form (brief decision 11). */
export const AI_FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** What the SDK's own beta.messages.parse() sends alongside output_config.format. */
export const AI_STRUCTURED_BETA = "structured-outputs-2025-12-15";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set, or WALKUP_AI_DISABLED=1.");
    this.name = "AiNotConfiguredError";
  }
}

/** True when a key is present and AI isn't switched off for this deployment. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim()) && process.env.WALKUP_AI_DISABLED !== "1";
}

/** Operational lever: WALKUP_AI_FALLBACKS=off drops the fallback param and its header. */
export function fallbacksEnabled(): boolean {
  return process.env.WALKUP_AI_FALLBACKS !== "off";
}

/**
 * True when GOOGLE_PLACES_KEY is set. Mirrors googleKey() in src/lib/google/places.ts
 * (Repairs-owned) without importing it, so shared UI can say "ratings come from web pages
 * only" (10.4) without depending on the Repairs module.
 */
export function placesConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PLACES_KEY?.trim());
}

let cached: Anthropic | null = null;

/** One client per server instance. Throws AiNotConfiguredError when not configured. */
export function anthropic(): Anthropic {
  if (!aiConfigured()) throw new AiNotConfiguredError();
  cached ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY!.trim(),
    maxRetries: 1, // a retry doubles wall-clock; budgets in section 5 assume at most one
    timeout: 120_000,
  });
  return cached;
}

/** The fields every call sends. Spread into beta.messages.create params. */
export function baseParams(opts: { structured: boolean }) {
  const betas: AnthropicBeta[] = [
    ...(fallbacksEnabled() ? [AI_FALLBACK_BETA] : []),
    ...(opts.structured ? [AI_STRUCTURED_BETA] : []),
  ];
  return {
    model: AI_MODEL,
    ...(betas.length ? { betas } : {}),
    ...(fallbacksEnabled() ? { fallbacks: "default" as const } : {}),
    // Explicit: a fallback model (Opus 4.8) would otherwise run without thinking.
    thinking: { type: "adaptive" as const },
  };
}
