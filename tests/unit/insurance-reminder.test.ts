import { describe, expect, it } from "vitest";
import { assembleReminders } from "@/lib/home/reminders";

const today = new Date("2026-09-30T00:00:00");
const base = {
  association: { state_code: "IL", fiscal_year_end_month: 12, incorporated_on: null },
  bills: [],
  upcomingChargeDates: [],
  today,
};

describe("insurance renewal reminders", () => {
  it("nudges the board to get quotes at the policy's own lead time", () => {
    const r = assembleReminders({
      ...base,
      policies: [{ coverage: "property", effective_to: "2027-01-15", renewal_reminder_days: 60 }],
    });
    const quotes = r.find((x) => x.name === "Get insurance quotes")!;
    expect(quotes.due.toISOString().slice(0, 10)).toBe(new Date(2026, 10, 16).toISOString().slice(0, 10));
    expect(quotes.kind).toBe("Your master policy renews on January 15, 2027. This is a good time to get quotes.");
  });

  it("shows an overdue quote nudge as due today", () => {
    const r = assembleReminders({
      ...base,
      policies: [{ coverage: "directors_officers", effective_to: "2026-10-20", renewal_reminder_days: 60 }],
    });
    expect(r.find((x) => x.name === "Get insurance quotes")!.due.getTime()).toBe(today.getTime());
  });

  it("says nothing for a policy that has already ended", () => {
    const r = assembleReminders({ ...base, policies: [{ coverage: "property", effective_to: "2026-01-01" }] });
    expect(r.some((x) => x.name.startsWith("Get insurance") || x.name === "Insurance renewal")).toBe(false);
  });
});
