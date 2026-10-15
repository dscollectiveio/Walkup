import { describe, expect, it } from "vitest";
import { buildCollections, centsFromNumeric } from "@/lib/collections/build";
import { stageFor, suggest, type CollectionUnit } from "@/lib/collections/suggest";

const TODAY = "2026-10-14";
const base = (over: Partial<Omit<CollectionUnit, "suggestion">> = {}): Omit<CollectionUnit, "suggestion"> => ({
  unitId: "u1", label: "Unit 1", ownerNames: ["Ada"], owedCents: 50000, overdueCents: 50000, oldestOverdueOn: "2026-09-01",
  daysOverdue: 43, aging: { current: 0, d1_30: 0, d31_60: 50000, d60plus: 0 }, lastReminderOn: null, remindersSent: 0,
  lastResult: null, hasEmail: true, optedOut: false, bounced: false, cappedUntil: null, openLateFeeChargeId: null, openLateFeeCents: 0, ...over,
});

describe("stageFor", () => {
  it("has boundaries at 0, 1, 29, 30, 59 and 60", () => {
    expect([0, 1, 29, 30, 59, 60, 400].map(stageFor)).toEqual(["current", "friendly", "friendly", "second", "second", "serious", "serious"]);
    expect(stageFor(-3)).toBe("current");
  });
});

describe("suggest", () => {
  it("says nothing is overdue", () => {
    expect(suggest(base({ overdueCents: 0, daysOverdue: 0 }), TODAY)).toEqual({ action: "none", why: "Nothing is overdue." });
  });

  it("suggests a call when there is no email, the address bounced, or the owner opted out", () => {
    expect(suggest(base({ hasEmail: false }), TODAY)).toEqual({ action: "call", why: "No email on file. Call or write to the owner." });
    expect(suggest(base({ bounced: true }), TODAY)).toEqual({ action: "call", why: "The last email bounced. Check the address or call the owner." });
    expect(suggest(base({ optedOut: true }), TODAY)).toEqual({ action: "call", why: "This owner opted out of email. Call or write to them." });
  });

  it("waits inside the seven day window and not after it", () => {
    const waiting = suggest(base({ lastReminderOn: "2026-10-10", cappedUntil: "2026-10-17" }), TODAY);
    expect(waiting).toEqual({ action: "wait", why: "Reminded Oct 10. Walkup sends at most one a week." });
    expect(suggest(base({ lastReminderOn: "2026-10-07", cappedUntil: "2026-10-14" }), TODAY).action).toBe("remind");
  });

  it("suggests a late fee notice only when a posted, unpaid fee is set", () => {
    const withFee = suggest(base({ openLateFeeChargeId: "c1", openLateFeeCents: 2500 }), TODAY);
    expect(withFee).toEqual({ action: "late_fee_notice", why: "A late fee of $25.00 is posted and unpaid. A notice can go with it." });
    expect(suggest(base({ openLateFeeChargeId: null, openLateFeeCents: 2500 }), TODAY).action).toBe("remind");
    expect(suggest(base({ openLateFeeChargeId: "c1", openLateFeeCents: 0 }), TODAY).action).toBe("remind");
    expect(suggest(base(), TODAY).why).not.toMatch(/late fee/i);
  });

  it("describes each stage of a reminder", () => {
    expect(suggest(base({ daysOverdue: 12 }), TODAY)).toEqual({ action: "remind", why: "12 days overdue. A friendly reminder is a good first step." });
    expect(suggest(base({ daysOverdue: 1 }), TODAY).why).toBe("1 day overdue. A friendly reminder is a good first step.");
    expect(suggest(base({ daysOverdue: 43, remindersSent: 2 }), TODAY)).toEqual({ action: "remind", why: "43 days overdue and 2 reminders already sent. Send another." });
    expect(suggest(base({ daysOverdue: 43, remindersSent: 1 }), TODAY).why).toBe("43 days overdue and 1 reminder already sent. Send another.");
    expect(suggest(base({ daysOverdue: 43, remindersSent: 0 }), TODAY).why).toBe("43 days overdue. No reminder has gone out yet. Send one.");
    expect(suggest(base({ daysOverdue: 75 }), TODAY)).toEqual({ action: "remind", why: "75 days overdue. Consider a call before another email." });
  });

  it("uses no em dash and gives no legal advice", () => {
    const all = [
      suggest(base({ hasEmail: false }), TODAY), suggest(base({ daysOverdue: 5 }), TODAY), suggest(base({ daysOverdue: 75 }), TODAY),
      suggest(base({ openLateFeeChargeId: "c", openLateFeeCents: 100 }), TODAY),
    ];
    for (const s of all) {
      expect(s.why).not.toMatch(/[–—]/);
      expect(s.why).not.toMatch(/attorney|lawsuit|lien|legal action|must|required by law/i);
    }
  });
});

describe("centsFromNumeric", () => {
  it("rounds the number PostgREST sends back to exact cents", () => {
    expect(centsFromNumeric(750)).toBe(75000);
    expect(centsFromNumeric(0.1 + 0.2)).toBe(30);
    expect(centsFromNumeric("1234.56")).toBe(123456);
    expect(centsFromNumeric(null)).toBe(0);
    expect(centsFromNumeric(19.99)).toBe(1999);
  });
});

describe("buildCollections", () => {
  const units = [{ id: "u1", label: "Unit 1" }, { id: "u2", label: "Unit 2" }, { id: "u3", label: "Unit 3" }];
  const charge = (id: string, unit: string, due: string, cents: number, type: "assessment" | "late_fee" = "assessment") => ({ id, unit_id: unit, charge_type: type, due_on: due, balanceCents: cents });
  const owner = (unit: string, name: string, email: string | null) => ({ unit_id: unit, person_id: `p-${unit}-${name}`, full_name: name, email });
  const input = (over: Partial<Parameters<typeof buildCollections>[0]> = {}) => ({
    todayIso: TODAY, units,
    charges: [charge("c1", "u1", "2026-01-01", 50000), charge("c2", "u2", "2026-09-01", 75000), charge("c3", "u2", "2026-10-20", 75000), charge("c4", "u3", "2026-11-01", 10000)],
    owners: [owner("u1", "Ada", "ada@example.test"), owner("u2", "Bo", "bo@example.test"), owner("u3", "Cy", "cy@example.test")],
    messages: [], suppressed: new Map(), optedOutPersonIds: new Set<string>(), ...over,
  });

  it("lists only units that are behind, largest overdue first, with aging buckets", () => {
    const rows = buildCollections(input());
    expect(rows.map((r) => r.unitId)).toEqual(["u2", "u1"]);
    const u1 = rows[1];
    expect(u1).toMatchObject({ owedCents: 50000, overdueCents: 50000, oldestOverdueOn: "2026-01-01", daysOverdue: 286 });
    expect(u1.aging).toEqual({ current: 0, d1_30: 0, d31_60: 0, d60plus: 50000 });
    const u2 = rows[0];
    expect(u2.owedCents).toBe(150000);
    expect(u2.overdueCents).toBe(75000);
    expect(u2.aging).toEqual({ current: 75000, d1_30: 0, d31_60: 75000, d60plus: 0 });
    expect(u2.daysOverdue).toBe(43);
  });

  it("buckets exactly at 30, 31, 60 and 61 days", () => {
    const due = (days: number) => {
      const d = new Date(Date.UTC(2026, 9, 14 - days));
      return d.toISOString().slice(0, 10);
    };
    const rows = buildCollections(input({ units: [{ id: "u1", label: "U" }], charges: [charge("a", "u1", due(30), 100), charge("b", "u1", due(31), 200), charge("c", "u1", due(60), 400), charge("d", "u1", due(61), 800)] }));
    expect(rows[0].aging).toEqual({ current: 0, d1_30: 100, d31_60: 600, d60plus: 800 });
  });

  it("reads the reminder history: count since the oldest overdue date, last result, and the weekly window", () => {
    const rows = buildCollections(input({
      messages: [
        { unit_ids: ["u2"], kind: "dues_reminder", status: "delivered", provider_message_id: "re_1", at: "2026-09-20T15:00:00Z" },
        { unit_ids: ["u2"], kind: "dues_reminder", status: "sent", provider_message_id: "manual:abc", at: "2026-10-10T15:00:00Z" },
        { unit_ids: ["u2"], kind: "late_fee_notice", status: "sent", provider_message_id: "re_2", at: "2026-10-12T15:00:00Z" },
        { unit_ids: ["u2"], kind: "dues_reminder", status: "skipped", provider_message_id: null, at: "2026-10-13T15:00:00Z" },
        { unit_ids: ["u1"], kind: "dues_reminder", status: "delivered", provider_message_id: "re_3", at: "2026-04-01T15:00:00Z" },
      ],
    }));
    const u2 = rows.find((r) => r.unitId === "u2")!;
    expect(u2).toMatchObject({ remindersSent: 2, lastReminderOn: "2026-10-10", lastResult: "by_hand", cappedUntil: "2026-10-17" });
    expect(u2.suggestion.action).toBe("wait");
    const u1 = rows.find((r) => r.unitId === "u1")!;
    expect(u1).toMatchObject({ remindersSent: 1, lastResult: "delivered", cappedUntil: null });
  });

  it("flags no email, a bounced address, and an owner who opted out", () => {
    const rows = buildCollections(input({
      owners: [owner("u1", "Ada", null), owner("u2", "Bo", "bo@example.test")],
      suppressed: new Map([["bo@example.test", "bounce" as const]]),
    }));
    expect(rows.find((r) => r.unitId === "u1")).toMatchObject({ hasEmail: false });
    expect(rows.find((r) => r.unitId === "u2")).toMatchObject({ hasEmail: true, bounced: true });
    const out = buildCollections(input({ optedOutPersonIds: new Set(["p-u1-Ada"]) }));
    expect(out.find((r) => r.unitId === "u1")).toMatchObject({ optedOut: true });
    expect(out.find((r) => r.unitId === "u1")!.suggestion.action).toBe("call");
  });

  it("does not call a unit opted out while a co-owner can still be reached", () => {
    const rows = buildCollections(input({
      owners: [owner("u1", "Ada", "ada@example.test"), owner("u1", "Al", "al@example.test")],
      optedOutPersonIds: new Set(["p-u1-Ada"]),
    }));
    expect(rows.find((r) => r.unitId === "u1")).toMatchObject({ optedOut: false, hasEmail: true });
  });

  it("finds an open posted late fee", () => {
    const rows = buildCollections(input({ charges: [charge("c1", "u1", "2026-01-01", 50000), charge("f1", "u1", "2026-02-15", 2500, "late_fee")] }));
    expect(rows[0]).toMatchObject({ openLateFeeChargeId: "f1", openLateFeeCents: 2500 });
    expect(rows[0].suggestion.action).toBe("late_fee_notice");
  });

  it("returns nothing when nobody is behind", () => {
    expect(buildCollections(input({ charges: [charge("c4", "u3", "2026-11-01", 10000)] }))).toEqual([]);
  });
});
