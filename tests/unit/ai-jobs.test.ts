import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AI_JOB_SECONDS, AI_STALE_AFTER_SECONDS, aiRunStatus, claimAiRun, finishAiRun } from "@/lib/ai/jobs";
import { STALE_AFTER_SECONDS } from "@/components/ai/poll-state";

const start = "2026-10-14T12:00:00.000Z";
const at = (s: number) => new Date(new Date(start).getTime() + s * 1000);

describe("aiRunStatus", () => {
  it("passes through non-running states", () => {
    expect(aiRunStatus("idle", null)).toBe("idle");
    expect(aiRunStatus("done", start)).toBe("done");
    expect(aiRunStatus("failed", start)).toBe("failed");
  });
  it("is running at 329 s and stalled at 331 s", () => {
    expect(aiRunStatus("running", start, at(329))).toBe("running");
    expect(aiRunStatus("running", start, at(331))).toBe("stalled");
  });
  it("treats a running row without a start time as stalled", () => {
    expect(aiRunStatus("running", null, at(0))).toBe("stalled");
  });
  it("keeps the constants in step with the client copy", () => {
    expect(AI_JOB_SECONDS).toBe(300);
    expect(AI_STALE_AFTER_SECONDS).toBe(330);
    expect(STALE_AFTER_SECONDS).toBe(AI_STALE_AFTER_SECONDS);
  });
});

/** A supabase-js query chain stand-in: every builder method records its call; awaiting gives `result`. */
function fakeTable(result: { data: unknown; error: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  for (const method of ["from", "update", "eq", "or", "select"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  return { supabase: chain as never, calls };
}

describe("claimAiRun / finishAiRun", () => {
  it("claims only a row that isn't already running (or is stale)", async () => {
    const { supabase, calls } = fakeTable({ data: [{ id: "r1" }], error: null });
    expect(await claimAiRun(supabase, "contractor_search_cache", "r1")).toBe(true);
    expect(calls[0]).toEqual({ method: "from", args: ["contractor_search_cache"] });
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    expect(update).toMatchObject({ ai_state: "running", ai_finished_at: null, ai_error: null });
    const or = calls.find((c) => c.method === "or")!.args[0] as string;
    expect(or).toMatch(/^ai_state\.neq\.running,ai_started_at\.lt\.\d{4}-/);
  });
  it("returns false when nothing was updated or on error", async () => {
    expect(await claimAiRun(fakeTable({ data: [], error: null }).supabase, "t", "r1")).toBe(false);
    expect(await claimAiRun(fakeTable({ data: null, error: { code: "42501" } }).supabase, "t", "r1")).toBe(false);
  });
  it("writes the finished state and never throws", async () => {
    const { supabase, calls } = fakeTable({ data: null, error: null });
    await finishAiRun(supabase, "t", "r1", { ok: false, reason: "x".repeat(600) });
    const update = calls.find((c) => c.method === "update")!.args[0] as Record<string, unknown>;
    expect(update.ai_state).toBe("failed");
    expect((update.ai_error as string).length).toBe(500);
    const broken = { from: () => { throw new Error("boom"); } } as never;
    await expect(finishAiRun(broken, "t", "r1", { ok: true })).resolves.toBeUndefined();
  });
});
