import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const claimAiCall = vi.fn();
const finishAiCall = vi.fn();
vi.mock("@/lib/ai/usage", () => ({
  claimAiCall: (...a: unknown[]) => claimAiCall(...a),
  finishAiCall: (...a: unknown[]) => finishAiCall(...a),
}));
const webResearch = vi.fn();
vi.mock("@/lib/ai/web-research", () => ({
  webResearch: (...a: unknown[]) => webResearch(...a),
  loadRedactionTerms: async () => ({ names: ["Doug Smart"], addresses: ["2158 N Damen Ave"], keep: ["Chicago", "IL", "Illinois"] }),
}));

const { association, queries } = vi.hoisted(() => {
  const association = {
    id: "assoc-1", legal_name: "2158 N. Damen Condominium Association", display_name: "Damen", state_code: "IL",
    street_address: "2158 N Damen Ave", city: "Chicago" as string | null, postal_code: "60647", year_built: 1905,
    construction_type: "joisted_masonry", stories: 3, roof_replaced_year: 2019,
  };
  const queries = {
    currentAssociation: vi.fn(async () => association as typeof association | null),
    isBoard: vi.fn(async () => true),
    isBoardAdmin: vi.fn(async () => true),
    adminNames: vi.fn(async () => "Doug Smart"),
    unitCount: vi.fn(async () => 3),
  };
  return { association, queries };
});
vi.mock("@/lib/insurance/queries", () => ({
  ...queries,
  addressMissingCopy: (admin: boolean, names: string) => (admin ? "ADMIN COPY" : `Only ${names} can add`),
  loadCheckInput: async () => ({
    todayIso: "2026-10-14", stateCode: "IL", unitCount: 3, facts: null, policies: [], fundsTotal: null, history: [],
    legalName: null, quotesThisTerm: {}, dismissals: [],
  }),
}));

import { aiFailure } from "@/lib/ai/errors";
import { MARKET_COPY, finishMarketResearch, runMarketResearch, type MarketJob } from "@/lib/insurance/market";
import { queryKey } from "@/lib/insurance/market-verify";

type Op = { op: "select" | "insert" | "update"; patch?: Record<string, unknown>; filters: string[] };

function fakeSupabase(opts: { row?: Record<string, unknown> | null; insertError?: { code: string } | null; claimRows?: unknown[] }) {
  const ops: Op[] = [];
  const supabase = {
    from: () => {
      const op: Op = { op: "select", filters: [] };
      const b = {
        select: () => b,
        insert: async (p: Record<string, unknown>) => {
          ops.push({ op: "insert", patch: p, filters: [] });
          return { error: opts.insertError ?? null };
        },
        update: (p: Record<string, unknown>) => {
          op.op = "update";
          op.patch = p;
          ops.push(op);
          return b;
        },
        eq: (c: string, v: unknown) => {
          op.filters.push(`${c}=${String(v)}`);
          return b;
        },
        or: (f: string) => {
          op.filters.push(`or:${f}`);
          return { select: async () => ({ data: opts.claimRows ?? [{ id: "row-1" }], error: null }) };
        },
        maybeSingle: async () => ({ data: opts.row ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return b;
    },
  };
  return { supabase: supabase as never, ops };
}

const claim = { id: "claim-1", kind: "insurance_market", associationId: "assoc-1", __brand: "AiClaim" };

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  claimAiCall.mockReset();
  claimAiCall.mockResolvedValue({ ok: true, claim });
  finishAiCall.mockReset();
  webResearch.mockReset();
  queries.currentAssociation.mockResolvedValue(association);
  queries.isBoard.mockResolvedValue(true);
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe("runMarketResearch (steps 1 to 4)", () => {
  it("not configured: says so before claiming anything", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { supabase, ops } = fakeSupabase({});
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ error: MARKET_COPY.notConfigured, configured: false });
    expect(claimAiCall).not.toHaveBeenCalled();
    expect(ops).toHaveLength(0);
  });

  it("refuses anyone off the board", async () => {
    queries.isBoard.mockResolvedValue(false);
    const { supabase } = fakeSupabase({});
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ error: MARKET_COPY.boardOnly });
  });

  it("no city or state: the address copy, no search", async () => {
    queries.currentAssociation.mockResolvedValue({ ...association, city: null });
    const { supabase } = fakeSupabase({});
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ error: "ADMIN COPY" });
    expect(claimAiCall).not.toHaveBeenCalled();
  });

  it("a fresh cache row with the same inputs is served without searching", async () => {
    const { marketInputs } = await import("@/lib/insurance/market-verify");
    const key = queryKey("agencies", marketInputs(association, 3, [])!);
    const fetched = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const { supabase } = fakeSupabase({ row: { id: "row-1", query_key: key, fetched_at: fetched, expires_at: new Date(Date.now() + 86_400_000).toISOString(), ai_state: "done", ai_started_at: null } });
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ ok: true, state: "cached" });
    expect(claimAiCall).not.toHaveBeenCalled();
  });

  it("search again within a day shows the same results with a notice", async () => {
    const { marketInputs } = await import("@/lib/insurance/market-verify");
    const key = queryKey("agencies", marketInputs(association, 3, [])!);
    const { supabase } = fakeSupabase({ row: { id: "row-1", query_key: key, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString(), ai_state: "done", ai_started_at: null } });
    expect(await runMarketResearch(supabase, "agencies", { force: true })).toEqual({ ok: true, state: "cached", notice: MARKET_COPY.recent });
  });

  it("a search already running is not started twice", async () => {
    const { supabase } = fakeSupabase({ row: { id: "row-1", query_key: null, fetched_at: null, expires_at: null, ai_state: "running", ai_started_at: new Date().toISOString() } });
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ ok: true, state: "running" });
    expect(claimAiCall).not.toHaveBeenCalled();
  });

  it("quota: the claim's reason comes back at once", async () => {
    claimAiCall.mockResolvedValue(aiFailure("quota", "insurance_market", 6));
    const { supabase } = fakeSupabase({});
    const r = await runMarketResearch(supabase, "agencies");
    expect(r).toMatchObject({ quota: true });
    expect("error" in r && r.error).toContain("insurer and agency searches");
  });

  it("first search: inserts the row as running, with only the decision 4 inputs", async () => {
    const { supabase, ops } = fakeSupabase({});
    const r = await runMarketResearch(supabase, "agencies");
    expect(r).toMatchObject({ ok: true, state: "started" });
    const insert = ops.find((o) => o.op === "insert")!;
    expect(insert.patch).toMatchObject({ association_id: "assoc-1", kind: "agencies", ai_state: "running" });
    const inputs = insert.patch!.pending_inputs as Record<string, unknown>;
    expect(Object.keys(inputs).sort()).toEqual(["city", "construction", "coverages", "postal_code", "state", "stateName", "stories", "units", "year_built"]);
    expect(JSON.stringify(inputs)).not.toMatch(/Damen|Doug/);
  });

  it("a lost race for the row gives the quota claim back as not_started", async () => {
    const { supabase } = fakeSupabase({ row: { id: "row-1", query_key: null, fetched_at: null, expires_at: null, ai_state: "failed", ai_started_at: null }, claimRows: [] });
    expect(await runMarketResearch(supabase, "agencies")).toEqual({ ok: true, state: "running" });
    expect(finishAiCall).toHaveBeenCalledWith(supabase, claim, expect.objectContaining({ ok: false, error_code: "not_started" }));
  });
});

describe("finishMarketResearch (steps 5 to 7)", () => {
  const job: MarketJob = {
    kind: "agencies", associationId: "assoc-1", stateCode: "IL", key: "agencies:abc", claim: claim as never, startedAt: "2026-10-14T15:00:00.000Z",
    inputs: { city: "Chicago", state: "IL", stateName: "Illinois", postal_code: "60647", units: 3, stories: 3, year_built: 1905, construction: null, coverages: ["Master policy (building and property)"] },
  };

  it("stores verified items sorted by name, without out-of-state agencies, guarded by the run's start", async () => {
    webResearch.mockResolvedValue({
      ok: true,
      meta: {},
      result: {
        fetchedAt: "x", partial: false, checkedPages: 4,
        sources: [{ url: "https://zeta.example", title: null }],
        items: [
          { key: "host:zeta.example", name: "Zeta Agency", state: "IL", sourceUrls: [] },
          { key: "host:acme.example", name: "Acme Agency", state: "IL", sourceUrls: [] },
          { key: "host:far.example", name: "Far Agency", state: "WI", sourceUrls: [] },
        ],
      },
    });
    const { supabase, ops } = fakeSupabase({});
    await finishMarketResearch(supabase, job);
    const call = webResearch.mock.calls[0][0];
    expect(call).toMatchObject({ kind: "insurance_market", claim, maxSearches: 5, timeoutMs: 240_000, userLocation: { city: "Chicago", region: "Illinois", country: "US" } });
    expect(call.userLocation).not.toHaveProperty("postal_code");
    expect(call.task).toContain("near Chicago, IL 60647");
    const write = ops.find((o) => o.op === "update")!;
    expect((write.patch!.items as { name: string }[]).map((i) => i.name)).toEqual(["Acme Agency", "Zeta Agency"]);
    expect(write.patch).toMatchObject({ ai_state: "done", query_key: "agencies:abc", pending_key: null });
    expect(write.filters).toContain("ai_started_at=2026-10-14T15:00:00.000Z");
  });

  it("a failure records its code and leaves the previous items alone", async () => {
    webResearch.mockResolvedValue(aiFailure("quota", "insurance_market", 6));
    const { supabase, ops } = fakeSupabase({});
    await finishMarketResearch(supabase, job);
    const write = ops.find((o) => o.op === "update")!;
    expect(write.patch).toMatchObject({ ai_state: "failed", ai_error: "quota" });
    expect(write.patch).not.toHaveProperty("items");
  });
});
