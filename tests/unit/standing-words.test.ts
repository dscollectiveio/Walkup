import { describe, expect, it } from "vitest";
import { STANDING_LABEL, sortByStanding, standingOf, type StandingFigures } from "@/lib/access/standing-words";

const row = (o: Partial<StandingFigures> = {}): StandingFigures => ({
  owed: "0.00",
  overdue: "0.00",
  credit: "0.00",
  net: "0.00",
  open_charges: 0,
  oldest_overdue_on: null,
  ...o,
});

describe("standingOf", () => {
  it("is behind when anything is overdue, however small", () => {
    expect(standingOf(row({ owed: "750.00", overdue: "750.00" })).state).toBe("behind");
    expect(standingOf(row({ owed: "0.01", overdue: "0.01" })).state).toBe("behind");
  });

  it("owes without being behind when a charge is open but not yet due", () => {
    expect(standingOf(row({ owed: "500.00", overdue: "0.00" })).state).toBe("owes");
  });

  it("is current at zero and paid ahead with a credit", () => {
    expect(standingOf(row()).state).toBe("current");
    expect(standingOf(row({ credit: "120.00", net: "-120.00" })).state).toBe("ahead");
  });

  it("compares whole cents, not floats", () => {
    expect(standingOf(row({ owed: "1234.56", overdue: "1234.56" })).overdueCents).toBe(123456);
    expect(standingOf(row({ credit: "0.10" })).creditCents).toBe(10);
  });

  it("refuses money that did not cross the boundary as text", () => {
    expect(() => standingOf(row({ overdue: 12.5 as unknown as string }))).toThrow(/text/);
  });

  it("has a plain label for every state, with no em dash", () => {
    for (const s of ["behind", "owes", "current", "ahead"] as const) {
      expect(STANDING_LABEL[s]).toBeTruthy();
      expect(STANDING_LABEL[s]).not.toContain("—");
    }
  });
});

describe("sortByStanding", () => {
  it("puts the units that are behind first, oldest overdue first, and keeps the rest in the order given", () => {
    const rows = [
      { id: "a", ...row() },
      { id: "b", ...row({ owed: "100.00", overdue: "100.00", oldest_overdue_on: "2026-05-01" }) },
      { id: "c", ...row({ owed: "50.00" }) },
      { id: "d", ...row({ owed: "900.00", overdue: "900.00", oldest_overdue_on: "2026-02-01" }) },
      { id: "e", ...row({ owed: "20.00", overdue: "20.00", oldest_overdue_on: null }) },
    ];
    expect(sortByStanding(rows).map((r) => r.id)).toEqual(["d", "b", "e", "a", "c"]);
  });

  it("does not change the list it is given", () => {
    const rows = [{ id: "a", ...row() }, { id: "b", ...row({ overdue: "1.00", owed: "1.00" }) }];
    sortByStanding(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
