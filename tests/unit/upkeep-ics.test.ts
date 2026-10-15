import { describe, expect, it } from "vitest";
import { buildRepairsCalendar, sequenceFrom, upkeepCalendarItems, type CalendarItem } from "@/lib/upkeep/ics";

const TASK = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Boiler / furnace service",
  next_due_on: "2027-09-30",
  interval_months: 12,
  due_month: 9,
  description: "Annual clean and safety check before the heating season.",
  updated_at: "2026-10-14T15:00:00Z",
};
const VISIT = {
  id: "22222222-2222-4222-8222-222222222222",
  reference: 12,
  title: "Leak in the back stairwell",
  scheduled_for: "2026-10-20",
  scheduled_window: "8 to 10am",
  updated_at: "2026-10-14T16:30:00Z",
};
const POLICY = {
  id: "33333333-3333-4333-8333-333333333333",
  coverage: "property",
  carrier_name: "Acme Mutual",
  effective_to: "2027-03-01",
  renewal_reminder_days: null,
  updated_at: "2026-03-01T12:00:00Z",
};

const build = (items: CalendarItem[]) =>
  buildRepairsCalendar({ associationId: "assoc-1", associationName: "2158 N Damen", items, generatedAt: "2026-10-14T18:00:00Z" });

/** Unfold RFC 5545 continuation lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("sequenceFrom", () => {
  it("counts minutes since the epoch and only grows", () => {
    expect(sequenceFrom("1970-01-01T00:10:00Z")).toBe(10);
    expect(sequenceFrom("2026-10-14T15:01:00Z")).toBeGreaterThan(sequenceFrom("2026-10-14T15:00:00Z"));
    expect(sequenceFrom("2099-12-31T23:59:00Z")).toBeLessThan(2 ** 31);
    expect(sequenceFrom("not a date")).toBe(0);
  });
});

describe("upkeepCalendarItems", () => {
  it("gives each task and visit one UID with no date in it", () => {
    const items = upkeepCalendarItems({ tasks: [TASK], policies: [], visits: [VISIT], appUrl: "https://walkup.app/" });
    const task = items.find((i) => i.uid === `upkeep-${TASK.id}@walkup`)!;
    expect(task.title).toBe("Boiler / furnace service is due");
    expect(task.date).toBe("2027-09-30");
    expect(task.alarmDaysBefore).toBe(7);
    expect(task.url).toBe(`https://walkup.app/repairs/upkeep/${TASK.id}`);
    expect(task.description).toContain("Every year, in September. Mark it done in Walkup so the next date moves.");
    expect(task.sequence).toBe(sequenceFrom(TASK.updated_at));

    const visit = items.find((i) => i.uid === `visit-${VISIT.id}@walkup`)!;
    expect(visit.title).toBe("Contractor visit: Leak in the back stairwell (#12)");
    expect(visit.alarmDaysBefore).toBe(1);
    expect(visit.description).toContain("8 to 10am");
    expect(visit.url).toBe(`https://walkup.app/maintenance/${VISIT.id}`);

    for (const i of items) {
      expect(i.uid).not.toContain(i.date);
      expect(i.uid).not.toContain(i.date.replace(/-/g, ""));
    }
  });

  it("keeps a rescheduled task's UID and gives it a higher sequence", () => {
    const before = upkeepCalendarItems({ tasks: [TASK], policies: [], visits: [], appUrl: "https://walkup.app" })[0];
    const after = upkeepCalendarItems({
      tasks: [{ ...TASK, next_due_on: "2027-10-31", updated_at: "2026-11-02T09:00:00Z" }],
      policies: [], visits: [], appUrl: "https://walkup.app",
    })[0];
    expect(after.uid).toBe(before.uid);
    expect(after.date).toBe("2027-10-31");
    expect(after.sequence).toBeGreaterThan(before.sequence);
  });

  it("adds policy dates only when policies are passed", () => {
    expect(upkeepCalendarItems({ tasks: [TASK], policies: [], visits: [], appUrl: "https://walkup.app" })
      .some((i) => i.uid.startsWith("insurance-"))).toBe(false);

    const items = upkeepCalendarItems({ tasks: [], policies: [POLICY], visits: [], appUrl: "https://walkup.app" });
    expect(items.map((i) => i.uid)).toEqual([
      `insurance-${POLICY.id}-start-renewal@walkup`,
      `insurance-${POLICY.id}-renews@walkup`,
    ]);
    const renews = items.find((i) => i.uid.endsWith("-renews@walkup"))!;
    expect(renews.title).toBe("Master policy insurance renews (Acme Mutual)");
    expect(renews.date).toBe("2027-03-01");
    expect(renews.alarmDaysBefore).toBeNull();
    const start = items.find((i) => i.uid.endsWith("-start-renewal@walkup"))!;
    expect(start.title).toBe("Start the Master policy insurance renewal");
    expect(start.date).toBe("2026-12-31"); // 60 days before by default
    expect(start.alarmDaysBefore).toBe(0);
    expect(start.sequence).toBe(sequenceFrom(POLICY.updated_at));
    // editing the policy (a new end date) moves SEQUENCE, so a calendar replaces the old event
    const edited = upkeepCalendarItems({ tasks: [], policies: [{ ...POLICY, effective_to: "2027-04-01", updated_at: "2026-09-01T12:00:00Z" }], visits: [], appUrl: "https://walkup.app" });
    expect(edited.find((i) => i.uid.endsWith("-renews@walkup"))!.sequence).toBeGreaterThan(renews.sequence);
    // copy: no doubled word
    expect(renews.description).toBe("The current Master policy with Acme Mutual ends on this date.");
    expect(start.description).not.toMatch(/policy policy/i);
    const flood = upkeepCalendarItems({ tasks: [], policies: [{ ...POLICY, coverage: "flood" }], visits: [], appUrl: "https://walkup.app" });
    expect(flood.find((i) => i.uid.endsWith("-renews@walkup"))!.description).toBe("The current Flood policy with Acme Mutual ends on this date.");

    const custom = upkeepCalendarItems({ tasks: [], policies: [{ ...POLICY, renewal_reminder_days: 90 }], visits: [], appUrl: "https://walkup.app" });
    expect(custom.find((i) => i.uid.endsWith("-start-renewal@walkup"))!.date).toBe("2026-12-01");
  });
});

describe("buildRepairsCalendar", () => {
  const items = upkeepCalendarItems({ tasks: [TASK], policies: [POLICY], visits: [VISIT], appUrl: "https://walkup.app" });
  const ics = build(items);

  it("uses CRLF line endings and folds at 75 octets", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n|\r/);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const long = build([{ ...items[0], title: "x".repeat(200) }]);
    expect(long).toContain("\r\n ");
    expect(unfold(long)).toContain(`SUMMARY:${"x".repeat(200)}`);
  });

  it("writes the calendar and event properties", () => {
    const text = unfold(ics);
    expect(text).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/Walkup\/\/Repairs and upkeep\/\/EN\r\n/);
    expect(text).toContain("X-WR-CALNAME:2158 N Damen upkeep");
    expect(text).toContain(`UID:upkeep-${TASK.id}@walkup`);
    expect(text).toContain(`UID:visit-${VISIT.id}@walkup`);
    expect(text).toContain(`SEQUENCE:${sequenceFrom(TASK.updated_at)}`);
    expect(text).toContain("DTSTAMP:20261014T180000Z");
    expect(text).toContain("DTSTART;VALUE=DATE:20270930");
    expect(text).toContain("DTEND;VALUE=DATE:20271001");
    expect(text).toContain(`URL:https://walkup.app/repairs/upkeep/${TASK.id}`);
    expect(text).toContain(`\\nhttps://walkup.app/repairs/upkeep/${TASK.id}`);
    expect((text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(4);
    expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("adds alarms only where the item has one", () => {
    const text = unfold(ics);
    expect(text).toContain("TRIGGER:-P7D");
    expect(text).toContain("TRIGGER:-P1D");
    expect(text).toContain("TRIGGER:-P0D");
    expect((text.match(/BEGIN:VALARM/g) ?? []).length).toBe(3); // task, visit, start-renewal; the renewal date itself has none
    expect(text).toContain("ACTION:DISPLAY");
  });

  it("escapes text values", () => {
    const text = unfold(build([{ ...items[0], title: "Roof; gutters, and a\\slash", description: "Line one\nLine two" }]));
    expect(text).toContain("SUMMARY:Roof\\; gutters\\, and a\\\\slash");
    expect(text).toContain("DESCRIPTION:Line one\\nLine two\\n");
  });
});
