import "server-only";
import { googleKey } from "@/lib/google/places";
import { CONTACT_EMAIL, SITE_URL } from "@/lib/site-config";

/**
 * Address suggestions for the "Set up your building" step. Server-only.
 *
 * Google's Places API (New) when GOOGLE_PLACES_KEY is set — clean,
 * USPS-style results — otherwise Photon (OpenStreetMap data, no key), which
 * is good enough to type less but sometimes spells things its own way, so the
 * form leaves every part editable. Neither provider is trusted for anything
 * beyond pre-filling boxes the person can see and change.
 */

export interface AddressParts {
  street: string;
  city: string;
  state: string; // two letters
  postalCode: string;
  county: string | null;
}

export interface AddressSuggestion {
  /** Shown in the list. */
  label: string;
  /** Present for Google: the parts come from a second call when picked. */
  placeId: string | null;
  /** Present for Photon: the parts arrive with the suggestion. */
  parts: AddressParts | null;
}

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

const trim = (s: string | undefined | null) => (s ?? "").trim();

// ---- Google (Places API New) --------------------------------------------------

async function googleSuggest(query: string, key: string): Promise<AddressSuggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["us"],
      // Street addresses and buildings, not businesses or neighbourhoods.
      includedPrimaryTypes: ["street_address", "premise", "subpremise"],
      // A soft lean toward Chicago, where the first associations are.
      locationBias: { circle: { center: { latitude: 41.88, longitude: -87.63 }, radius: 50_000 } },
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Places autocomplete failed (${res.status})`);
  const body = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId && p.text?.text))
    .slice(0, 6)
    .map((p) => ({ label: p.text!.text!, placeId: p.placeId!, parts: null }));
}

export async function googleResolve(placeId: string): Promise<AddressParts | null> {
  const key = googleKey();
  if (!key) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    addressComponents?: { longText?: string; shortText?: string; types?: string[] }[];
  };
  const part = (type: string, short = false) => {
    const c = body.addressComponents?.find((x) => x.types?.includes(type));
    return trim(short ? c?.shortText : c?.longText);
  };
  const street = [part("street_number"), part("route", true)].filter(Boolean).join(" ");
  const city = part("locality") || part("sublocality_level_1") || part("postal_town");
  const state = part("administrative_area_level_1", true);
  const zip = part("postal_code");
  if (!street || !city || !state) return null;
  return {
    street: [street, part("subpremise") ? `#${part("subpremise")}` : ""].filter(Boolean).join(" "),
    city,
    state,
    postalCode: zip,
    county: part("administrative_area_level_2").replace(/ County$/, "") || null,
  };
}

// ---- Photon (OpenStreetMap), the no-key fallback ------------------------------

interface PhotonProps {
  housenumber?: string;
  street?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  postcode?: string;
  countrycode?: string;
}

async function photonSuggest(query: string): Promise<AddressSuggestion[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lang", "en");
  // A lean toward the Chicago area; results elsewhere in the US still appear.
  url.searchParams.set("lat", "41.88");
  url.searchParams.set("lon", "-87.63");
  const res = await fetch(url, {
    headers: { "User-Agent": `Walkup/1.0 (${SITE_URL}; ${CONTACT_EMAIL})` },
    next: { revalidate: 600 },
  });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const body = (await res.json()) as { features?: { properties: PhotonProps }[] };

  // Photon matches loosely; if the person typed a house number, only keep
  // addresses with that number, or the list fills with near-misses.
  const typedNumber = query.trim().match(/^(\d+)/)?.[1] ?? null;
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const f of body.features ?? []) {
    const p = f.properties;
    if (typedNumber && !trim(p.housenumber).split(/[-–]/).includes(typedNumber)) continue;
    const state = US_STATES[trim(p.state)];
    const city = trim(p.city || p.town || p.village);
    if (p.countrycode !== "US" || !state || !city || !p.housenumber || !p.street) continue;
    const street = `${trim(p.housenumber)} ${trim(p.street)}`;
    const parts: AddressParts = {
      street,
      city,
      state,
      postalCode: trim(p.postcode),
      county: trim(p.county).replace(/ County$/, "") || null,
    };
    const label = `${street}, ${city}, ${state}${parts.postalCode ? ` ${parts.postalCode}` : ""}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, placeId: null, parts });
    if (out.length === 6) break;
  }
  return out;
}

export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (q.length < 4) return [];
  const key = googleKey();
  if (key) {
    try {
      return await googleSuggest(q, key);
    } catch {
      // Fall through to the keyless provider rather than showing nothing.
    }
  }
  return photonSuggest(q);
}
