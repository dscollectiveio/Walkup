import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkoutTrialEnd } from "@/lib/billing/stripe";
import { TRIAL_DAYS } from "@/lib/billing/config";

const now = new Date("2026-10-16T12:00:00Z");

describe("choosing a plan during the free trial", () => {
  it("is 14 days", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("keeps the free days: Stripe's first charge waits for the trial end", () => {
    expect(checkoutTrialEnd("2026-10-28T12:00:00Z", now)).toBe(Date.parse("2026-10-28T12:00:00Z") / 1000);
  });

  it("treats a comp end date as the end of that day", () => {
    expect(checkoutTrialEnd("2026-11-30", now)).toBe(Date.parse("2026-11-30T23:59:59Z") / 1000);
  });

  it("charges now when there is no free time, or less than Stripe's 48 hours", () => {
    expect(checkoutTrialEnd(null, now)).toBeNull();
    expect(checkoutTrialEnd("2026-10-17T12:00:00Z", now)).toBeNull();
    expect(checkoutTrialEnd("2026-10-10T12:00:00Z", now)).toBeNull();
    expect(checkoutTrialEnd("not a date", now)).toBeNull();
  });
});
