import { describe, expect, it } from "vitest";
import { computeEntitlement, type BillingFacts } from "@/lib/billing/entitlement-rules";
import { billingNotice } from "@/lib/billing/copy";

const NOW = new Date("2026-10-15T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const base: BillingFacts = {
  trialEndsAt: null,
  subscriptionStatus: null,
  planKey: null,
  billingInterval: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  paymentFailedAt: null,
  compActive: false,
  compKind: null,
  compExpiresOn: null,
  unitCount: 3,
  hasSubscription: false,
  stripeCustomerId: null,
};
const notice = (over: Partial<BillingFacts>, enabled = true) => {
  const facts = { ...base, ...over };
  return billingNotice(facts, computeEntitlement(facts, { enabled, enforced: false, now: NOW }), NOW);
};

describe("billingNotice: the Dashboard only speaks up when the board needs to act", () => {
  it("says nothing while billing is switched off, whatever the facts", () => {
    expect(notice({ trialEndsAt: days(-30) }, false)).toBeNull();
  });

  it("says nothing for a paid, healthy plan or an open-ended comp", () => {
    expect(notice({ hasSubscription: true, subscriptionStatus: "active", planKey: "starter", currentPeriodEnd: days(20) })).toBeNull();
    expect(notice({ compActive: true, compKind: "early_access" })).toBeNull();
  });

  it("shows a free trial only in its last 7 days", () => {
    expect(notice({ trialEndsAt: days(20) })).toBeNull();
    expect(notice({ trialEndsAt: days(5) })).toMatchObject({ label: "Free trial", action: "choose" });
  });

  it("shows a comp in its last 30 days, with a way to choose a plan", () => {
    const end = days(45).slice(0, 10);
    expect(notice({ compActive: true, compKind: "friend", compExpiresOn: end })).toBeNull();
    expect(notice({ compActive: true, compKind: "friend", compExpiresOn: days(10).slice(0, 10) })).toMatchObject({ label: "Complimentary", action: "choose" });
  });

  it("always shows a payment problem and a lapsed plan", () => {
    expect(
      notice({ hasSubscription: true, subscriptionStatus: "past_due", paymentFailedAt: days(-2), currentPeriodEnd: days(5) }),
    ).toMatchObject({ tone: "bad", action: "manage" });
    expect(notice({ trialEndsAt: days(-3) })).toMatchObject({ label: "Plan ended", action: "choose" });
  });

  it("never uses an em dash", () => {
    const n = notice({ trialEndsAt: days(-3) });
    expect(`${n?.headline} ${n?.detail}`).not.toMatch(/—/);
  });
});
