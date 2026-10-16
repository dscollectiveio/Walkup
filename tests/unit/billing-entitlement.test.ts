import { describe, expect, it } from "vitest";
import { computeEntitlement, computeStatus, factsFromRow, type BillingFacts } from "@/lib/billing/entitlement-rules";
import {
  GRACE_DAYS,
  PLAN_TIERS,
  billingEnabled,
  billingEnforced,
  planForPriceId,
  priceIdFor,
  stripeConfigProblem,
  stripeIsLive,
  tierForUnits,
} from "@/lib/billing/config";
import { billingCopy } from "@/lib/billing/copy";
import { PLANS } from "@/lib/site-config";

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
const f = (over: Partial<BillingFacts>): BillingFacts => ({ ...base, ...over });

describe("computeStatus: the access rules", () => {
  const cases: [string, Partial<BillingFacts>, string][] = [
    ["active comp", { compActive: true }, "comped"],
    ["comp wins over a lapsed plan", { compActive: true, subscriptionStatus: "canceled", currentPeriodEnd: days(-90) }, "comped"],
    ["paid and current", { subscriptionStatus: "active", hasSubscription: true }, "active"],
    ["Stripe trial", { subscriptionStatus: "trialing", hasSubscription: true }, "trialing"],
    ["Walkup trial running", { trialEndsAt: days(5) }, "trialing"],
    ["trial just ended: grace", { trialEndsAt: days(-3) }, "grace"],
    ["trial ended long ago", { trialEndsAt: days(-(GRACE_DAYS + 1)) }, "read_only"],
    ["payment failed recently", { subscriptionStatus: "past_due", paymentFailedAt: days(-2) }, "past_due"],
    ["unpaid inside grace", { subscriptionStatus: "unpaid", paymentFailedAt: days(-(GRACE_DAYS - 1)) }, "past_due"],
    ["payment failed past grace", { subscriptionStatus: "past_due", paymentFailedAt: days(-(GRACE_DAYS + 1)) }, "read_only"],
    ["cancelled, period just ended", { subscriptionStatus: "canceled", currentPeriodEnd: days(-1) }, "grace"],
    ["cancelled long ago", { subscriptionStatus: "canceled", currentPeriodEnd: days(-60) }, "read_only"],
    ["incomplete_expired, no dates", { subscriptionStatus: "incomplete_expired" }, "read_only"],
    ["no facts at all", {}, "read_only"],
  ];
  for (const [name, over, want] of cases) {
    it(name, () => expect(computeStatus(f(over), NOW).status).toBe(want));
  }
  it("says when read-only would begin during past_due and grace", () => {
    expect(computeStatus(f({ subscriptionStatus: "past_due", paymentFailedAt: days(-2) }), NOW).readOnlyFrom?.toISOString()).toBe(days(GRACE_DAYS - 2));
    expect(computeStatus(f({ trialEndsAt: days(-3) }), NOW).readOnlyFrom?.toISOString()).toBe(days(GRACE_DAYS - 3));
  });
  it("treats a missing row as read_only (only reachable when enforcement is on)", () => {
    expect(computeStatus(null, NOW).status).toBe("read_only");
  });
});

describe("computeEntitlement: the switches", () => {
  const lapsed = f({ trialEndsAt: days(-60) });
  it("BILLING_ENABLED off: not_enabled, everyone entitled, nothing read-only, honest status kept", () => {
    const e = computeEntitlement(lapsed, { enabled: false, enforced: true, now: NOW });
    expect(e).toMatchObject({ status: "not_enabled", computed: "read_only", entitled: true, readOnly: false, enforced: false });
  });
  it("enabled but not enforced: real status shown, still entitled", () => {
    const e = computeEntitlement(lapsed, { enabled: true, enforced: false, now: NOW });
    expect(e).toMatchObject({ status: "read_only", entitled: true, readOnly: false });
  });
  it("enabled and enforced: a lapsed building is read-only; a comped one is not", () => {
    expect(computeEntitlement(lapsed, { enabled: true, enforced: true, now: NOW })).toMatchObject({ readOnly: true, entitled: false });
    expect(computeEntitlement(f({ compActive: true }), { enabled: true, enforced: true, now: NOW })).toMatchObject({ status: "comped", readOnly: false });
  });
  it("reads the env flags as off unless set to 1/true/on", () => {
    expect(billingEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(billingEnabled({ BILLING_ENABLED: "0" } as never)).toBe(false);
    expect(billingEnabled({ BILLING_ENABLED: "1" } as never)).toBe(true);
    expect(billingEnforced({ BILLING_ENFORCE: "1" } as never)).toBe(false); // needs ENABLED too
    expect(billingEnforced({ BILLING_ENABLED: "true", BILLING_ENFORCE: "on" } as never)).toBe(true);
  });
});

describe("tiers and prices", () => {
  it("picks the tier from the unit count, refusing above 20", () => {
    expect(tierForUnits(0)?.key).toBe("starter");
    expect(tierForUnits(2)?.key).toBe("starter");
    expect(tierForUnits(6)?.key).toBe("starter");
    expect(tierForUnits(7)?.key).toBe("building");
    expect(tierForUnits(12)?.key).toBe("building");
    expect(tierForUnits(13)?.key).toBe("association");
    expect(tierForUnits(20)?.key).toBe("association");
    expect(tierForUnits(21)).toBeNull();
  });
  it("follows the landing page's PLANS list", () => {
    expect(PLAN_TIERS.map((t) => [t.name, t.month, t.year])).toEqual(PLANS.map((p) => [p.name, p.month, p.year]));
  });
  it("reads price ids from the environment and maps them back", () => {
    const env = { STRIPE_PRICE_BUILDING_YEAR: "price_abc123", STRIPE_PRICE_STARTER_MONTH: "not-a-price" } as never;
    expect(priceIdFor("building", "year", env)).toBe("price_abc123");
    expect(priceIdFor("starter", "month", env)).toBeNull();
    expect(planForPriceId("price_abc123", env)).toEqual({ key: "building", interval: "year" });
    expect(planForPriceId("price_other", env)).toBeNull();
  });
  it("fails closed on Stripe keys: missing, malformed, or live outside production", () => {
    expect(stripeConfigProblem({} as never)).toMatch(/not set up/);
    expect(stripeConfigProblem({ STRIPE_SECRET_KEY: "pk_test_x" } as never)).toMatch(/not set up correctly/);
    expect(stripeConfigProblem({ STRIPE_SECRET_KEY: "sk_live_x", VERCEL_ENV: "preview" } as never)).toMatch(/Live payments/);
    expect(stripeConfigProblem({ STRIPE_SECRET_KEY: "rk_live_x", VERCEL_ENV: "production" } as never)).toBeNull();
    expect(stripeConfigProblem({ STRIPE_SECRET_KEY: "sk_test_x" } as never)).toBeNull();
    expect(stripeIsLive({ STRIPE_SECRET_KEY: "rk_live_x" } as never)).toBe(true);
    expect(stripeIsLive({ STRIPE_SECRET_KEY: "sk_test_x" } as never)).toBe(false);
  });
});

describe("billing copy", () => {
  it("never uses an em dash, for every status", () => {
    const facts = [
      f({}),
      f({ compActive: true }),
      f({ compActive: true, compExpiresOn: "2027-01-31" }),
      f({ trialEndsAt: days(5) }),
      f({ trialEndsAt: days(-2) }),
      f({ subscriptionStatus: "active", planKey: "building", currentPeriodEnd: days(20), hasSubscription: true }),
      f({ subscriptionStatus: "active", cancelAtPeriodEnd: true, currentPeriodEnd: days(20), hasSubscription: true }),
      f({ subscriptionStatus: "past_due", paymentFailedAt: days(-1), hasSubscription: true }),
    ];
    for (const facts1 of facts) {
      for (const flags of [{ enabled: false, enforced: false }, { enabled: true, enforced: false }, { enabled: true, enforced: true }]) {
        const c = billingCopy(facts1, computeEntitlement(facts1, { ...flags, now: NOW }));
        expect(`${c.label} ${c.headline} ${c.detail ?? ""}`).not.toMatch(/—/);
        expect(c.headline.length).toBeGreaterThan(0);
      }
    }
  });
  it("is honest while billing is off", () => {
    const c = billingCopy(f({ compActive: true, compKind: "early_access" }), computeEntitlement(f({ compActive: true }), { enabled: false, enforced: false }));
    expect(c.label).toBe("Early access: free");
    expect(c.action).toBeNull();
  });
  it("maps database rows to facts", () => {
    const facts = factsFromRow({ comp_active: true, unit_count: 4, has_subscription: false, trial_ends_at: null, stripe_customer_id: "cus_1" });
    expect(facts).toMatchObject({ compActive: true, unitCount: 4, stripeCustomerId: "cus_1", hasSubscription: false });
    expect(factsFromRow(undefined)).toBeNull();
  });
});
