import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { COUNTED_FAILURES } from "@/lib/ai/errors";
import { remainingLine } from "@/lib/ai/kinds";
import {
  AI_DAILY_LIMITS,
  AI_KIND_LABEL,
  AI_KINDS,
  AI_PERSON_TRIAGE_LIMIT,
  aiUsageToday,
  assertAiQuota,
  claimAiCall,
  logAiCall,
  usageFromMessages,
} from "@/lib/ai/usage";

const SQL = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0051_ai_and_uploads.sql"), "utf8");

function message(over: Partial<BetaMessage["usage"]> & { model?: string; fallbackBlock?: boolean } = {}): BetaMessage {
  const { model, fallbackBlock, ...usage } = over;
  return {
    model: model ?? "claude-opus-5-5",
    content: fallbackBlock ? [{ type: "fallback" }] : [],
    usage: {
      input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, iterations: null, server_tool_use: null,
      ...usage,
    },
  } as unknown as BetaMessage;
}

describe("usageFromMessages", () => {
  it("sums top-level usage across messages and picks the last model", () => {
    const u = usageFromMessages([
      message({ server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } }),
      message({ model: "claude-opus-4-8", server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }),
    ]);
    expect(u).toEqual({ model: "claude-opus-4-8", input_tokens: 20, output_tokens: 10, cache_read_tokens: 2, web_searches: 3, fell_back: false });
  });
  it("sums iterations when present and marks a fallback", () => {
    const u = usageFromMessages([
      message({
        iterations: [
          { type: "message", input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 3 },
          { type: "fallback_message", input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 0 },
        ] as never,
      }),
    ]);
    expect(u.input_tokens).toBe(150);
    expect(u.output_tokens).toBe(27);
    expect(u.cache_read_tokens).toBe(3);
    expect(u.fell_back).toBe(true);
  });
  it("marks a fallback content block too, and defaults the model", () => {
    expect(usageFromMessages([message({ fallbackBlock: true })]).fell_back).toBe(true);
    expect(usageFromMessages([]).model).toBe("claude-opus-5-5");
  });
});

describe("limits mirror the SQL", () => {
  it("covers every kind with a limit and a label", () => {
    for (const k of AI_KINDS) {
      expect(AI_DAILY_LIMITS[k]).toBeGreaterThan(0);
      expect(AI_KIND_LABEL[k].length).toBeGreaterThan(3);
    }
    expect(Object.keys(AI_DAILY_LIMITS).sort()).toEqual([...AI_KINDS].sort());
    expect(Object.keys(AI_KIND_LABEL).sort()).toEqual([...AI_KINDS].sort());
  });
  it("kinds equal the ai_calls.kind check", () => {
    const check = /kind\s+text not null check \(kind in \(([\s\S]*?)\)\)/.exec(SQL);
    expect(check).not.toBeNull();
    const kinds = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(kinds.sort()).toEqual([...AI_KINDS].sort());
  });
  it("limits equal ai_daily_limit() case arms", () => {
    const fn = /function public\.ai_daily_limit\(p_kind text\)[\s\S]*?end \$\$;/.exec(SQL)![0];
    const arms = Object.fromEntries([...fn.matchAll(/when '([a-z_]+)'\s+then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(arms).toEqual(AI_DAILY_LIMITS);
  });
  it("the person triage cap equals ai_person_triage_limit()", () => {
    const m = /function public\.ai_person_triage_limit\(\)[\s\S]*?select (\d+)/.exec(SQL);
    expect(Number(m![1])).toBe(AI_PERSON_TRIAGE_LIMIT);
  });
  it("counted failures equal the codes in ai_usage_counts", () => {
    const fn = /function public\.ai_usage_counts[\s\S]*?\$\$;/.exec(SQL)![0];
    const codes = /error_code in \(([^)]*)\)/.exec(fn)![1].match(/[a-z_]+/g)!;
    expect([...COUNTED_FAILURES].sort()).toEqual(codes.sort());
  });
  it("remaining line for scarce kinds only", () => {
    expect(remainingLine("contractor_search", 3)).toBe("3 web searches left today");
    expect(remainingLine("insurance_market", 1)).toBe("1 web search left today");
    expect(remainingLine("insurance_market", 0)).toBe("No web searches left today. They reset at midnight.");
    expect(remainingLine("ticket_triage", 3)).toBeNull();
  });
});

function fakeRpc(handler: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return handler(name, args);
    }),
  };
  return { supabase: supabase as never, calls };
}

describe("claimAiCall", () => {
  it("returns a claim for the row id", async () => {
    const { supabase, calls } = fakeRpc(() => ({ data: "row-1", error: null }));
    const r = await claimAiCall(supabase, "assoc", "contractor_search");
    expect(r).toEqual({ ok: true, claim: { id: "row-1", kind: "contractor_search", associationId: "assoc", __brand: "AiClaim" } });
    expect(calls).toEqual([{ name: "claim_ai_call", args: { p_association_id: "assoc", p_kind: "contractor_search" } }]);
  });
  it("maps the quota hints", async () => {
    const quota = (hint: string, details: string) => fakeRpc(() => ({ data: null, error: { code: "P0001", hint, details, message: "x" } })).supabase;
    const a = await claimAiCall(quota("ai_quota", "6/6"), "assoc", "insurance_market");
    expect(a).toMatchObject({ ok: false, code: "quota", quota: true, counted: false });
    expect("reason" in a && a.reason).toContain("(6 a day)");
    const b = await claimAiCall(quota("ai_attempts", "24/24"), "assoc", "contractor_search");
    expect("reason" in b && b.reason).toContain("too many times today");
    const c = await claimAiCall(quota("ai_quota_person", "10/10"), "assoc", "ticket_triage");
    expect("reason" in c && c.reason).toContain("You've reached today's limit for problem triage");
  });
  it("fails closed on anything else", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const denied = await claimAiCall(fakeRpc(() => ({ data: null, error: { code: "42501" } })).supabase, "a", "bid_read");
    expect(denied).toMatchObject({ ok: false, code: "quota_unknown", reason: "You can't use this AI feature." });
    const other = await claimAiCall(fakeRpc(() => ({ data: null, error: { code: "XX000" } })).supabase, "a", "bid_read");
    expect(other).toMatchObject({ ok: false, code: "quota_unknown" });
    spy.mockRestore();
  });
});

describe("logAiCall", () => {
  const claim = { id: "row-1", kind: "bid_read" as const, associationId: "assoc", __brand: "AiClaim" as const };
  it("finishes a claim or writes a followup", async () => {
    const { supabase, calls } = fakeRpc(() => ({ data: true, error: null }));
    await logAiCall(supabase, "assoc", "bid_read", { claim, model: "m", input_tokens: 1.4, output_tokens: 2, ok: true, duration_ms: 12.7 });
    await logAiCall(supabase, "assoc", "bid_read", { parent: claim, model: "m", input_tokens: 1, output_tokens: 2, ok: false, error_code: "bad_output" });
    expect(calls[0]).toMatchObject({ name: "finish_ai_call", args: { p_id: "row-1", p_ok: true, p_input_tokens: 1, p_duration_ms: 13 } });
    expect(calls[1]).toMatchObject({ name: "record_ai_call", args: { p_parent_id: "row-1", p_ok: false, p_error_code: "bad_output" } });
  });
  it("refuses a claim from another association", async () => {
    const { supabase } = fakeRpc(() => ({ data: true, error: null }));
    await expect(logAiCall(supabase, "other", "bid_read", { claim, model: "m", input_tokens: 0, output_tokens: 0, ok: true })).rejects.toThrow();
  });
});

describe("assertAiQuota / aiUsageToday", () => {
  it("throws AiQuotaError at the limit", async () => {
    await expect(assertAiQuota(fakeRpc(() => ({ data: 11, error: null })).supabase, "a", "contractor_search")).resolves.toBeUndefined();
    await expect(assertAiQuota(fakeRpc(() => ({ data: 12, error: null })).supabase, "a", "contractor_search")).rejects.toMatchObject({
      name: "AiQuotaError", scope: "building", limit: 12, used: 12,
    });
    await expect(assertAiQuota(fakeRpc(() => ({ data: null, error: { code: "x" } })).supabase, "a", "contractor_search")).rejects.toThrow(
      "couldn't read",
    );
  });
  it("returns every kind for the board, null otherwise", async () => {
    const rows = [{ kind: "contractor_search", used: 3, attempts: 4, daily_limit: 12 }];
    const usage = await aiUsageToday(fakeRpc(() => ({ data: rows, error: null })).supabase, "a");
    expect(usage?.contractor_search).toEqual({ used: 3, attempts: 4, limit: 12 });
    expect(usage?.bid_read).toEqual({ used: 0, attempts: 0, limit: 25 });
    expect(await aiUsageToday(fakeRpc(() => ({ data: null, error: { code: "42501" } })).supabase, "a")).toBeNull();
  });
});
