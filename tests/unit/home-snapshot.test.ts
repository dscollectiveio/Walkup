import { describe, expect, it } from "vitest";
import { buildSnapshot, type SnapshotInput } from "@/lib/home/snapshot";

const today = new Date("2026-09-30T12:00:00");
const empty: SnapshotInput = {
  today,
  owedCents: 0,
  unitsBehind: 0,
  duesByMonth: [],
  bills: [],
  bankConnected: false,
  uncategorizedCount: 0,
  insuranceExpiresOn: null,
};
const tile = (t: ReturnType<typeof buildSnapshot>, key: string) => t.find((x) => x.key === key)!;

describe("buildSnapshot", () => {
  it("on a brand-new account shows only nudges to set things up — no invented numbers", () => {
    const tiles = buildSnapshot(empty);
    expect(tiles.map((t) => t.key)).toEqual(["owed", "bills", "bank", "insurance"]);
    expect(tiles.every((t) => t.value === null)).toBe(true);
    expect(tile(tiles, "owed").href).toBe("/dues");
    expect(tile(tiles, "bank").note).toBe("Not connected yet");
  });

  it("shows dues owed and flags units behind", () => {
    const tiles = buildSnapshot({
      ...empty,
      owedCents: 1_250_00,
      unitsBehind: 2,
      duesByMonth: [{ month: "2026-09-01", chargedCents: 1_050_00, collectedCents: 700_00 }],
    });
    expect(tile(tiles, "owed")).toMatchObject({ value: "$1,250", note: "across 2 units", tone: "attention" });
    expect(tile(tiles, "dues_month")).toMatchObject({ value: "$700 of $1,050", note: "collected so far" });
  });

  it("says everyone is current when nothing is owed", () => {
    const t = buildSnapshot({ ...empty, duesByMonth: [{ month: "2026-09-01", chargedCents: 100_00, collectedCents: 100_00 }] });
    expect(tile(t, "owed")).toMatchObject({ value: "$0", note: "Every unit is current", tone: "good" });
    expect(tile(t, "dues_month").note).toBe("Everyone has paid");
  });

  it("nudges to charge the month when dues exist but this month has none", () => {
    const t = buildSnapshot({ ...empty, duesByMonth: [{ month: "2026-08-01", chargedCents: 100_00, collectedCents: 100_00 }] });
    expect(tile(t, "dues_month")).toMatchObject({ value: null, note: "Not charged yet this month" });
  });

  it("totals only the bills due in the next 30 days, and is honest about varying amounts", () => {
    const t = buildSnapshot({
      ...empty,
      bills: [
        { nextDueOn: "2026-10-05", typicalAmountCents: 120_00 },
        { nextDueOn: "2026-10-20", typicalAmountCents: null },
        { nextDueOn: "2026-12-01", typicalAmountCents: 999_00 },
        { nextDueOn: "2026-09-01", typicalAmountCents: 999_00 },
      ],
    });
    expect(tile(t, "bills")).toMatchObject({ value: "2 bills", note: "about $120, plus some that vary" });
    expect(tile(buildSnapshot({ ...empty, bills: [{ nextDueOn: "2027-01-01", typicalAmountCents: 5_00 }] }), "bills").value).toBe("None due");
  });

  it("reports the bank backlog, or that it's clear", () => {
    expect(tile(buildSnapshot({ ...empty, bankConnected: true, uncategorizedCount: 62 }), "bank")).toMatchObject({
      label: "Needs a category", value: "62", href: "/bank-feed?status=needs", tone: "attention",
    });
    expect(tile(buildSnapshot({ ...empty, bankConnected: true }), "bank")).toMatchObject({ value: "All categorized", tone: "good" });
  });

  it("counts days to the insurance renewal and flags one inside 60 days", () => {
    expect(tile(buildSnapshot({ ...empty, insuranceExpiresOn: "2026-11-15" }), "insurance")).toMatchObject({
      value: "Nov 15", note: "in 46 days", tone: "attention",
    });
    expect(tile(buildSnapshot({ ...empty, insuranceExpiresOn: "2027-06-01" }), "insurance")).toMatchObject({
      value: "Jun 1, 2027", tone: "neutral",
    });
  });
});
