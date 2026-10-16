import { beforeEach, describe, expect, it, vi } from "vitest";
import { signStripePayload } from "@/lib/billing/stripe-signature";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc })) }));

const SECRET = "whsec_route_test";
const ASSOC = "11111111-1111-1111-1111-111111111111";
const fetchMock = vi.fn();

const post = async (body: string, header: string | null) => {
  const { POST } = await import("@/app/api/stripe/webhook/route");
  return POST(new Request("http://x/api/stripe/webhook", {
    method: "POST",
    body,
    headers: header ? { "stripe-signature": header } : {},
  }) as never);
};
const event = (type: string, object: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "evt_123", type, created: 1_800_000_000, livemode: false, data: { object }, ...over });
const send = (body: string) => post(body, signStripePayload(SECRET, body));

const subscription = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  metadata: { association_id: ASSOC },
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: 1_802_000_000, price: { id: "price_b_month", recurring: { interval: "month" } } }] },
};

/** rpc answers per function name; claim says "new" by default. */
function rpcAnswers(over: Record<string, { data: unknown; error: unknown }> = {}) {
  rpc.mockImplementation(async (name: string) => {
    if (over[name]) return over[name];
    if (name === "billing_claim_event") return { data: true, error: null };
    if (name === "billing_finish_event") return { data: null, error: null };
    return { data: "applied", error: null };
  });
}
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

beforeEach(() => {
  rpc.mockReset();
  rpcAnswers();
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify(subscription), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "rk_test_abc";
  process.env.STRIPE_PRICE_BUILDING_MONTH = "price_b_month";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/stripe/webhook", () => {
  it("500s with a clear error when STRIPE_WEBHOOK_SECRET is missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post(event("invoice.paid", { customer: "cus_1" }), "t=1,v1=00");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "STRIPE_WEBHOOK_SECRET is not configured." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400s a bad, tampered or stale signature and never touches the database", async () => {
    const body = event("invoice.paid", { customer: "cus_1" });
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body + " ", signStripePayload(SECRET, body))).status).toBe(400);
    expect((await post(body, signStripePayload(SECRET, body, Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect((await post(body, signStripePayload("whsec_wrong", body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200s and does nothing for an event type outside the allowlist", async () => {
    const res = await send(event("charge.refunded", { id: "ch_1" }));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores a live event reaching a test deployment", async () => {
    const res = await send(event("invoice.paid", { customer: "cus_1" }, { livemode: true }));
    expect(res.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("links checkout, then applies the subscription fetched fresh from Stripe", async () => {
    const res = await send(
      event("checkout.session.completed", {
        mode: "subscription",
        client_reference_id: ASSOC,
        customer: "cus_1",
        subscription: "sub_1",
        consent: { terms_of_service: "accepted" },
      }),
    );
    expect(res.status).toBe(200);
    expect(calls("billing_link_checkout")[0]).toMatchObject({ p_association_id: ASSOC, p_customer_id: "cus_1", p_subscription_id: "sub_1" });
    expect(calls("billing_link_checkout")[0].p_terms_accepted_at).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.stripe.com/v1/subscriptions/sub_1");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer rk_test_abc");
    expect(calls("billing_apply_subscription")[0]).toMatchObject({
      p_subscription_id: "sub_1",
      p_status: "active",
      p_plan_key: "building",
      p_interval: "month",
      p_association_id: ASSOC,
      p_current_period_end: new Date(1_802_000_000 * 1000).toISOString(),
    });
    expect(calls("billing_finish_event")[0]).toMatchObject({ p_event_id: "evt_123", p_outcome: "applied", p_association_id: ASSOC });
  });

  it("applies subscription events from a fresh fetch, not the event's snapshot", async () => {
    const res = await send(event("customer.subscription.updated", { id: "sub_1", status: "incomplete" }));
    expect(res.status).toBe(200);
    expect(calls("billing_apply_subscription")[0]).toMatchObject({ p_status: "active" });
  });

  it("records failed and paid invoices", async () => {
    await send(event("invoice.payment_failed", { customer: "cus_1" }));
    expect(calls("billing_record_payment")[0]).toMatchObject({ p_customer_id: "cus_1", p_paid: false });
    rpc.mockClear();
    await send(event("invoice.paid", { customer: "cus_1" }, { id: "evt_456" }));
    expect(calls("billing_record_payment")[0]).toMatchObject({ p_customer_id: "cus_1", p_paid: true });
  });

  it("is idempotent: a repeat delivery is a 200 that does nothing", async () => {
    rpcAnswers({ billing_claim_event: { data: false, error: null } });
    const res = await send(event("invoice.paid", { customer: "cus_1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(calls("billing_record_payment")).toHaveLength(0);
    expect(calls("billing_finish_event")).toHaveLength(0);
  });

  it("asks Stripe to retry when our own work fails, and marks the event failed so the retry can claim it", async () => {
    rpcAnswers({ billing_record_payment: { data: null, error: { code: "XX000", message: "boom" } } });
    const res = await send(event("invoice.paid", { customer: "cus_1" }));
    expect(res.status).toBe(500);
    expect(calls("billing_finish_event")[0]).toMatchObject({ p_outcome: "failed" });

    rpcAnswers({ billing_claim_event: { data: null, error: { code: "XX000", message: "down" } } });
    expect((await send(event("invoice.paid", { customer: "cus_1" }))).status).toBe(500);

    rpcAnswers();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "rate" } }), { status: 429 }));
    expect((await send(event("customer.subscription.updated", { id: "sub_1" }))).status).toBe(500);
  });

  it("does not retry forever when a customer is already linked to another association", async () => {
    rpcAnswers({ billing_link_checkout: { data: null, error: { code: "23505", message: "another association" } } });
    const res = await send(
      event("checkout.session.completed", { mode: "subscription", client_reference_id: ASSOC, customer: "cus_1", subscription: "sub_1" }),
    );
    expect(res.status).toBe(200);
    expect(calls("billing_finish_event")[0]).toMatchObject({ p_outcome: "failed" });
  });

  it("500s for a handled event when the Stripe key is missing, before claiming it", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await send(event("customer.subscription.updated", { id: "sub_1" }));
    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("logs no customer data", async () => {
    await send(event("invoice.paid", { customer: "cus_1", customer_email: "SECRET@example.com", customer_name: "SECRET NAME" }));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("SECRET");
  });
});
