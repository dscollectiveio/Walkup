import { describe, expect, it } from "vitest";
import { daysSince } from "@/lib/plaid/books-start";

const today = new Date("2026-11-12T12:00:00Z");

describe("daysSince", () => {
  it("asks for the full two years when no date is given or it can't be read", () => {
    expect(daysSince(undefined, today)).toBe(730);
    expect(daysSince("", today)).toBe(730);
    expect(daysSince("last spring", today)).toBe(730);
  });

  it("counts the days from the books start to today", () => {
    expect(daysSince("2026-01-01", today)).toBe(316);
  });

  it("never asks for more than two years or fewer than a month", () => {
    expect(daysSince("2015-01-01", today)).toBe(730);
    expect(daysSince("2026-11-10", today)).toBe(30);
  });
});
