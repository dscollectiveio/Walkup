import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { findLiveSubscription, switchSubscriptionPrice } from "@/lib/billing/stripe";

const KEY = "rk_test_unit";
type Call = { url: string; method: string; body: string; headers: Record<string, string> };
let calls: Call[];

function stubFetch(responses: unknown[]) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method: string; body?: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, body: init.body ?? "", headers: init.headers });
      return { ok: true, status: 200, json: async () => responses.shift() };
    }),
  );
}

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", KEY);
  vi.stubEnv("STRIPE_PRICE_STARTER_MONTH", "price_m");
  vi.stubEnv("STRIPE_PRICE_STARTER_YEAR", "price_y");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const sub = (interval: string, priceId: string) => ({
  id: "sub_123",
  customer: "cus_123",
  status: "active",
  metadata: { association_id: "11111111-1111-1111-1111-111111111111" },
  items: { data: [{ id: "si_456", current_period_end: 1_800_000_000, price: { id: priceId, recurring: { interval } } }] },
});

describe("monthly to yearly", () => {
  it("finds the customer's one active subscription and its item", async () => {
    stubFetch([{ data: [sub("month", "price_m")] }]);
    const s = await findLiveSubscription("cus_123");
    expect(s).toMatchObject({ id: "sub_123", itemId: "si_456", interval: "month", planKey: "starter" });
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("customer=cus_123");
    expect(calls[0].url).toContain("status=active");
  });

  it("switches the item to the yearly price, billed now, refusing a failed card", async () => {
    stubFetch([sub("year", "price_y")]);
    const s = await switchSubscriptionPrice("sub_123", "si_456", "price_y");
    expect(s.interval).toBe("year");
    const body = decodeURIComponent(calls[0].body);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toMatch(/\/subscriptions\/sub_123$/);
    expect(body).toContain("items[0][id]=si_456");
    expect(body).toContain("items[0][price]=price_y");
    expect(body).toContain("proration_behavior=always_invoice");
    expect(body).toContain("billing_cycle_anchor=now");
    expect(body).toContain("payment_behavior=error_if_incomplete");
    expect(calls[0].headers["Idempotency-Key"]).toBe("switch-sub_123-price_y");
  });

  it("refuses ids that aren't Stripe ids, before any request", async () => {
    stubFetch([]);
    await expect(switchSubscriptionPrice("sub_1/../x", "si_1", "price_y")).rejects.toThrow();
    await expect(findLiveSubscription("nope")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
