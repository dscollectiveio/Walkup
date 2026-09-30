import { describe, expect, it } from "vitest";
import { currentPeriodStart, periodLabel, perUnitAmount } from "@/lib/dues/period";

const SEP_30 = new Date("2026-09-30T12:00:00");

describe("dues period", () => {
  it("finds the first of the month, quarter and year", () => {
    expect(currentPeriodStart("monthly", SEP_30, "2026-01-01", null)).toBe("2026-09-01");
    expect(currentPeriodStart("quarterly", SEP_30, "2026-01-01", null)).toBe("2026-07-01");
    expect(currentPeriodStart("annual", SEP_30, "2026-01-01", null)).toBe("2026-01-01");
  });

  it("returns null before a schedule starts and after it ends", () => {
    expect(currentPeriodStart("monthly", SEP_30, "2026-10-01", null)).toBeNull();
    expect(currentPeriodStart("monthly", SEP_30, "2026-01-01", "2026-08-31")).toBeNull();
    expect(currentPeriodStart("monthly", SEP_30, "2026-09-01", null)).toBe("2026-09-01");
  });

  it("uses the start date itself for a one-time schedule", () => {
    expect(currentPeriodStart("one_time", SEP_30, "2026-06-15", null)).toBe("2026-06-15");
  });

  it("labels periods the way a board member says them", () => {
    expect(periodLabel("monthly", "2026-09-01")).toBe("September 2026");
    expect(periodLabel("quarterly", "2026-07-01")).toBe("Q3 2026");
    expect(periodLabel("annual", "2026-01-01")).toBe("2026");
  });

  it("splits an equal total to the cent and passes a per-unit amount through", () => {
    expect(perUnitAmount("fixed_per_unit", 350, 4)).toBe(350);
    expect(perUnitAmount("equal", 1000, 3)).toBe(333.33);
    expect(perUnitAmount("equal", 1000, 0)).toBe(0);
  });
});
