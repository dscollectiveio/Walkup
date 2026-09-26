import { describe, expect, it } from "vitest";
import { assembleReminders } from "@/lib/home/reminders";

const base = {
  association: { state_code: "IL", fiscal_year_end_month: 12, incorporated_on: null },
  bills: [],
  policies: [],
  upcomingChargeDates: [],
  today: new Date("2026-09-26T00:00:00"),
};

const accessReminder = (r: ReturnType<typeof assembleReminders>) =>
  r.find((x) => x.kind === "Confirm who can see the books");

describe("access review reminder", () => {
  it("is absent for anyone who isn't a board admin", () => {
    expect(accessReminder(assembleReminders(base))).toBeUndefined();
  });

  it("is due today when no review has ever been recorded", () => {
    const r = accessReminder(assembleReminders({ ...base, lastAccessReviewAt: null }));
    expect(r?.name).toBe("First access review");
    expect(r?.due.toISOString()).toBe(base.today.toISOString());
  });

  it("is due 90 days after the last review", () => {
    const r = accessReminder(
      assembleReminders({ ...base, lastAccessReviewAt: "2026-09-01T00:00:00" }),
    );
    expect(r?.name).toBe("Access review");
    expect(r?.due.toISOString()).toBe(new Date("2026-11-30T00:00:00").toISOString());
  });

  it("reads an overdue review as due today rather than dropping it", () => {
    const r = accessReminder(
      assembleReminders({ ...base, lastAccessReviewAt: "2026-01-01T00:00:00" }),
    );
    expect(r?.due.toISOString()).toBe(base.today.toISOString());
  });
});
