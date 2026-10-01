import { describe, expect, it } from "vitest";
import { axisMoney, niceAxis } from "@/components/home/charts/axis";

describe("niceAxis", () => {
  it("lands every tick on a round number and covers the data", () => {
    const a = niceAxis(0, 4_812_00);
    expect(a.ticks).toEqual([0, 200_000, 400_000, 600_000]);
    expect(a.lo).toBe(0);
    expect(a.hi).toBeGreaterThanOrEqual(4_812_00);
  });

  it("includes negatives when the data does", () => {
    const a = niceAxis(-3_200_00, 9_000_00);
    expect(a.lo).toBeLessThanOrEqual(-3_200_00);
    expect(a.hi).toBeGreaterThanOrEqual(9_000_00);
    expect(a.ticks).toContain(0);
  });

  it("still gives a span for a flat or empty series", () => {
    expect(niceAxis(5_000_00, 5_000_00).ticks.length).toBeGreaterThan(1);
    expect(niceAxis(0, 0).ticks.length).toBeGreaterThan(1);
  });

  it("ticks are strictly ascending", () => {
    const t = niceAxis(0, 123_456_00).ticks;
    expect(t.every((v, i) => i === 0 || v > t[i - 1])).toBe(true);
  });
});

describe("axisMoney", () => {
  it("compacts dollars for tight axis labels", () => {
    expect(axisMoney(0)).toBe("$0");
    expect(axisMoney(800_00)).toBe("$800");
    expect(axisMoney(1_500_00)).toBe("$1.5k");
    expect(axisMoney(12_000_00)).toBe("$12k");
    expect(axisMoney(2_400_000_00)).toBe("$2.4M");
    expect(axisMoney(-3_000_00)).toBe("−$3k");
  });
});
