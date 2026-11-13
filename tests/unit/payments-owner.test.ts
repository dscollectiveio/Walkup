import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CHECKOUT_MINUTES, duesCheckoutParams, statusFromCheckout } from "@/lib/payments/checkout";
import { payOnlineLine, returnMessage } from "@/lib/payments/owner-view";

// The owner's Pay button (DECISIONS #57, plan Phase 3).

const base = {
  paymentId: "pay-1",
  associationId: "assoc-1",
  unitId: "unit-2",
  unitLabel: "Unit 2",
  associationName: "2158 N Damen",
  amountCents: 75_000,
  stripeAccountId: "acct_1",
  successUrl: "https://x/done",
  cancelUrl: "https://x/cancel",
  now: 1_700_000_000_000,
};

describe("dues Checkout parameters", () => {
  it("is ACH only, one line for the full amount, no fee or surcharge, tagged with the payment row", () => {
    const p = duesCheckoutParams(base);
    expect(p.mode).toBe("payment");
    expect(p.payment_method_types).toEqual(["us_bank_account"]);
    expect(p.line_items).toEqual([
      { quantity: 1, price_data: { currency: "usd", unit_amount: 75_000, product_data: { name: "HOA dues, Unit 2", description: "2158 N Damen" } } },
    ]);
    expect(p).not.toHaveProperty("payment_intent_data.application_fee_amount");
    expect(JSON.stringify(p)).not.toMatch(/application_fee/);
    expect(p.client_reference_id).toBe("pay-1");
    expect(p.metadata).toEqual({ walkup_payment_id: "pay-1", association_id: "assoc-1", unit_id: "unit-2" });
    expect(p.payment_intent_data.metadata).toEqual(p.metadata);
    expect(p.expires_at).toBe(Math.floor(base.now / 1000) + CHECKOUT_MINUTES * 60);
    expect(CHECKOUT_MINUTES).toBeGreaterThanOrEqual(30); // Stripe's minimum
  });

  it("refuses a zero, negative or fractional amount", () => {
    expect(() => duesCheckoutParams({ ...base, amountCents: 0 })).toThrow();
    expect(() => duesCheckoutParams({ ...base, amountCents: -5 })).toThrow();
    expect(() => duesCheckoutParams({ ...base, amountCents: 10.5 })).toThrow();
  });

  it("reads a Checkout's end: ACH completes unpaid (processing), paid means settled, expired frees the unit", () => {
    expect(statusFromCheckout({ status: "complete", paymentStatus: "unpaid", paymentIntentId: "pi_1" })).toBe("processing");
    expect(statusFromCheckout({ status: "complete", paymentStatus: "paid", paymentIntentId: "pi_1" })).toBe("succeeded");
    expect(statusFromCheckout({ status: "expired", paymentStatus: "unpaid", paymentIntentId: null })).toBe("canceled");
    expect(statusFromCheckout({ status: "open", paymentStatus: "unpaid", paymentIntentId: null })).toBeNull();
  });
});

describe("what the owner sees", () => {
  const now = Date.parse("2026-11-12T15:00:00");
  const row = (status: string, extra: object = {}) => ({
    status: status as never,
    amountCents: 75_000,
    createdAt: "2026-11-10T12:00:00",
    failureReason: null,
    ...extra,
  });

  it("offers the full balance", () => {
    expect(payOnlineLine({ owedCents: 75_000, latest: null, now })).toEqual({
      kind: "pay",
      amountCents: 75_000,
      buttonLabel: "Pay $750 by bank transfer",
      note: null,
    });
    expect(payOnlineLine({ owedCents: 12_345, latest: null, now })).toMatchObject({ buttonLabel: "Pay $123.45 by bank transfer" });
  });

  it("shows a started payment as pending, never as paid, and offers no second button", () => {
    expect(payOnlineLine({ owedCents: 75_000, latest: row("processing"), now })).toEqual({
      kind: "pending",
      text: "Payment of $750 started Nov 10. Bank transfers take about 4 business days. It shows as paid once it clears.",
    });
    expect(payOnlineLine({ owedCents: 75_000, latest: row("succeeded"), now }).kind).toBe("pending");
  });

  it("a failed payment counts as not paid: it says so and offers Pay again", () => {
    const l = payOnlineLine({ owedCents: 75_000, latest: row("failed", { failureReason: "insufficient funds" }), now });
    expect(l).toMatchObject({ kind: "pay", buttonLabel: "Pay $750 by bank transfer" });
    expect(l.kind === "pay" && l.note).toBe(
      "Your payment of $750 on Nov 10 didn't go through (insufficient funds). Nothing was paid, so it still counts as owed.",
    );
  });

  it("an open Checkout holds the button for 40 minutes, then lets go", () => {
    const fresh = row("checkout", { createdAt: new Date(now - 5 * 60_000).toISOString() });
    expect(payOnlineLine({ owedCents: 75_000, latest: fresh, now }).kind).toBe("pending");
    const stale = row("checkout", { createdAt: new Date(now - 45 * 60_000).toISOString() });
    expect(payOnlineLine({ owedCents: 75_000, latest: stale, now }).kind).toBe("pay");
  });

  it("nothing owed, nothing to press; a deposited payment is history", () => {
    expect(payOnlineLine({ owedCents: 0, latest: null, now })).toEqual({ kind: "nothing_owed" });
    expect(payOnlineLine({ owedCents: 0, latest: row("deposited"), now })).toEqual({ kind: "nothing_owed" });
  });

  it("the return messages, and no em dashes anywhere", () => {
    expect(returnMessage("started")?.tone).toBe("good");
    expect(returnMessage("canceled")?.text).toMatch(/Nothing was charged/);
    expect(returnMessage(undefined)).toBeNull();
    const all = [
      returnMessage("started")!.text,
      returnMessage("canceled")!.text,
      (payOnlineLine({ owedCents: 1, latest: row("failed"), now }) as { note: string }).note,
      (payOnlineLine({ owedCents: 1, latest: row("processing"), now }) as { text: string }).text,
    ];
    for (const t of all) expect(t).not.toContain("—");
  });
});
