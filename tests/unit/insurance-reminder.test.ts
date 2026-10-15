import { describe, expect, it } from "vitest";
import { assembleReminders } from "@/lib/home/reminders";

const today = new Date("2026-09-30T00:00:00");
const base = {
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

  it("gives a renewed policy no quotes nudge, but keeps the renewal date", () => {
    const r = assembleReminders({
      ...base,
      policies: [{ coverage: "property", effective_to: "2026-11-15", renewal_reminder_days: 60, renewed: true }],
    });
    expect(r.some((x) => x.name === "Get insurance quotes")).toBe(false);
    expect(r.find((x) => x.name === "Insurance renewal")).toMatchObject({ kind: "Master policy" });
  });

  it("nudges at 90 days for a 90-day lead time", () => {
    const r = assembleReminders({
      ...base,
      policies: [{ coverage: "general_liability", effective_to: "2027-01-28", renewal_reminder_days: 90 }],
    });
    const quotes = r.find((x) => x.name === "Get insurance quotes")!;
    expect(quotes.due.getTime()).toBe(new Date(2026, 9, 30).getTime());
    expect(quotes.kind).toBe("Your liability policy renews on January 28, 2027. This is a good time to get quotes.");
    expect(quotes.href).toBe("/insurance?view=quotes&new=1");
  });

  it("gives a legacy replaced row with no successor no reminder (Home passes only active and upcoming policies)", async () => {
    const { withStatus } = await import("@/lib/insurance/status");
    const rows = [
      {
        id: "p1", coverage: "property", effective_from: "2026-01-01", effective_to: "2026-12-31",
        archived_at: null, replaced_by_policy_id: null, replaced_at: "2026-06-01T00:00:00Z", renewal_reminder_days: 60,
      },
    ];
    const passed = withStatus(rows, "2026-09-30")
      .filter((s) => s.status === "active" || s.status === "upcoming")
      .map((s) => ({ coverage: s.policy.coverage, effective_to: s.policy.effective_to, renewed: s.renewed }));
    expect(passed).toEqual([]);
    expect(assembleReminders({ ...base, policies: passed }).filter((x) => /insurance/i.test(x.name))).toEqual([]);
  });

  it("nudges a quote follow-up on the day, and an overdue one as today", () => {
    const r = assembleReminders({
      ...base,
      policies: [],
      quoteRequests: [
        { contactName: "Lakeview Agency", followUpOn: "2026-10-07", status: "sent" },
        { contactName: "Old Agency", followUpOn: "2026-09-01", status: "sent" },
        { contactName: "Draft Agency", followUpOn: "2026-10-01", status: "draft" },
        { contactName: "Answered Agency", followUpOn: "2026-10-01", status: "quote_received" },
      ],
    });
    const followUps = r.filter((x) => x.name.startsWith("Follow up with"));
    expect(followUps.map((x) => x.name)).toEqual([
      "Follow up with Old Agency about your quote",
      "Follow up with Lakeview Agency about your quote",
    ]);
    expect(followUps[0].due.getTime()).toBe(today.getTime());
    expect(followUps[1].due.getTime()).toBe(new Date(2026, 9, 7).getTime());
    expect(followUps[1].href).toBe("/insurance?view=quotes");
  });

  it("nudges a quote expiry from 7 days before, never for a declined or chosen quote", () => {
    const quotes = (validUntil: string, over = {}) => [{ carrier: "West Bend", validUntil, declined: false, selected: false, ...over }];
    const expiring = (q: ReturnType<typeof quotes>) => assembleReminders({ ...base, policies: [], quotes: q }).filter((x) => x.kind === "Insurance quote");
    expect(expiring(quotes("2026-10-08"))).toEqual([]);
    expect(expiring(quotes("2026-10-07")).map((x) => x.name)).toEqual(["West Bend quote expires Oct 7"]);
    expect(expiring(quotes("2026-10-07", { declined: true }))).toEqual([]);
    expect(expiring(quotes("2026-10-07", { selected: true }))).toEqual([]);
    expect(expiring(quotes("2026-09-29"))).toEqual([]);
  });
});
