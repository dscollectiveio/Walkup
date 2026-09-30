import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { googleMapsUrl, isStale, milesBetween, sortByRating, type PlaceResult } from "@/lib/google/places";
import { SEARCHABLE_TRADES, TRADES, isTradeSlug, tradeLabel } from "@/lib/contractors/trades";

const place = (id: string, rating: number | null, reviewCount: number | null): PlaceResult => ({
  placeId: id, name: id, address: null, phone: null, website: null, rating, reviewCount, latitude: null, longitude: null,
});

describe("Google places helpers", () => {
  it("sorts by rating, then by how many reviews back it up, unrated last", () => {
    const sorted = sortByRating([place("a", 4.5, 10), place("b", 4.8, 3), place("c", 4.5, 200), place("d", null, null)]);
    expect(sorted.map((p) => p.placeId)).toEqual(["b", "c", "a", "d"]);
  });

  it("measures straight-line miles", () => {
    // Wicker Park to the Loop is roughly three miles.
    const miles = milesBetween(41.9088, -87.6796, 41.8837, -87.6278);
    expect(miles).toBeGreaterThan(2.5);
    expect(miles).toBeLessThan(3.5);
  });

  it("treats Google data older than 30 days as stale", () => {
    const now = new Date("2026-09-30T00:00:00Z");
    expect(isStale(null, now)).toBe(true);
    expect(isStale("2026-09-15T00:00:00Z", now)).toBe(false);
    expect(isStale("2026-08-15T00:00:00Z", now)).toBe(true);
    expect(isStale("2026-09-29T12:00:00Z", now, 1)).toBe(false);
  });

  it("builds the See on Google link from the place id", () => {
    expect(googleMapsUrl("ChIJ abc")).toBe("https://www.google.com/maps/place/?q=place_id:ChIJ%20abc");
  });
});

describe("trade list", () => {
  it("has unique slugs and leaves Other out of search", () => {
    expect(new Set(TRADES.map((t) => t.slug)).size).toBe(TRADES.length);
    expect(SEARCHABLE_TRADES.some((t) => t.slug === "other")).toBe(false);
    expect(tradeLabel("hvac")).toBe("Heating & cooling");
    expect(isTradeSlug("plumbing")).toBe(true);
    expect(isTradeSlug("astrology")).toBe(false);
  });

  it("ships with no license lookup links — none have been verified", () => {
    expect(TRADES.every((t) => t.licenseLookupUrl === undefined)).toBe(true);
  });
});
