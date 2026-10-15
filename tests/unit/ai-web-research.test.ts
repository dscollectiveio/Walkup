import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const create = vi.fn();
vi.mock("@/lib/ai/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/client")>();
  return { ...actual, anthropic: () => ({ beta: { messages: { create } } }) };
});

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { appearsInCitations, verifyWebsite, webResearch, type VerifyContext } from "@/lib/ai/web-research";

const itemSchema = z.object({
  name: z.string(),
  website: z.string().nullable(),
  phone: z.string().nullable(),
  sourceUrls: z.array(z.string()),
});
type Item = z.infer<typeof itemSchema>;

type Rpc = { name: string; args: Record<string, unknown> };
function fakeSupabase() {
  const calls: Rpc[] = [];
  const supabase = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "claim_ai_call") return { data: "claim-1", error: null };
      if (name === "record_ai_call") return { data: "follow-1", error: null };
      return { data: true, error: null };
    }),
  };
  return { supabase: supabase as never, calls };
}

const RESULTS = {
  type: "web_search_tool_result",
  tool_use_id: "srv_1",
  content: [
    { type: "web_search_result", url: "https://www.acmeplumbing.com/", title: "Acme Plumbing | Chicago", page_age: null, encrypted_content: "e" },
    { type: "web_search_result", url: "https://www.yelp.com/search?find=plumbers", title: "Plumbers - Yelp", page_age: null, encrypted_content: "e" },
  ],
};
const CITED = {
  type: "text",
  text: "Acme Plumbing can be reached at 312-555-0100.",
  citations: [
    {
      type: "web_search_result_location", url: "https://www.acmeplumbing.com/", title: "Acme Plumbing",
      cited_text: "Acme Plumbing, call 312-555-0100", encrypted_index: "i",
    },
  ],
};
const SERVER_USE = { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "plumbers" } };

function research(content: unknown[], stop = "end_turn", container: string | null = null, searches = 1) {
  return {
    id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5",
    container: container ? { id: container, expires_at: "x" } : null,
    content, stop_reason: stop, stop_details: null,
    usage: {
      input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, iterations: null,
      server_tool_use: { web_search_requests: searches, web_fetch_requests: 0 },
    },
  };
}
function structured(items: Item[]) {
  return research([{ type: "text", text: JSON.stringify({ items }), citations: null }], "end_turn", null, 0);
}

const acme: Item = { name: "Acme Plumbing", website: "https://acmeplumbing.com/", phone: "(312) 555-0100", sourceUrls: ["https://acmeplumbing.com"] };
const invented: Item = { name: "Zeta Plumbing", website: null, phone: null, sourceUrls: ["https://www.yelp.com/search?find=plumbers"] };
const fabricated: Item = { name: "Ghost Plumbing", website: null, phone: null, sourceUrls: ["https://ghost.example.com/"] };

const verify = (c: Item, ctx: VerifyContext): Item => ({
  ...c,
  website: c.website ? verifyWebsite(c.website, ctx) : null,
  phone: c.phone && appearsInCitations(c.phone, ctx.citations, "phone") ? c.phone : null,
});

function opts(supabase: never, over: Record<string, unknown> = {}) {
  return {
    kind: "contractor_search" as const,
    supabase,
    associationId: "assoc",
    task: "Plumber for a 6-unit building. Owner Ada Okonkwo, ada@example.com, at 2158 N. Damen Ave.",
    redact: { names: ["Ada Okonkwo", "Okonkwo"], addresses: ["2158 N. Damen Ave"], keep: ["Chicago"] },
    itemSchema,
    nameOf: (i: Item) => i.name,
    verify,
    userLocation: { city: "Chicago", region: "IL", postal_code: "60622" },
    ...over,
  };
}

const isResearch = (params: { tools?: unknown[] }) => Array.isArray(params.tools);

let clock = 0;
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  create.mockReset();
  clock = Date.parse("2026-10-14T15:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  vi.restoreAllMocks();
});

describe("webResearch", () => {
  it("continues after pause_turn by re-sending the turn, with the container", async () => {
    const snapshots: unknown[][] = [];
    create.mockImplementation(async (params: { messages: unknown[]; tools?: unknown[] }) => {
      if (!isResearch(params)) return structured([acme]);
      snapshots.push(structuredClone(params.messages));
      const turn = snapshots.length;
      if (turn === 1) return research([SERVER_USE, RESULTS], "pause_turn", "ctr_1");
      if (turn === 2) return research([SERVER_USE], "pause_turn", null);
      return research([CITED]);
    });
    const { supabase } = fakeSupabase();
    const r = await webResearch(opts(supabase));
    expect(r.ok).toBe(true);
    const researchCalls = create.mock.calls.filter(([p]) => isResearch(p));
    expect(researchCalls).toHaveLength(3);
    expect(snapshots[1]).toHaveLength(2);
    expect(snapshots[2]).toHaveLength(3);
    expect((snapshots[1][0] as { role: string }).role).toBe("user");
    expect((snapshots[1][1] as { role: string }).role).toBe("assistant");
    expect((snapshots[2][2] as { role: string }).role).toBe("assistant");
    expect(researchCalls[0][0].container).toBeUndefined();
    expect(researchCalls[1][0].container).toBe("ctr_1");
    expect(researchCalls[2][0].container).toBe("ctr_1");
  });

  it("refuses to search, and claims nothing, when the names to remove could not be loaded (REVIEW-2 #11)", async () => {
    const { supabase, calls } = fakeSupabase();
    const r = await webResearch({ ...opts(supabase), redact: { names: [], addresses: [], unavailable: true } });
    expect(r.ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(calls.some((c) => c.name === "claim_ai_call")).toBe(false);
  });

  it("past the continuation cap: partial with results, incomplete without", async () => {
    create.mockImplementation(async (params: { tools?: unknown[] }) =>
      isResearch(params) ? research([SERVER_USE, RESULTS, CITED], "pause_turn") : structured([acme]),
    );
    const a = await webResearch(opts(fakeSupabase().supabase));
    expect(a.ok && a.result.partial).toBe(true);
    expect(create.mock.calls.filter(([p]) => isResearch(p))).toHaveLength(4);

    create.mockReset();
    create.mockImplementation(async () => research([SERVER_USE], "pause_turn"));
    const { supabase, calls } = fakeSupabase();
    const b = await webResearch(opts(supabase));
    expect(b).toMatchObject({ ok: false, code: "incomplete" });
    expect(calls.find((c) => c.name === "finish_ai_call")?.args).toMatchObject({ p_ok: false, p_error_code: "incomplete" });
  });

  it("stops starting turns near the deadline: partial with results, timeout without", async () => {
    create.mockImplementation(async (params: { tools?: unknown[] }) => {
      if (!isResearch(params)) return structured([acme]);
      clock += 170_000; // 240 s budget - 170 s - 60 s reserve leaves 10 s: no new turn
      return research([SERVER_USE, RESULTS, CITED], "pause_turn");
    });
    const a = await webResearch(opts(fakeSupabase().supabase));
    expect(a.ok && a.result.partial).toBe(true);
    expect(a.ok && a.result.items).toHaveLength(1);
    expect(create.mock.calls.filter(([p]) => isResearch(p))).toHaveLength(1);

    create.mockReset();
    create.mockImplementation(async () => {
      clock += 170_000;
      return research([SERVER_USE], "pause_turn");
    });
    const { supabase, calls } = fakeSupabase();
    expect(await webResearch(opts(supabase))).toMatchObject({ ok: false, code: "timeout" });
    expect(calls.find((c) => c.name === "finish_ai_call")?.args).toMatchObject({ p_ok: false, p_error_code: "timeout" });
  });

  it("a timeout thrown mid-research keeps what was gathered", async () => {
    let n = 0;
    create.mockImplementation(async (params: { tools?: unknown[] }) => {
      if (!isResearch(params)) return structured([acme]);
      n += 1;
      if (n === 1) return research([SERVER_USE, RESULTS, CITED], "pause_turn");
      throw new Anthropic.APIConnectionTimeoutError();
    });
    const r = await webResearch(opts(fakeSupabase().supabase));
    expect(r.ok && r.result.partial).toBe(true);
  });

  it("zero search results: no items and no structuring call", async () => {
    create.mockResolvedValue(research([{ type: "text", text: "Nothing useful found.", citations: null }]));
    const r = await webResearch(opts(fakeSupabase().supabase));
    expect(r).toMatchObject({ ok: true, result: { items: [], sources: [], checkedPages: 0, partial: false } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("meters one claim, one finish and one followup under the claim", async () => {
    create.mockImplementation(async (params: { tools?: unknown[] }) =>
      isResearch(params) ? research([SERVER_USE, RESULTS, CITED], "end_turn", null, 2) : structured([acme]),
    );
    const { supabase, calls } = fakeSupabase();
    await webResearch(opts(supabase));
    expect(calls.map((c) => c.name)).toEqual(["claim_ai_call", "finish_ai_call", "record_ai_call"]);
    expect(calls[1].args).toMatchObject({ p_id: "claim-1", p_ok: true, p_web_searches: 2 });
    expect(calls[2].args).toMatchObject({ p_parent_id: "claim-1", p_ok: true });
  });

  it("keeps only verified items, and lists only their sources", async () => {
    create.mockImplementation(async (params: { tools?: unknown[] }) =>
      isResearch(params) ? research([SERVER_USE, RESULTS, CITED]) : structured([acme, invented, fabricated]),
    );
    const r = await webResearch(opts(fakeSupabase().supabase));
    if (!r.ok) throw new Error(r.reason);
    expect(r.result.items.map((i) => i.name)).toEqual(["Acme Plumbing"]);
    expect(r.result.items[0]).toMatchObject({
      website: "https://www.acmeplumbing.com/",
      phone: "(312) 555-0100",
      sourceUrls: ["https://www.acmeplumbing.com/"],
    });
    expect(r.result.items[0].evidence[0].quote).toBe("Acme Plumbing, call 312-555-0100");
    expect(r.result.sources).toEqual([{ url: "https://www.acmeplumbing.com/", title: "Acme Plumbing | Chicago" }]);
    expect(r.result.checkedPages).toBe(2);
  });

  it("sends web_search_20260209 with clamped max_uses, no postal field, and the ZIP in the message", async () => {
    create.mockResolvedValue(research([{ type: "text", text: "Nothing.", citations: null }]));
    await webResearch(opts(fakeSupabase().supabase, { maxSearches: 50 }));
    const params = create.mock.calls[0][0];
    expect(params.tools).toEqual([
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 10,
        user_location: { type: "approximate", city: "Chicago", region: "IL", country: "US", timezone: "America/Chicago" },
      },
    ]);
    expect(JSON.stringify(params.tools)).not.toContain("postal");
    expect(params.messages[0].content).toContain("ZIP code: 60622");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "medium" });
  });

  it("scrubs the task before it leaves", async () => {
    create.mockResolvedValue(research([{ type: "text", text: "Nothing.", citations: null }]));
    await webResearch(opts(fakeSupabase().supabase));
    const body = JSON.stringify(create.mock.calls[0][0]);
    expect(body).not.toContain("ada@example.com");
    expect(body).not.toContain("Okonkwo");
    expect(body).not.toContain("Damen");
    expect(body).toContain("6-unit building");
  });

  it("returns refusals and quota failures as is", async () => {
    create.mockResolvedValue({ ...research([], "refusal"), stop_details: { type: "refusal", category: "general_harms", explanation: null } });
    const { supabase, calls } = fakeSupabase();
    expect(await webResearch(opts(supabase))).toMatchObject({ ok: false, code: "refused", counted: true });
    expect(calls.find((c) => c.name === "finish_ai_call")?.args).toMatchObject({ p_error: "refusal:general_harms" });

    const quota = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "P0001", hint: "ai_quota", details: "12/12" } })),
    } as never;
    create.mockReset();
    expect(await webResearch(opts(quota))).toMatchObject({ ok: false, code: "quota", quota: true });
    expect(create).not.toHaveBeenCalled();
  });
});
