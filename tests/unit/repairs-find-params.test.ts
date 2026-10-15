import { describe, expect, it } from "vitest";
import { askBarState, findHref, joinWords, NO_WANTS, parseWants, toggleWant } from "@/lib/contractors/find-params";

describe("find page wants (repairs-spec §9.1)", () => {
  it("defaults an urgent job to emergency, and only when no want is in the URL", () => {
    expect(parseWants(undefined, true)).toEqual(["emergency"]);
    expect(parseWants(undefined, false)).toEqual([]);
    expect(parseWants(NO_WANTS, true)).toEqual([]);
    expect(parseWants("small_jobs", true)).toEqual(["small_jobs"]);
  });

  it("keeps the fixed order and drops unknown values", () => {
    expect(parseWants(["free_estimates", "bogus", "emergency"], false)).toEqual(["emergency", "free_estimates"]);
  });

  it("toggles a want on and off in the fixed order", () => {
    expect(toggleWant(["free_estimates"], "condo_work")).toEqual(["condo_work", "free_estimates"]);
    expect(toggleWant(["condo_work", "free_estimates"], "condo_work")).toEqual(["free_estimates"]);
  });

  it("writes want=none when every want is switched off, so the urgent default stays off", () => {
    const href = findHref({ ticket: "t1", trade: "plumbing", wants: [] });
    expect(href).toBe("/repairs/find?ticket=t1&trade=plumbing&want=none");
    expect(parseWants(new URLSearchParams(href.split("?")[1]).getAll("want"), true)).toEqual([]);
  });

  it("drops empty values and leaves wants out when not given", () => {
    expect(findHref({ task: "k1", trade: "gutters", phrase: "", wants: null })).toBe("/repairs/find?task=k1&trade=gutters");
    expect(findHref({ trade: "hvac", phrase: "boiler service", wants: ["emergency", "small_jobs"] })).toBe(
      "/repairs/find?trade=hvac&phrase=boiler+service&want=emergency&want=small_jobs",
    );
  });
});

describe("the ask bar", () => {
  it("asks up to five for quotes on a problem", () => {
    expect(askBarState(0, true)).toEqual({ label: "Ask 0 for quotes", disabled: true, note: null });
    expect(askBarState(5, true)).toEqual({ label: "Ask 5 for quotes", disabled: false, note: null });
    expect(askBarState(6, true)).toEqual({ label: "Ask 6 for quotes", disabled: true, note: "Pick up to 5." });
  });

  it("saves without a problem", () => {
    expect(askBarState(3, false)).toEqual({ label: "Save 3 to your contractors", disabled: false, note: null });
  });

  it("joins words with commas and 'and'", () => {
    expect(joinWords(["a"])).toBe("a");
    expect(joinWords(["a", "b", "c"])).toBe("a, b and c");
  });
});
