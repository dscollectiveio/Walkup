import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google Places requests (repairs-spec §9.2) with fetch mocked: the request
 * shape Text Search (New) expects, unsorted operating results, and every
 * network failure turned into GoogleUnavailableError (map bug 12).
 */

vi.mock("server-only", () => ({}));

import { geocode, GoogleUnavailableError, placeDetails, searchNearby } from "@/lib/google/places";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.GOOGLE_PLACES_KEY = "test-key";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_PLACES_KEY;
});

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe("searchNearby", () => {
  it("sends the query, 20 results, a circle bias and the Table A type; never the city", async () => {
    fetchMock.mockResolvedValue(json({ places: [] }));
    await searchNearby("plumber", 41.92, -87.68, { includedType: "plumber" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      textQuery: "plumber",
      pageSize: 20,
      locationBias: { circle: { center: { latitude: 41.92, longitude: -87.68 }, radius: 16_000 } },
      includedType: "plumber",
    });
    expect(init.headers["X-Goog-Api-Key"]).toBe("test-key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("omits includedType for trades Google has no type for", async () => {
    fetchMock.mockResolvedValue(json({ places: [] }));
    await searchNearby("HVAC contractor", 41.92, -87.68);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("includedType");
  });

  it("returns operating businesses in Google's order, with their status", async () => {
    fetchMock.mockResolvedValue(
      json({
        places: [
          { id: "a", displayName: { text: "A" }, rating: 4.1, userRatingCount: 10, businessStatus: "OPERATIONAL" },
          { id: "b", displayName: { text: "B" }, rating: 5, userRatingCount: 900, businessStatus: "CLOSED_PERMANENTLY" },
          { id: "c", displayName: { text: "C" }, rating: 4.9, userRatingCount: 400 },
        ],
      }),
    );
    const r = await searchNearby("plumber", 1, 2);
    expect(r.map((p) => p.placeId)).toEqual(["a", "c"]);
    expect(r[0].businessStatus).toBe("OPERATIONAL");
    expect(r[1].businessStatus).toBeNull();
  });

  it("turns a network failure, a timeout and a bad status into GoogleUnavailableError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(searchNearby("plumber", 1, 2)).rejects.toBeInstanceOf(GoogleUnavailableError);
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    await expect(placeDetails("abc")).rejects.toBeInstanceOf(GoogleUnavailableError);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(geocode("2158 N Damen Ave, Chicago, IL")).rejects.toBeInstanceOf(GoogleUnavailableError);
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(searchNearby("plumber", 1, 2)).rejects.toBeInstanceOf(GoogleUnavailableError);
  });

  it("refuses to run without a key", async () => {
    delete process.env.GOOGLE_PLACES_KEY;
    await expect(searchNearby("plumber", 1, 2)).rejects.toBeInstanceOf(GoogleUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("placeDetails", () => {
  it("returns rating, count, phone, website and status", async () => {
    fetchMock.mockResolvedValue(
      json({ id: "abc", rating: 4.6, userRatingCount: 88, nationalPhoneNumber: "(312) 555-0142", websiteUri: "https://acme.example/", businessStatus: "OPERATIONAL" }),
    );
    expect(await placeDetails("abc")).toEqual({
      rating: 4.6, reviewCount: 88, phone: "(312) 555-0142", website: "https://acme.example/", businessStatus: "OPERATIONAL",
    });
  });
});
