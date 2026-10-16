import { describe, expect, it } from "vitest";
import { paidPlansLive, pricingWords } from "@/lib/billing/launch";

describe("public pricing wording switches by itself when paid plans go live", () => {
  it("stays on early access until billing is on AND the Stripe key is live", () => {
    expect(paidPlansLive({} as NodeJS.ProcessEnv)).toBe(false);
    expect(paidPlansLive({ BILLING_ENABLED: "1", STRIPE_SECRET_KEY: "rk_test_abc" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(paidPlansLive({ STRIPE_SECRET_KEY: "rk_live_abc" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(paidPlansLive({ BILLING_ENABLED: "1", STRIPE_SECRET_KEY: "rk_live_abc" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("promises early access before launch and the 14-day trial after", () => {
    expect(pricingWords(false).heroNote).toMatch(/^Free during early access/);
    expect(pricingWords(true).heroNote).toMatch(/^14-day free trial/);
    expect(pricingWords(true).signupSubtitle).toMatch(/14 days/);
  });

  it("never uses an em dash in either version", () => {
    for (const live of [false, true]) {
      for (const text of Object.values(pricingWords(live))) expect(text).not.toMatch(/—/);
    }
  });
});
