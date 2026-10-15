import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { googleMapsUrl, isStale, milesBetween, sortByWeightedRating, type PlaceResult } from "@/lib/google/places";
import {
  SEARCHABLE_TRADES, TRADE_SLUGS, TRADES, guessTradeFromText, isTradeSlug, tradeBySlug, tradeLabel,
} from "@/lib/contractors/trades";

const place = (id: string, rating: number | null, reviewCount: number | null): PlaceResult => ({
  placeId: id, name: id, address: null, phone: null, website: null, rating, reviewCount, latitude: null, longitude: null,
});

describe("Google places helpers", () => {
  it("sorts by review-count-weighted rating, unrated last", () => {
    const sorted = sortByWeightedRating([place("a", 4.5, 10), place("b", 4.8, 3), place("c", 4.5, 200), place("d", null, null)]);
    // 4.8 from 3 reviews no longer outranks 4.5 from 200.
    expect(sorted.map((p) => p.placeId)).toEqual(["c", "a", "b", "d"]);
    // 5.0 from one review sits near the prior; 4.8 from 900 wins.
    expect(sortByWeightedRating([place("one", 5, 1), place("many", 4.8, 900)]).map((p) => p.placeId)).toEqual(["many", "one"]);
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
  it("has 30 trades with unique slugs and leaves Other out of search", () => {
    expect(TRADES).toHaveLength(30);
    expect(new Set(TRADES.map((t) => t.slug)).size).toBe(TRADES.length);
    expect(TRADE_SLUGS).toEqual(TRADES.map((t) => t.slug));
    expect(SEARCHABLE_TRADES.some((t) => t.slug === "other")).toBe(false);
    expect(SEARCHABLE_TRADES).toHaveLength(29);
    expect(tradeLabel("hvac")).toBe("Heating & cooling");
    expect(tradeLabel("dryer_vent")).toBe("Dryer vent cleaning");
    expect(isTradeSlug("plumbing")).toBe(true);
    expect(isTradeSlug("astrology")).toBe(false);
    expect(tradeBySlug("backflow")?.licenseTypical).toBe(true);
  });

  it("keeps the 15 original slugs", () => {
    for (const slug of ["plumbing", "electrical", "hvac", "roofing", "masonry", "general", "painting", "carpentry",
      "landscaping", "snow", "cleaning", "pest", "locksmith", "appliance", "other"]) {
      expect(isTradeSlug(slug)).toBe(true);
    }
  });

  it("sets placesType only on the five types Google's Table A has", () => {
    const typed = Object.fromEntries(TRADES.filter((t) => t.placesType).map((t) => [t.slug, t.placesType]));
    expect(typed).toEqual({
      plumbing: "plumber", electrical: "electrician", roofing: "roofing_contractor", painting: "painter", locksmith: "locksmith",
    });
  });

  it("only relates trades to real trades", () => {
    for (const t of TRADES) for (const r of t.related) expect(isTradeSlug(r)).toBe(true);
    expect(tradeBySlug("plumbing")?.related).toEqual(["sewer", "backflow"]);
  });

  it("ships with no license lookup links: none have been verified", () => {
    expect(TRADES.every((t) => t.licenseLookupUrl === undefined)).toBe(true);
  });
});

describe("guessTradeFromText", () => {
  it.each([
    ["floor drain backing up", "plumbing"],
    ["water heater pilot", "plumbing"],
    ["Water heater pilot is out", "plumbing"],
    ["lights out in hallway", "electrical"],
    ["Backflow test certificate", "backflow"],
    ["Main line needs rodding", "sewer"],
    ["Dryer vent clogged", "dryer_vent"],
    ["Smoke detectors in the hall", "fire_safety"],
    ["Clean the gutters", "gutters"],
    ["Chimney flue cracked", "chimney"],
    ["Elevator operator", "elevator"],
    ["Garage door won't close", "garage_door"],
    ["Basement seeping after rain", "waterproofing"],
    ["Branch over the roof", "tree"],
    ["Cracked window glass", "windows"],
    ["Loose tiles in the lobby", "flooring"],
    ["Front steps crumbling", "concrete"],
    ["No heat in unit 2", "hvac"],
    ["Air conditioning dead", "hvac"],
    ["Roofing leak over unit 3", "roofing"],
    ["Tuckpointing on the north wall", "masonry"],
    ["Kitchen tap dripping", "plumbing"],
    ["Sparking outlet", "electrical"],
    ["Painting the stairwell", "painting"],
    ["Cabinet door hinge", "carpentry"],
    ["Lost my keys", "locksmith"],
    ["Mice in the basement", "pest"],
    ["Icy sidewalk", "concrete"],
    ["Ice on the walk", "snow"],
    ["Mulch the beds", "landscaping"],
    ["Janitorial service", "cleaning"],
    ["Fridge not cooling", "appliance"],
    ["Sagging floor joists", "engineer"],
  ])("%s -> %s", (text, slug) => {
    expect(guessTradeFromText(text)).toBe(slug);
  });

  it.each([
    ["separate the bins", "pest"],
    ["elevator operator", "pest"],
    ["notice on the door", "snow"],
    ["office chair", "snow"],
    ["service call", "snow"],
    ["duct tape", "plumbing"],
    ["block party", "locksmith"],
    ["flight of stairs", "electrical"],
    ["monkey bars", "locksmith"],
    ["floor drain backing up", "flooring"],
  ])("%s is never %s", (text, wrong) => {
    expect(guessTradeFromText(text)).not.toBe(wrong);
  });

  it("returns null when nothing matches", () => {
    for (const text of ["separate the bins", "office chair", "service call", "duct tape", "block party", "flight of stairs", "monkey bars", "", "Wheat paste removal"]) {
      expect(guessTradeFromText(text)).toBeNull();
    }
  });
});
