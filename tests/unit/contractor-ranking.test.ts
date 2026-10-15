import { describe, expect, it } from "vitest";
import {
  bayesianRating, BOARD_PRIOR, GOOGLE_PRIOR, mergeFound, rankFound, rankSaved, ratingComponent, WEIGHTS,
  type FoundCandidate, type RankContext, type SavedCandidate,
} from "@/lib/contractors/ranking";

const CTX: RankContext = { trade: "plumbing", relatedTrades: ["sewer", "backflow"], urgent: false, wants: [], todayIso: "2026-10-14" };

const found = (id: string, over: Partial<FoundCandidate> = {}): FoundCandidate => ({
  kind: "google", candidateId: `g:${id}`, name: id, address: null, cityText: null, phone: null, email: null, website: null,
  rating: null, reviewCount: null, ratingSource: "Google", ratingAsOf: "2026-10-12T10:00:00Z", distanceMiles: null,
  flags: { emergencyService: null, condoWork: null, smallJobs: null, freeEstimates: null },
  placeId: id, sourceUrls: [], snippet: null, alreadySaved: null, ...over,
});

const saved = (id: string, over: Partial<SavedCandidate> = {}): SavedCandidate => ({
  kind: "saved", vendorId: id, name: id, trades: ["plumbing"], status: "okay", phone: null, email: null, website: null,
  googleRating: null, googleReviewCount: null, boardReviews: { count: 0, average: null, tags: {} }, boardRating: null,
  jobs: 0, lastUsedOn: null, emergencyService: false, jobTags: [],
  rates: { hourly: null, tripFee: null, afterHours: null, asOf: null },
  compliance: { coiCurrent: false, coiExpired: false, licenseOnFile: false, w9OnFile: false },
  distanceMiles: null, ...over,
});

describe("bayesianRating", () => {
  it("pulls thin ratings toward the prior", () => {
    expect(bayesianRating(5, 1, GOOGLE_PRIOR)).toBeCloseTo(91 / 21, 6);
    expect(bayesianRating(4.8, 900, GOOGLE_PRIOR)).toBeCloseTo(4406 / 920, 6);
    expect(bayesianRating(null, 50, GOOGLE_PRIOR)).toBeNull();
  });

  it("a rating with no reviews behind it is unrated; bad inputs never give NaN or more than 5 stars (REVIEW-4 #15)", () => {
    expect(bayesianRating(1, 0, BOARD_PRIOR)).toBeNull();
    expect(bayesianRating(4, null, BOARD_PRIOR)).toBeNull();
    expect(bayesianRating(4, -3, BOARD_PRIOR)).toBeNull();
    expect(bayesianRating(4, Number.POSITIVE_INFINITY, BOARD_PRIOR)).toBeNull();
    expect(bayesianRating(4, Number.NaN, BOARD_PRIOR)).toBeNull();
    expect(bayesianRating(7, 1e9, GOOGLE_PRIOR)!).toBeLessThanOrEqual(5);
    expect(bayesianRating(-2, 1e9, GOOGLE_PRIOR)!).toBeGreaterThanOrEqual(1);
    // a one-star contractor with no reviews no longer outranks an unrated one
    expect(ratingComponent(bayesianRating(1, 0, BOARD_PRIOR))).toBe(0.3);
  });

  it("ratingComponent clamps and gives unrated 0.3", () => {
    expect(ratingComponent(null)).toBe(0.3);
    expect(ratingComponent(3)).toBe(0);
    expect(ratingComponent(5)).toBe(1);
    expect(ratingComponent(4.25)).toBeCloseTo(0.5, 6);
  });
});

describe("rankFound: the worked example", () => {
  const a = found("A", { rating: 5, reviewCount: 1, distanceMiles: 2 });
  const b = found("B", { rating: 4.8, reviewCount: 900, distanceMiles: 6 });
  const c = found("C", { rating: 4.6, reviewCount: 40, distanceMiles: 1 });

  it("scores 56.9, 60.5 and 60.7, so C and B rank above A", () => {
    const ranked = rankFound([a, b, c], CTX);
    const score = (id: string) => ranked.find((r) => r.name === id)!.score.toFixed(1);
    expect(score("A")).toBe("56.9");
    expect(score("B")).toBe("60.5");
    expect(score("C")).toBe("60.7");
    expect(ranked.map((r) => r.name)).toEqual(["C", "B", "A"]);
  });

  it("adds the emergency term once, whether urgent or asked for", () => {
    const e = found("E", { rating: 4.6, reviewCount: 40, distanceMiles: 1, flags: { emergencyService: true, condoWork: null, smallJobs: null, freeEstimates: null } });
    const base = rankFound([e], CTX)[0].score;
    expect(rankFound([e], { ...CTX, urgent: true })[0].score - base).toBeCloseTo(WEIGHTS.emergency, 6);
    expect(rankFound([e], { ...CTX, wants: ["emergency"] })[0].score - base).toBeCloseTo(WEIGHTS.wanted, 6);
    expect(rankFound([e], { ...CTX, urgent: true, wants: ["emergency"] })[0].score - base).toBeCloseTo(WEIGHTS.emergency, 6);
  });

  it("adds the wanted term only for verified flags", () => {
    const yes = found("Y", { flags: { emergencyService: null, condoWork: true, smallJobs: false, freeEstimates: true } });
    const base = rankFound([yes], CTX)[0].score;
    const wanted = rankFound([yes], { ...CTX, wants: ["condo_work", "small_jobs", "free_estimates"] })[0];
    expect(wanted.score - base).toBeCloseTo(2 * WEIGHTS.wanted, 6);
    expect(wanted.why.map((w) => w.text)).toEqual(expect.arrayContaining(["Mentions condo work", "Free estimates"]));
    expect(wanted.why.map((w) => w.text)).not.toContain("Small jobs welcome");
  });

  it("breaks ties on review count, then name", () => {
    const ranked = rankFound([found("Zed", { rating: 4.5, reviewCount: 10 }), found("Amy", { rating: 4.5, reviewCount: 10 }), found("Max", { rating: 4.5, reviewCount: 10 })], CTX);
    expect(ranked.map((r) => r.name)).toEqual(["Amy", "Max", "Zed"]);
  });
});

describe("why chips", () => {
  it("found results say the search matched, never that they do the trade", () => {
    const r = rankFound([found("B", { rating: 4.8, reviewCount: 1200, distanceMiles: 6 })], CTX)[0];
    expect(r.why).toEqual([
      { key: "trade", text: 'Came up for "Plumbing"', tone: "neutral" },
      { key: "rating", text: "Google 4.8 from 1,200 reviews, as listed on Mon, Oct 12", tone: "neutral" },
      { key: "distance", text: "6 mi away", tone: "neutral" },
    ]);
    expect(r.why.some((w) => w.text.startsWith("Does "))).toBe(false);
  });

  it("web results without a rating or distance show what was verified", () => {
    const r = rankFound([found("W", {
      kind: "web", candidateId: "w:row:0", ratingSource: null, cityText: "Evanston, IL", website: "https://www.wplumbing.com/about",
      sourceUrls: ["https://www.wplumbing.com/about"],
    })], CTX)[0];
    expect(r.why.map((w) => w.text)).toEqual(['Came up for "Plumbing"', "No rating found", "Evanston, IL", "Found on wplumbing.com"]);
  });

  it("a do-not-use match comes first, gets nothing beyond the trade and sorts last", () => {
    const dnu = found("Bad Pipes", {
      rating: 5, reviewCount: 2000, distanceMiles: 0.5,
      alreadySaved: { vendorId: "v9", status: "do_not_use", doNotUseReason: "Left the job half done", archived: false },
    });
    const other = found("Ok Pipes", { rating: 3.6, reviewCount: 3, distanceMiles: 14 });
    const ranked = rankFound([dnu, other], CTX);
    expect(ranked.map((r) => r.name)).toEqual(["Ok Pipes", "Bad Pipes"]);
    const bad = ranked[1];
    expect(bad.score).toBe(WEIGHTS.trade);
    expect(bad.why[0]).toEqual({ key: "do_not_use", text: "Your board marked them do not use: Left the job half done", tone: "bad" });
  });

  it("saved chips in order, at most five", () => {
    const s = saved("Acme", {
      status: "preferred", jobs: 3, lastUsedOn: "2026-09-14", googleRating: 4.7, googleReviewCount: 310, distanceMiles: 2.34,
      boardReviews: { count: 2, average: 4.5, tags: { would_hire_again: 2 } },
      compliance: { coiCurrent: true, coiExpired: false, licenseOnFile: true, w9OnFile: true },
    });
    const r = rankSaved([s], CTX)[0];
    expect(r.why.map((w) => w.text)).toEqual([
      "Does Plumbing",
      "Preferred by your board",
      "Used 3 times, last Sep 2026",
      "Your board: 4.5 from 2 reviews",
      "Your board: would hire again (2)",
    ]);
    const plain = rankSaved([saved("Bob", { trades: ["sewer"], jobs: 1, lastUsedOn: "2026-01-02", googleRating: 4.2, googleReviewCount: 1,
      compliance: { coiCurrent: false, coiExpired: true, licenseOnFile: false, w9OnFile: false } })], CTX)[0];
    expect(plain.why).toEqual([
      { key: "related_trade", text: "Also does Sewer rodding & drains", tone: "neutral" },
      { key: "used_before", text: "Used 1 time, last Jan 2026", tone: "good" },
      { key: "rating", text: "Google 4.2 from 1 review", tone: "neutral" },
      { key: "coi", text: "Certificate expired", tone: "warning" },
    ]);
  });
});

describe("rankSaved scoring", () => {
  it("adds each term", () => {
    const bare = saved("Bare", { trades: ["roofing"] });
    // No trade match, unrated (0.3), no distance (0.5).
    expect(rankSaved([bare], CTX)[0].score).toBeCloseTo(WEIGHTS.rating * 0.3 + WEIGHTS.distance * 0.5, 6);

    const full = saved("Full", {
      status: "preferred", jobs: 2, emergencyService: true, jobTags: ["condo_work"], distanceMiles: 0,
      boardReviews: { count: 4, average: 5, tags: {} },
      compliance: { coiCurrent: true, coiExpired: false, licenseOnFile: true, w9OnFile: true },
    });
    const expected = WEIGHTS.trade
      + WEIGHTS.rating * ratingComponent(bayesianRating(5, 4, BOARD_PRIOR))
      + WEIGHTS.distance
      + WEIGHTS.preferred + WEIGHTS.usedBefore + WEIGHTS.boardLoved
      + WEIGHTS.coi + WEIGHTS.license + WEIGHTS.w9
      + WEIGHTS.emergency + WEIGHTS.wanted;
    expect(rankSaved([full], { ...CTX, urgent: true, wants: ["condo_work"] })[0].score).toBeCloseTo(expected, 6);
  });

  it("uses board reviews, then the board's own rating, then Google", () => {
    const withReviews = saved("R", { boardReviews: { count: 3, average: 3.9, tags: {} }, boardRating: 1, googleRating: 5, googleReviewCount: 500 });
    const withBoardRating = saved("B", { boardRating: 4, googleRating: 5, googleReviewCount: 500 });
    const googleOnly = saved("G", { googleRating: 4.6, googleReviewCount: 60 });
    const term = (s: SavedCandidate) => rankSaved([s], CTX)[0].score - WEIGHTS.trade - WEIGHTS.distance * 0.5;
    expect(term(withReviews)).toBeCloseTo(WEIGHTS.rating * ratingComponent(bayesianRating(3.9, 3, BOARD_PRIOR)), 6);
    expect(term(withBoardRating)).toBeCloseTo(WEIGHTS.rating * ratingComponent(bayesianRating(4, 1, BOARD_PRIOR)), 6);
    expect(term(googleOnly)).toBeCloseTo(WEIGHTS.rating * ratingComponent(bayesianRating(4.6, 60, GOOGLE_PRIOR)), 6);
  });

  it("an expired certificate subtracts nothing", () => {
    const a = saved("A");
    const b = saved("B", { compliance: { coiCurrent: false, coiExpired: true, licenseOnFile: false, w9OnFile: false } });
    expect(rankSaved([a], CTX)[0].score).toBe(rankSaved([b], CTX)[0].score);
  });
});

describe("mergeFound", () => {
  const webFlags = { emergencyService: true, condoWork: true, smallJobs: null, freeEstimates: false };

  it("merges by website host", () => {
    const g = found("Acme Plumbing", { website: "https://acmeplumbing.com/", sourceUrls: [] , rating: 4.7, reviewCount: 100 });
    const w = found("ACME Plumbing Co", { kind: "web", candidateId: "w:1:0", website: "https://www.acmeplumbing.com/services", email: "hi@acmeplumbing.com",
      sourceUrls: ["https://www.acmeplumbing.com/services"], flags: webFlags, rating: 4.9, reviewCount: 12 });
    const merged = mergeFound([g], [w]);
    expect(merged).toHaveLength(1);
    expect(merged[0].candidateId).toBe("g:Acme Plumbing");
    expect(merged[0].rating).toBe(4.7);
    expect(merged[0].email).toBe("hi@acmeplumbing.com");
    expect(merged[0].sourceUrls).toEqual(["https://www.acmeplumbing.com/services"]);
    expect(merged[0].flags).toEqual({ emergencyService: true, condoWork: true, smallJobs: null, freeEstimates: false });
  });

  it("merges by phone digits and by normalised name; keeps the rest", () => {
    const g1 = found("North Side Drains", { phone: "(312) 555-0101" });
    const g2 = found("Smith & Sons Plumbing, LLC");
    const w1 = found("NSD", { kind: "web", candidateId: "w:1:0", phone: "312.555.0101" });
    const w2 = found("The Smith and Sons Plumbing", { kind: "web", candidateId: "w:1:1" });
    const w3 = found("Elsewhere Plumbing", { kind: "web", candidateId: "w:1:2" });
    const merged = mergeFound([g1, g2], [w1, w2, w3]);
    expect(merged.map((m) => m.candidateId)).toEqual(["g:North Side Drains", "g:Smith & Sons Plumbing, LLC", "w:1:2"]);
  });

  it("doesn't change its inputs", () => {
    const g = found("Acme", { website: "https://acme.com", sourceUrls: ["https://maps.google.com/x"] });
    const w = found("Acme", { kind: "web", candidateId: "w:1:0", sourceUrls: ["https://acme.com/a"] });
    mergeFound([g], [w]);
    expect(g.sourceUrls).toEqual(["https://maps.google.com/x"]);
  });
});
