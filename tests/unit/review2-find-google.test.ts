// Regression test for docs/security/REVIEW-2-server.md finding 27: opening the find page asks Google's saved
// results only; a Places call happens when a person presses the button.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { searchNearby, geocode } = vi.hoisted(() => ({
  searchNearby: vi.fn(async () => []),
  geocode: vi.fn(async () => ({ latitude: 41.9, longitude: -87.6 })),
}));
vi.mock("@/lib/google/places", async (orig) => ({
  ...(await orig<typeof import("@/lib/google/places")>()),
  googleKey: () => "test-key",
  searchNearby,
  geocode,
}));

let cacheRows: Record<string, unknown>[] = [];
let withCoordinates = true;
const inserts: string[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => (name === "is_board" || name === "has_role_in" ? { data: true, error: null } : { data: 0, error: null }),
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit", "order"]) c[m] = () => c;
      c.insert = () => (inserts.push(table), Promise.resolve({ error: null }));
      c.upsert = () => Promise.resolve({ error: null });
      c.then = (r: (v: unknown) => unknown) => {
        const data =
          table === "associations"
            ? [{ id: "a1", street_address: "1 Main St", city: "Chicago", state_code: "IL", postal_code: "60601", latitude: withCoordinates ? 41.9 : null, longitude: withCoordinates ? -87.6 : null }]
            : table === "contractor_search_cache"
              ? cacheRows
              : [];
        return Promise.resolve({ data, error: null }).then(r);
      };
      return c;
    },
  }),
}));

import { searchPlaces } from "@/app/repairs/find/actions";

beforeEach(() => {
  searchNearby.mockClear();
  geocode.mockClear();
  inserts.length = 0;
  cacheRows = [];
  withCoordinates = true;
});

describe("27. Google is searched on a click, not on page load", () => {
  it("cache-only with nothing saved spends nothing and says idle", async () => {
    const r = await searchPlaces({ trade: "plumbing", phrase: "", cacheOnly: true });
    expect(r.source).toEqual({ state: "idle" });
    expect(searchNearby).not.toHaveBeenCalled();
    expect(inserts).not.toContain("google_api_calls");
  });

  it("cache-only does not even geocode a building that has no coordinates yet", async () => {
    withCoordinates = false;
    const r = await searchPlaces({ trade: "plumbing", phrase: "", cacheOnly: true });
    expect(r.source).toEqual({ state: "idle" });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("cache-only returns a fresh saved result", async () => {
    cacheRows = [{ id: "c1", results_json: [], fetched_at: new Date().toISOString() }];
    const r = await searchPlaces({ trade: "plumbing", phrase: "", cacheOnly: true });
    expect(r.source).toMatchObject({ state: "ok", cached: true });
    expect(searchNearby).not.toHaveBeenCalled();
  });

  it("the button's search (no cacheOnly) does call Places and logs it", async () => {
    await searchPlaces({ trade: "plumbing", phrase: "" });
    expect(searchNearby).toHaveBeenCalledTimes(1);
    expect(inserts).toContain("google_api_calls");
  });
});
