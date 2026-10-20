import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { askBarState, DEFAULT_MILES, findHref, joinWords, NO_WANTS, parseMiles, parseMinRating, parseMinReviews, parseOpenNow, parseWants, toggleWant } from "@/lib/contractors/find-params";
import { googleCacheKey } from "@/lib/contractors/found";

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

describe("how far to look", () => {
  it("accepts any whole number of miles from 1 to 100 and holds the rest to the range", () => {
    expect(parseMiles("5")).toBe(5);
    expect(parseMiles("37")).toBe(37);
    expect(parseMiles("100")).toBe(100);
    expect(parseMiles("250")).toBe(100);
    expect(parseMiles(25)).toBe(25);
    expect(parseMiles(["60", "5"])).toBe(60);
  });

  it("falls back to the usual 20 for anything that isn't a distance", () => {
    expect(parseMiles(undefined)).toBe(DEFAULT_MILES);
    expect(parseMiles("")).toBe(DEFAULT_MILES);
    expect(parseMiles("far")).toBe(DEFAULT_MILES);
    expect(parseMiles("0")).toBe(DEFAULT_MILES);
    expect(parseMiles("-3")).toBe(DEFAULT_MILES);
  });

  it("is in the link only when it isn't the usual distance", () => {
    expect(findHref({ trade: "plumbing", miles: 20 })).toBe("/repairs/find?trade=plumbing");
    expect(findHref({ trade: "plumbing", miles: 5 })).toBe("/repairs/find?trade=plumbing&miles=5");
  });

  it("gives each distance its own saved-results key, all marked as carrying opening hours", () => {
    expect(googleCacheKey("Plumber", 41.9, -87.7).location_key).toBe("41.900,-87.700|hrs");
    expect(googleCacheKey("Plumber", 41.9, -87.7, 15).location_key).toBe("41.900,-87.700|hrs");
    expect(googleCacheKey("Plumber", 41.9, -87.7, 5).location_key).toBe("41.900,-87.700|5mi|hrs");
  });
});

describe("narrowing the results", () => {
  it("accepts only the offered minimums and treats anything else as none", () => {
    expect([0.5, 3.5, 4, 5].map((v) => parseMinRating(String(v)))).toEqual([0.5, 3.5, 4, 5]);
    expect(parseMinRating("5.5")).toBe(3.5);
    expect(parseMinRating("3.3")).toBe(3.5);
    expect(parseMinRating(undefined)).toBe(3.5);
    expect(parseMinRating("0")).toBe(0);
    expect([10, 25, 50].map((v) => parseMinReviews(String(v)))).toEqual([10, 25, 50]);
    expect(parseMinReviews("7")).toBe(10);
    expect(parseMinReviews(undefined)).toBe(10);
    expect(parseMinReviews("0")).toBe(0);
    expect(findHref({ trade: "plumbing", minRating: 0, minReviews: 0 })).toBe("/repairs/find?trade=plumbing&rating=0&reviews=0");
    expect(findHref({ trade: "plumbing", minRating: 3.5, minReviews: 10 })).toBe("/repairs/find?trade=plumbing");
  });

  it("reads open-now only from open=1", () => {
    expect(parseOpenNow("1")).toBe(true);
    expect(parseOpenNow("0")).toBe(false);
    expect(parseOpenNow(undefined)).toBe(false);
  });

  it("puts the minimums in the link only when they are set", () => {
    expect(findHref({ trade: "plumbing", minRating: 3.5, minReviews: 10, open: false })).toBe("/repairs/find?trade=plumbing");
    expect(findHref({ trade: "plumbing", minRating: 0, minReviews: 0 })).toBe("/repairs/find?trade=plumbing&rating=0&reviews=0");
    expect(findHref({ trade: "plumbing", minRating: 4, minReviews: 25, open: true })).toBe("/repairs/find?trade=plumbing&rating=4&reviews=25&open=1");
  });
});
