import { beforeEach, describe, expect, it, vi } from "vitest";
import { signStripePayload } from "@/lib/billing/stripe-signature";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ rpc })) }));

// The Connect webhook for online dues payments (DECISIONS #57, plan Phase 4).

const SECRET = "whsec_connect_test";
const ACCT = "acct_1Damen";
const PAY = "22222222-2222-2222-2222-222222222222";
const fetchMock = vi.fn();

const post = async (body: string, header: string | null) => {
  const { POST } = await import("@/app/api/stripe/connect/webhook/route");
  return POST(new Request("http://x/api/stripe/connect/webhook", {
    method: "POST",
    body,
    headers: header ? { "stripe-signature": header } : {},
  }) as never);
};
const event = (type: string, object: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: "evt_c1", type, created: 1_800_000_000, livemode: false, account: ACCT, data: { object }, ...over });
const send = (body: string) => post(body, signStripePayload(SECRET, body));

function rpcAnswers(over: Record<string, { data: unknown; error: unknown }> = {}) {
  rpc.mockImplementation(async (name: string) => {
    if (over[name]) return over[name];
    if (name === "connect_claim_event") return { data: true, error: null };
    if (name === "connect_finish_event") return { data: null, error: null };
    return { data: "applied", error: null };
  });
}
const calls = (name: string) => rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);

/** Stripe answers by URL path. */
function stripeAnswers(map: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/v1/, "");
    const hit = Object.entries(map).find(([k]) => path === k);
    expect((init.headers as Record<string, string>)["Stripe-Account"]).toBe(ACCT);
    if (!hit) return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  });
}

beforeEach(() => {
  rpc.mockReset();
  rpcAnswers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_abc";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/stripe/connect/webhook", () => {
  it("500s when its secret is missing; 400s a bad signature without touching the database", async () => {
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    expect((await send(event("payout.paid", { id: "po_1" }))).status).toBe(500);
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = SECRET;
    const body = event("payout.paid", { id: "po_1" });
    expect((await post(body, null)).status).toBe(400);
    expect((await post(body, signStripePayload("whsec_other", body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("ignores other types, events with no connected account, and the other mode", async () => {
    for (const body of [
      event("invoice.paid", { id: "in_1" }),
      event("payout.paid", { id: "po_1" }, { account: undefined }),
      event("payout.paid", { id: "po_1" }, { livemode: true }),
    ]) {
      const r = await send(body);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ignored: true });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a repeat is a no-op", async () => {
    rpcAnswers({ connect_claim_event: { data: false, error: null } });
    const r = await send(event("payout.paid", { id: "po_1" }));
    expect(await r.json()).toEqual({ ok: true, duplicate: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("account.updated reads the account fresh and records whether it can take payments", async () => {
    stripeAnswers({ [`/accounts/${ACCT}`]: { charges_enabled: true, payouts_enabled: true, details_submitted: true } });
    // fetchConnectAccountStatus calls without the Stripe-Account header (platform view of the account).
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ charges_enabled: true, payouts_enabled: false, details_submitted: true }), { status: 200 }));
    await send(event("account.updated", { id: ACCT, charges_enabled: true, payouts_enabled: true }));
    expect(calls("connect_apply_account")).toEqual([
      { p_stripe_account_id: ACCT, p_charges_enabled: true, p_payouts_enabled: false, p_details_submitted: true },
    ]);
  });

  it("checkout.session.completed for ACH marks the payment processing, matched by session and Walkup's id", async () => {
    stripeAnswers({ "/checkout/sessions/cs_1": { status: "complete", payment_status: "unpaid", payment_intent: "pi_1" } });
    await send(event("checkout.session.completed", { id: "cs_1", metadata: { walkup_payment_id: PAY } }));
    expect(calls("connect_apply_payment")).toEqual([
      { p_stripe_account_id: ACCT, p_checkout_session_id: "cs_1", p_payment_intent_id: "pi_1", p_status: "processing", p_payment_id: PAY },
    ]);
  });

  it("ignores a Checkout that isn't a Walkup dues payment", async () => {
    const r = await send(event("checkout.session.completed", { id: "cs_9", metadata: {} }));
    expect(await r.json()).toMatchObject({ outcome: "ignored" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("payment_intent.succeeded records the fee from the balance transaction", async () => {
    stripeAnswers({
      "/payment_intents/pi_1": {
        id: "pi_1",
        status: "succeeded",
        metadata: { walkup_payment_id: PAY },
        latest_charge: { id: "ch_1", balance_transaction: { fee: 500 } },
      },
    });
    await send(event("payment_intent.succeeded", { id: "pi_1", metadata: { walkup_payment_id: PAY } }));
    expect(calls("connect_apply_payment")).toEqual([
      {
        p_stripe_account_id: ACCT,
        p_checkout_session_id: null,
        p_payment_intent_id: "pi_1",
        p_status: "succeeded",
        p_fee: 5,
        p_failure_reason: null,
        p_payment_id: PAY,
      },
    ]);
  });

  it("payment_intent.payment_failed records it as failed, with the bank's reason", async () => {
    stripeAnswers({
      "/payment_intents/pi_1": {
        id: "pi_1",
        status: "requires_payment_method",
        metadata: { walkup_payment_id: PAY },
        last_payment_error: { message: "Insufficient funds" },
        latest_charge: null,
      },
    });
    await send(event("payment_intent.payment_failed", { id: "pi_1", metadata: { walkup_payment_id: PAY } }));
    expect(calls("connect_apply_payment")[0]).toMatchObject({ p_status: "failed", p_failure_reason: "Insufficient funds" });
  });

  it("a full refund marks it refunded; a partial one is left alone", async () => {
    stripeAnswers({
      "/charges/ch_1": { payment_intent: "pi_1" },
      "/payment_intents/pi_1": { id: "pi_1", status: "succeeded", latest_charge: { id: "ch_1", refunded: true } },
    });
    await send(event("charge.refunded", { id: "ch_1" }));
    expect(calls("connect_apply_payment")[0]).toMatchObject({ p_payment_intent_id: "pi_1", p_status: "refunded" });

    rpc.mockClear();
    stripeAnswers({
      "/charges/ch_1": { payment_intent: "pi_1" },
      "/payment_intents/pi_1": { id: "pi_1", status: "succeeded", latest_charge: { id: "ch_1", refunded: false } },
    });
    await send(event("charge.refunded", { id: "ch_1" }));
    expect(calls("connect_apply_payment")).toEqual([]);
  });

  it("a dispute marks the payment disputed", async () => {
    stripeAnswers({ "/charges/ch_1": { payment_intent: "pi_1" } });
    await send(event("charge.dispute.created", { id: "dp_1", charge: "ch_1" }));
    expect(calls("connect_apply_payment")[0]).toMatchObject({ p_payment_intent_id: "pi_1", p_status: "disputed" });
  });

  it("payout.paid records the payout and the payment intents in it, across pages", async () => {
    let page = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === "/v1/payouts/po_1") return new Response(JSON.stringify({ id: "po_1", amount: 74400, arrival_date: 1_800_100_000, status: "paid" }));
      page += 1;
      return new Response(
        JSON.stringify(
          page === 1
            ? { has_more: true, data: [{ id: "txn_1", source: { object: "charge", payment_intent: "pi_1" } }, { id: "txn_2", source: { object: "payout" } }] }
            : { has_more: false, data: [{ id: "txn_3", source: { object: "charge", payment_intent: "pi_2" } }] },
        ),
      );
    });
    await send(event("payout.paid", { id: "po_1" }));
    expect(calls("connect_apply_payout")).toEqual([
      {
        p_stripe_account_id: ACCT,
        p_payout_id: "po_1",
        p_amount: 744,
        p_arrival_date: new Date(1_800_100_000 * 1000).toISOString().slice(0, 10),
        p_status: "paid",
        p_payment_intent_ids: ["pi_1", "pi_2"],
      },
    ]);
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get("starting_after")).toBe("txn_2");
  });

  it("500s so Stripe retries when the database fails, and records the failure", async () => {
    stripeAnswers({ "/checkout/sessions/cs_1": { status: "complete", payment_status: "unpaid", payment_intent: "pi_1" } });
    rpcAnswers({ connect_apply_payment: { data: null, error: { code: "XX000", message: "boom" } } });
    const r = await send(event("checkout.session.completed", { id: "cs_1", metadata: { walkup_payment_id: PAY } }));
    expect(r.status).toBe(500);
    expect(calls("connect_finish_event")).toEqual([{ p_event_id: "evt_c1", p_outcome: "failed" }]);
  });
});
