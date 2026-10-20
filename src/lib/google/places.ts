import "server-only";
import { bayesianRating, GOOGLE_PRIOR } from "@/lib/contractors/ranking";

// Google Places API (New) and the Geocoding API, server-side only. The key
// never reaches the browser: this module is server-only and nothing here is
// imported by a client component.

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** About 10 miles. */
export const SEARCH_RADIUS_METERS = 16_000;

export const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.location,places.currentOpeningHours.openNow,places.regularOpeningHours.periods";
export const REFRESH_FIELD_MASK = "rating,userRatingCount,nationalPhoneNumber,websiteUri,businessStatus";

export function googleKey(): string | null {
  const key = process.env.GOOGLE_PLACES_KEY;
  return key && key.trim() !== "" ? key : null;
}

export class GoogleUnavailableError extends Error {}

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  latitude: number | null;
  longitude: number | null;
  /** OPERATIONAL, CLOSED_TEMPORARILY or CLOSED_PERMANENTLY; absent on rows cached before 0053. */
  businessStatus?: string | null;
  /** Open at the moment of the search; null when Google has no hours. Absent on rows cached before hours were asked for. */
  openNow?: boolean | null;
  /** Open around the clock, every day. */
  open24h?: boolean | null;
}

interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  businessStatus?: string;
  location?: { latitude?: number; longitude?: number };
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { periods?: { open?: { day?: number; hour?: number; minute?: number }; close?: unknown }[] };
}

/** Google writes "open 24 hours, every day" as one period that opens Sunday 00:00 and never closes. */
function isOpen24h(p: RawPlace): boolean | null {
  const periods = p.regularOpeningHours?.periods;
  if (!periods || periods.length === 0) return null;
  const only = periods.length === 1 ? periods[0] : null;
  return Boolean(only && !only.close && (only.open?.day ?? 0) === 0 && (only.open?.hour ?? 0) === 0 && (only.open?.minute ?? 0) === 0);
}

function toResult(p: RawPlace): PlaceResult {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "Unnamed business",
    address: p.formattedAddress ?? null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    businessStatus: p.businessStatus ?? null,
    openNow: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null,
    open24h: isOpen24h(p),
  };
}

/** Every Google request gets this long before it counts as "Google didn't answer". */
export const GOOGLE_TIMEOUT_MS = 10_000;
/** Soft daily cap on live Google calls per building (same Chicago day as the AI limits). */
export const GOOGLE_DAILY_LIMIT = 60;

/** fetch, with a timeout, where a network failure or abort is a GoogleUnavailableError (map bug 12). */
async function googleFetch(url: string, init: RequestInit, what: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (cause) {
    throw new GoogleUnavailableError(`${what} didn't answer (${cause instanceof Error ? cause.name : "error"}).`);
  }
}

/**
 * Operating businesses matching the query near a point, as Google returned
 * them (ranking for a job lives in src/lib/contractors/ranking.ts).
 *
 * Request shape per Text Search (New): `pageSize` 1 to 20; `includedType`
 * takes one Table A type and only biases (strictTypeFiltering stays off so a
 * differently categorised business still shows); `locationBias` is a circle
 * (locationRestriction takes only a rectangle and can't be combined with a
 * bias), so the 15-mile limit is enforced by the caller from each result's
 * location; nothing about the location is written into textQuery, which
 * would override the bias.
 */
export async function searchNearby(
  query: string,
  latitude: number,
  longitude: number,
  opts?: { includedType?: string; radiusMeters?: number },
): Promise<PlaceResult[]> {
  const key = googleKey();
  if (!key) throw new GoogleUnavailableError("No Google key configured.");
  const res = await googleFetch(
    TEXT_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: 20,
        locationBias: { circle: { center: { latitude, longitude }, radius: opts?.radiusMeters ?? SEARCH_RADIUS_METERS } },
        ...(opts?.includedType ? { includedType: opts.includedType } : {}),
      }),
    },
    "Places search",
  );
  if (!res.ok) throw new GoogleUnavailableError(`Places search failed (${res.status}).`);
  const body = (await res.json().catch(() => ({}))) as { places?: RawPlace[] };
  return (body.places ?? [])
    .filter((p) => (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL")
    .map(toResult);
}

/**
 * Review-count-weighted (Bayesian, GOOGLE_PRIOR) rating first, so 4.8 from 3
 * reviews no longer outranks 4.5 from 200; then more reviews; unrated last.
 * Ranking for a job lives in src/lib/contractors/ranking.ts.
 */
export function sortByWeightedRating(results: PlaceResult[]): PlaceResult[] {
  const score = (p: PlaceResult) => bayesianRating(p.rating, p.reviewCount, GOOGLE_PRIOR) ?? -1;
  return [...results].sort((a, b) => score(b) - score(a) || (b.reviewCount ?? -1) - (a.reviewCount ?? -1));
}

export async function placeDetails(placeId: string): Promise<{
  rating: number | null;
  reviewCount: number | null;
  phone: string | null;
  website: string | null;
  businessStatus: string | null;
}> {
  const key = googleKey();
  if (!key) throw new GoogleUnavailableError("No Google key configured.");
  const res = await googleFetch(
    `${DETAILS_URL}${encodeURIComponent(placeId)}`,
    { headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": REFRESH_FIELD_MASK } },
    "Place details",
  );
  if (!res.ok) throw new GoogleUnavailableError(`Place details failed (${res.status}).`);
  const p = (await res.json().catch(() => ({ id: placeId }))) as RawPlace;
  return {
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    phone: p.nationalPhoneNumber ?? null,
    website: p.websiteUri ?? null,
    businessStatus: p.businessStatus ?? null,
  };
}

export async function geocode(address: string): Promise<{ latitude: number; longitude: number } | null> {
  const key = googleKey();
  if (!key) return null;
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
  const res = await googleFetch(url, {}, "Geocoding");
  if (!res.ok) throw new GoogleUnavailableError(`Geocoding failed (${res.status}).`);
  const body = (await res.json().catch(() => ({ status: "ERROR" }))) as {
    status: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };
  const loc = body.results?.[0]?.geometry?.location;
  return body.status === "OK" && loc ? { latitude: loc.lat, longitude: loc.lng } : null;
}

/** Straight-line distance in miles. */
export function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function googleMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

export const GOOGLE_REFRESH_DAYS = 30;
export const SEARCH_CACHE_HOURS = 24;

export function isStale(fetchedAt: string | null, now: Date, days = GOOGLE_REFRESH_DAYS): boolean {
  if (!fetchedAt) return true;
  return now.getTime() - new Date(fetchedAt).getTime() > days * 86_400_000;
}
