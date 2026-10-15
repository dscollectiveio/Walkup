import { describe, expect, it } from "vitest";
import { assembleReminders } from "@/lib/home/reminders";

const today = new Date("2026-09-30T00:00:00");
const base = { bills: [], policies: [], upcomingChargeDates: [], today };
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

describe("Coming up: Repairs & Upkeep (repairs-spec §18.3)", () => {
  it("lists upkeep due within 60 days, keeping an overdue job on its real date", () => {
    const r = assembleReminders({
      ...base,
      upkeep: [
        { name: "Boiler service", next_due_on: "2026-09-15" },
        { name: "Gutter cleaning", next_due_on: "2026-11-29" },
        { name: "Backflow test", next_due_on: "2026-11-30" },
      ],
    });
    const upkeep = r.filter((x) => x.kind === "Upkeep");
    expect(upkeep.map((x) => [x.name, x.overdue === true])).toEqual([
      ["Boiler service", true],
      ["Gutter cleaning", false],
    ]);
    expect(upkeep[0].due.getTime()).toBe(day(2026, 9, 15));
    expect(upkeep[0].href).toBe("/repairs?view=upkeep");
  });

  it("lists contractor visits in the next 14 days", () => {
    const r = assembleReminders({
      ...base,
      visits: [
        { title: "Leak under the sink", reference: 12, scheduled_for: "2026-10-03" },
        { title: "Roof", reference: 13, scheduled_for: "2026-10-20" },
        { title: "Old visit", reference: 9, scheduled_for: "2026-09-20" },
      ],
    });
    expect(r.filter((x) => x.kind === "Repair visit").map((x) => x.name)).toEqual(["Contractor visit: Leak under the sink (#12)"]);
  });

  it("lists contractor paperwork expiring within 60 days", () => {
    const r = assembleReminders({
      ...base,
      contractorExpiries: [
        { name: "Ace Plumbing", kind: "coi", date: "2026-10-31" },
        { name: "Bright Electric", kind: "license", date: "2026-11-20" },
        { name: "Far Off Roofing", kind: "coi", date: "2027-03-01" },
        { name: "Lapsed", kind: "coi", date: "2026-09-01" },
      ],
    });
    expect(r.filter((x) => x.kind === "Contractor paperwork").map((x) => x.name)).toEqual([
      "Ace Plumbing's insurance certificate",
      "Bright Electric's license",
    ]);
  });

  it("skips paused bills", () => {
    const r = assembleReminders({
      ...base,
      bills: [
        { name: "Snow removal", next_due_on: "2026-10-15", autopay_arranged: false, paused_at: "2026-04-01T00:00:00Z" },
        { name: "Water", next_due_on: "2026-10-15", autopay_arranged: false, paused_at: null },
      ],
    });
    expect(r.filter((x) => x.kind === "Bill to pay by hand").map((x) => x.name)).toEqual(["Water"]);
  });
});
