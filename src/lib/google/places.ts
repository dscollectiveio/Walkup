import "server-only";

// Google Places API (New) and the Geocoding API, server-side only. The key
// never reaches the browser: this module is server-only and nothing here is
// imported by a client component.

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DETAILS_URL = "https://places.googleapis.com/v1/places/";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** About 10 miles. */
export const SEARCH_RADIUS_METERS = 16_000;

export const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.location";
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
  };
}

/** Operating businesses matching the query near a point, best rated first. */
export async function searchNearby(
  query: string,
  latitude: number,
  longitude: number,
): Promise<PlaceResult[]> {
  const key = googleKey();
  if (!key) throw new GoogleUnavailableError("No Google key configured.");
  const res = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: { circle: { center: { latitude, longitude }, radius: SEARCH_RADIUS_METERS } },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new GoogleUnavailableError(`Places search failed (${res.status}).`);
  const body = (await res.json()) as { places?: RawPlace[] };
  return sortByRating(
    (body.places ?? []).filter((p) => (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL").map(toResult),
  );
}

export function sortByRating(results: PlaceResult[]): PlaceResult[] {
  return [...results].sort(
    (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.reviewCount ?? -1) - (a.reviewCount ?? -1),
  );
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
  const res = await fetch(`${DETAILS_URL}${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": REFRESH_FIELD_MASK },
    cache: "no-store",
  });
  if (!res.ok) throw new GoogleUnavailableError(`Place details failed (${res.status}).`);
  const p = (await res.json()) as RawPlace;
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
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new GoogleUnavailableError(`Geocoding failed (${res.status}).`);
  const body = (await res.json()) as {
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
