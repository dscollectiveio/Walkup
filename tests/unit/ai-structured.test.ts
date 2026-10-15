import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, anthropic: () => ({ beta: { messages: { create } } }) };
});

import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { finalText } from "@/lib/ai/internal";
import { runStructured } from "@/lib/ai/structured";
import type { AiClaim } from "@/lib/ai/usage";

const schema = z.object({ fields: z.array(z.object({ value: z.string() })) });

type Rpc = { name: string; args: Record<string, unknown> };
function fakeSupabase(claimResult: { data: unknown; error: unknown } = { data: "claim-1", error: null }) {
  const calls: Rpc[] = [];
  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_ai_call") return claimResult;
      return { data: true, error: null };
    }),
  };
  return { supabase: supabase as never, calls };
}

function reply(opts: {
  text?: string;
  stop?: string;
  content?: unknown[];
  iterations?: unknown[] | null;
  category?: string;
}) {
  return {
    id: "msg",
    model: "claude-opus-5-5",
    role: "assistant",
    type: "message",
    container: null,
    content: opts.content ?? [{ type: "text", text: opts.text ?? '{"fields":[{"value":"x"}]}', citations: null }],
    stop_reason: opts.stop ?? "end_turn",
    stop_details: opts.stop === "refusal" ? { type: "refusal", category: opts.category ?? "cyber", explanation: null } : null,
    usage: {
      input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, server_tool_use: null,
      iterations: opts.iterations ?? null,
    },
  };
}

const base = { kind: "insurance_read" as const, associationId: "assoc", system: "sys", content: "read this", schema };
const finishOf = (calls: Rpc[]) => calls.find((c) => c.name === "finish_ai_call")?.args;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.WALKUP_AI_DISABLED;
  delete process.env.WALKUP_AI_FALLBACKS;
  create.mockReset();
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("runStructured", () => {
  it("claims, calls, then finishes with tokens summed from iterations", async () => {
    create.mockResolvedValue(
      reply({
        iterations: [
          { type: "message", input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 2 },
          { type: "message", input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0 },
        ],
      }),
    );
    const { supabase, calls } = fakeSupabase();
    const r = await runStructured({ ...base, supabase });
    expect(r).toMatchObject({ ok: true, data: { fields: [{ value: "x" }] }, meta: { model: "claude-opus-5-5", fellBack: false } });
    expect(calls.map((c) => c.name)).toEqual(["claim_ai_call", "finish_ai_call"]);
    expect(finishOf(calls)).toMatchObject({ p_id: "claim-1", p_ok: true, p_input_tokens: 150, p_output_tokens: 15, p_cache_read_tokens: 2 });
  });

  it("uses a pre-claimed row without claiming again, and refuses a mismatched one", async () => {
    create.mockResolvedValue(reply({}));
    const { supabase, calls } = fakeSupabase();
    const claim: AiClaim = { id: "pre-1", kind: "insurance_read", associationId: "assoc", __brand: "AiClaim" };
    await runStructured({ ...base, supabase, claim });
    expect(calls.map((c) => c.name)).toEqual(["finish_ai_call"]);
    expect(finishOf(calls)?.p_id).toBe("pre-1");
    await expect(runStructured({ ...base, supabase, claim: { ...claim, kind: "bid_read" } })).rejects.toThrow(/mismatch/);
  });

  it("reads only text after the last fallback block and reports the fallback", async () => {
    create.mockResolvedValue(
      reply({
        content: [
          { type: "text", text: "declined partial", citations: null },
          { type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: {} },
          { type: "text", text: '{"fields":[]}', citations: null },
        ],
        iterations: [
          { type: "message", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
          { type: "fallback_message", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
        ],
      }),
    );
    const { supabase, calls } = fakeSupabase();
    const r = await runStructured({ ...base, supabase });
    expect(r).toMatchObject({ ok: true, data: { fields: [] }, meta: { fellBack: true } });
    expect(finishOf(calls)?.p_fell_back).toBe(true);
    expect(
      finalText([
        { type: "text", text: "a" },
        { type: "fallback" },
        { type: "text", text: "b" },
        { type: "text", text: "c" },
      ] as unknown as BetaContentBlock[]),
    ).toBe("bc");
  });

  it("refusal counts and records its category", async () => {
    create.mockResolvedValue(reply({ stop: "refusal", category: "cyber", text: "" }));
    const { supabase, calls } = fakeSupabase();
    const r = await runStructured({ ...base, supabase });
    expect(r).toMatchObject({ ok: false, code: "refused", counted: true });
    expect(finishOf(calls)).toMatchObject({ p_ok: false, p_error_code: "refused", p_error: "refusal:cyber" });
  });

  it("max_tokens is too_long; pause_turn is incomplete and doesn't count", async () => {
    const { supabase } = fakeSupabase();
    create.mockResolvedValueOnce(reply({ stop: "max_tokens", text: '{"fields":[' }));
    expect(await runStructured({ ...base, supabase })).toMatchObject({ ok: false, code: "too_long", counted: true });
    create.mockResolvedValueOnce(reply({ stop: "pause_turn" }));
    expect(await runStructured({ ...base, supabase })).toMatchObject({ ok: false, code: "incomplete", counted: false });
  });

  it("bad JSON or schema is bad_output, and the log never holds model text", async () => {
    const { supabase, calls } = fakeSupabase();
    create.mockResolvedValueOnce(reply({ text: '{"fields": [ 123-45-6789' }));
    expect(await runStructured({ ...base, supabase })).toMatchObject({ ok: false, code: "bad_output" });
    expect(finishOf(calls)?.p_error).toBe("SyntaxError");

    const second = fakeSupabase();
    create.mockResolvedValueOnce(reply({ text: '{"fields":[{"value":123456789}]}' }));
    expect(await runStructured({ ...base, supabase: second.supabase })).toMatchObject({ ok: false, code: "bad_output" });
    const err = String(finishOf(second.calls)?.p_error);
    expect(err).toBe("ZodError fields.0.value:invalid_type");
    expect(err).not.toContain("123");
  });

  it("not configured: no claim, no call", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { supabase, calls } = fakeSupabase();
    expect(await runStructured({ ...base, supabase })).toMatchObject({ ok: false, code: "not_configured", configured: false });
    expect(calls).toEqual([]);
    expect(create).not.toHaveBeenCalled();
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.WALKUP_AI_DISABLED = "1";
    expect(await runStructured({ ...base, supabase })).toMatchObject({ code: "not_configured" });
  });

  it("quota: no call, plain reasons per hint, fail closed otherwise", async () => {
    const quota = (hint: string, details: string) =>
      fakeSupabase({ data: null, error: { code: "P0001", hint, details, message: "limit" } }).supabase;
    const a = await runStructured({ ...base, kind: "insurance_market", supabase: quota("ai_quota", "4/4") });
    expect(a).toMatchObject({ ok: false, code: "quota", quota: true });
    expect("reason" in a && a.reason).toBe("Your building has used today's insurer and agency searches (4 a day). It resets at midnight.");
    const b = await runStructured({ ...base, supabase: quota("ai_attempts", "40/40") });
    expect("reason" in b && b.reason).toContain("too many times today");
    const c = await runStructured({ ...base, kind: "ticket_triage", supabase: quota("ai_quota_person", "10/10") });
    expect("reason" in c && c.reason).toContain("You've reached today's limit");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await runStructured({ ...base, supabase: fakeSupabase({ data: null, error: { code: "XX000" } }).supabase });
    expect(d).toMatchObject({ code: "quota_unknown" });
    spy.mockRestore();
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses unreadable native input before claiming", async () => {
    const { supabase, calls } = fakeSupabase();
    const heic = [{ type: "image", source: { type: "base64", media_type: "image/heic", data: "AAAA" } }] as never;
    expect(await runStructured({ ...base, supabase, content: heic })).toMatchObject({ code: "unsupported_file" });
    const big = [{ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.alloc(6 * 1024 * 1024).toString("base64") } }] as never;
    expect(await runStructured({ ...base, supabase, content: big })).toMatchObject({ code: "too_long" });
    expect(calls).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("maps thrown errors", async () => {
    const h = new Headers();
    const cases: [unknown, string][] = [
      [new Anthropic.RateLimitError(429, undefined, "slow", h), "busy"],
      [new Anthropic.InternalServerError(529, undefined, "overloaded", h), "busy"],
      [new Anthropic.InternalServerError(500, undefined, "boom", h), "unreachable"],
      [new Anthropic.APIConnectionError({ message: "down" }), "unreachable"],
      [new Anthropic.APIError(413, undefined, "too big", h), "too_long"],
    ];
    for (const [err, code] of cases) {
      create.mockRejectedValueOnce(err);
      const { supabase, calls } = fakeSupabase();
      expect(await runStructured({ ...base, supabase })).toMatchObject({ ok: false, code });
      expect(finishOf(calls)).toMatchObject({ p_ok: false, p_error_code: code });
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, undefined, "bad key", h));
    expect(await runStructured({ ...base, supabase: fakeSupabase().supabase })).toMatchObject({ code: "rejected_key" });
    expect(spy).toHaveBeenCalledWith("[walkup-ai] rejected_key", 401);
    spy.mockRestore();
  });

  it("a passed deadline is a timeout", async () => {
    create.mockImplementationOnce(
      (_params: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => reject(new Anthropic.APIUserAbortError()));
        }),
    );
    const { supabase, calls } = fakeSupabase();
    expect(await runStructured({ ...base, supabase, timeoutMs: 20 })).toMatchObject({ code: "timeout", counted: false });
    expect(finishOf(calls)?.p_error_code).toBe("timeout");
  });

  it("sends the model, betas, fallback, adaptive thinking and effort", async () => {
    create.mockResolvedValue(reply({}));
    await runStructured({ ...base, supabase: fakeSupabase().supabase, effort: "high", maxTokens: 50_000 });
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01", "structured-outputs-2025-12-15"]);
    expect(params.fallbacks).toBe("default");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config.effort).toBe("high");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(typeof params.output_config.format.parse).toBe("undefined");
    expect(params.max_tokens).toBe(20_000);
    expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 1, timeout: 120_000 });

    process.env.WALKUP_AI_FALLBACKS = "off";
    await runStructured({ ...base, supabase: fakeSupabase().supabase });
    const off = create.mock.calls[1][0];
    expect(off.fallbacks).toBeUndefined();
    expect(off.betas).toEqual(["structured-outputs-2025-12-15"]);
    expect(off.output_config.effort).toBe("medium");
  });
});
