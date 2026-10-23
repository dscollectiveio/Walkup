import { describe, expect, it } from "vitest";
import { TIP_SET_COUNT, TIP_SET_SIZE, tipSet, USAGE_TIPS } from "@/lib/auth/usage-tips";

describe("the sign-in tips", () => {
  it("has thirty tips in six sets of five", () => {
    expect(USAGE_TIPS).toHaveLength(30);
    expect(TIP_SET_SIZE).toBe(5);
    expect(TIP_SET_COUNT).toBe(6);
  });

  it("gives every tip its own title, and writes them with no em dashes", () => {
    expect(new Set(USAGE_TIPS.map((t) => t.title)).size).toBe(USAGE_TIPS.length);
    for (const t of USAGE_TIPS) {
      expect(`${t.title} ${t.body}`).not.toContain("—");
      expect(t.title.length).toBeGreaterThan(8);
      expect(t.body.length).toBeGreaterThan(30);
      expect(t.body.length).toBeLessThan(230);
    }
  });

  it("shows five per set, covers every tip once, and wraps around", () => {
    const seen = Array.from({ length: TIP_SET_COUNT }, (_, n) => tipSet(n)).flat();
    expect(seen).toEqual([...USAGE_TIPS]);
    for (let n = 0; n < TIP_SET_COUNT; n++) expect(tipSet(n)).toHaveLength(5);
    expect(tipSet(TIP_SET_COUNT)).toEqual(tipSet(0));
    expect(tipSet(-1)).toEqual(tipSet(TIP_SET_COUNT - 1));
  });
});
