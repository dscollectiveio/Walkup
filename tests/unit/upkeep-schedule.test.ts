import { describe, expect, it } from "vitest";
import { cadenceWords, initialNextDue, nextDueAfter, statusFor, UPKEEP_TEMPLATES } from "@/lib/upkeep/schedule";

describe("upkeep schedule", () => {
  it("rolls forward by the interval, snapping to the preferred month", () => {
    expect(nextDueAfter("2026-09-14", 12, 9)).toBe("2027-09-01");
    // Done late (October) for a September job: still next September, not October.
    expect(nextDueAfter("2026-10-20", 12, 9)).toBe("2027-09-01");
    // Done early (July) for a September job: next year's September, not this year's.
    expect(nextDueAfter("2026-07-02", 12, 9)).toBe("2027-09-01");
    expect(nextDueAfter("2026-03-10", 6, null)).toBe("2026-09-10");
    expect(nextDueAfter("2026-05-31", 1, null)).toBe("2026-06-28");
  });

  it("starts a new seasonal task in its month, the next time it comes around", () => {
    expect(initialNextDue("2026-10-01", 9)).toBe("2027-09-01");
    expect(initialNextDue("2026-10-01", 11)).toBe("2026-11-01");
    expect(initialNextDue("2026-10-01", 10)).toBe("2026-10-01");
    expect(initialNextDue("2026-10-01", null)).toBe("2026-10-01");
  });

  it("describes state against today", () => {
    expect(statusFor("2026-09-01", "2026-10-01")).toBe("overdue");
    expect(statusFor("2026-11-15", "2026-10-01")).toBe("due_soon");
    expect(statusFor("2027-04-01", "2026-10-01")).toBe("scheduled");
  });

  it("says the cadence in words", () => {
    expect(cadenceWords(12, 9)).toBe("every year, in September");
    expect(cadenceWords(6, null)).toBe("every 6 months");
    expect(cadenceWords(24, 5)).toBe("every 2 years, in May");
  });

  it("templates are well-formed", () => {
    for (const t of UPKEEP_TEMPLATES) {
      expect(t.interval_months).toBeGreaterThan(0);
      if (t.due_month !== null) expect(t.due_month).toBeGreaterThanOrEqual(1);
    }
    expect(new Set(UPKEEP_TEMPLATES.map((t) => t.name)).size).toBe(UPKEEP_TEMPLATES.length);
  });
});
