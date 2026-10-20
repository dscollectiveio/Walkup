import "server-only";
import { aiConfigured } from "@/lib/ai/client";
import { aiRunStatus, type AiRunState } from "@/lib/ai/jobs";
import { hostOf, normaliseBusinessName } from "@/lib/ai/verify";
import { POLL_COPY } from "@/components/ai/poll-state";
import { milesBetween, type PlaceResult } from "@/lib/google/places";
import type { Supabase } from "@/lib/repairs/server";
import { JOB_WANTS, MAX_DISTANCE_MILES, type FoundCandidate, type JobWant } from "./ranking";
import type { WebContractor } from "./web-verify";

/**
 * Contractors found online for a job (repairs-spec §9.2, §9.3): the cache
 * keys, what a cache row becomes on the page, and whether a result is
 * someone the board already has. Server-only; the page and the find actions
 * share it. Every detail shown or saved is re-read from a cache row, never
 * taken from the browser.
 */

/** Brief decision 10. */
export const GOOGLE_CACHE_HOURS = 24;
export const WEB_CACHE_DAYS = 7;

export type SourceState =
  | { state: "ok"; cached: boolean; fetchedAt: string; dropped?: number }
  | { state: "running"; rowId: string; startedAt: string }
  | { state: "idle" }
  | { state: "off" }
  | { state: "no_address" }
  | { state: "quota"; used?: number; limit?: number }
  | { state: "error"; message: string };

export const GOOGLE_DOWN = "Google didn't answer. Try again in a minute.";
export const NEEDS_CITY = "Add your building's city or ZIP code in Building & Owners to search the web.";

export function fresh(fetchedAt: string | null | undefined, maxAgeMs: number, now: Date = new Date()): boolean {
  if (!fetchedAt) return false;
  const t = new Date(fetchedAt).getTime();
  return Number.isFinite(t) && now.getTime() - t < maxAgeMs;
}
export const GOOGLE_MAX_AGE_MS = GOOGLE_CACHE_HOURS * 3_600_000;
export const WEB_MAX_AGE_MS = WEB_CACHE_DAYS * 86_400_000;

/** The four known wants, deduped and sorted, so the cache key doesn't depend on click order. */
export function cleanWants(wants: unknown): JobWant[] {
  const list = Array.isArray(wants) ? wants : [];
  return JOB_WANTS.filter((w) => list.includes(w)).slice().sort();
}

/** Another distance gets its own key; every key notes that the results carry opening hours. */
export function googleCacheKey(textQuery: string, lat: number, lng: number, miles: number = MAX_DISTANCE_MILES) {
  const where = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  // "hrs" marks results that carry opening hours, so older saved results without them aren't reused for the open-now filter.
  return { query_key: textQuery.toLowerCase(), location_key: `${where}${miles === MAX_DISTANCE_MILES ? "" : `|${miles}mi`}|hrs` };
}

export function webCacheKey(phrase: string, wants: JobWant[], loc: { city: string | null; state: string | null; postalCode: string | null }) {
  return {
    query_key: `${phrase}|${wants.join(",")}`.toLowerCase(),
    location_key: loc.postalCode?.trim() || `${loc.city?.trim() ?? ""}|${loc.state?.trim() ?? ""}`,
  };
}

// ---------------------------------------------------------------------------
// "In your list": by Google place id, website host, or normalised name
// ---------------------------------------------------------------------------

interface SavedRow {
  id: string;
  name: string;
  status: "preferred" | "okay" | "do_not_use";
  do_not_use_reason: string | null;
  archived_at: string | null;
  google_place_id: string | null;
  website_url: string | null;
}

export type SavedMatcher = (c: { placeId?: string | null; website?: string | null; name: string }) => FoundCandidate["alreadySaved"];

/** Every contractor the board has (archived and do-not-use included), as a matcher. */
export async function savedMatcher(supabase: Supabase, associationId: string): Promise<SavedMatcher> {
  const { data } = await supabase
    .from("vendors")
    .select("id, name, status, do_not_use_reason, archived_at, google_place_id, website_url")
    .eq("association_id", associationId)
    .limit(2000);
  const rows = (data ?? []) as SavedRow[];
  const byPlace = new Map<string, SavedRow>();
  const byHost = new Map<string, SavedRow>();
  const byName = new Map<string, SavedRow>();
  for (const r of rows) {
    if (r.google_place_id) byPlace.set(r.google_place_id, r);
    const host = r.website_url ? hostOf(r.website_url) : null;
    if (host) byHost.set(host, r);
    const n = normaliseBusinessName(r.name);
    if (n) byName.set(n, r);
  }
  const shape = (r: SavedRow): FoundCandidate["alreadySaved"] => ({
    vendorId: r.id,
    status: r.status,
    doNotUseReason: r.do_not_use_reason,
    archived: r.archived_at !== null,
  });
  return (c) => {
    const hit =
      (c.placeId ? byPlace.get(c.placeId) : undefined) ??
      (c.website ? byHost.get(hostOf(c.website) ?? "") : undefined) ??
      byName.get(normaliseBusinessName(c.name));
    return hit ? shape(hit) : null;
  };
}

// ---------------------------------------------------------------------------
// Cache rows -> candidates
// ---------------------------------------------------------------------------

export function googleCandidates(
  results: PlaceResult[],
  fetchedAt: string,
  from: { latitude: number; longitude: number },
  match: SavedMatcher,
  maxMiles: number = MAX_DISTANCE_MILES,
): FoundCandidate[] {
  const out: FoundCandidate[] = [];
  for (const r of results ?? []) {
    const miles =
      r.latitude !== null && r.longitude !== null
        ? Math.round(milesBetween(from.latitude, from.longitude, r.latitude, r.longitude) * 10) / 10
        : null;
    if (miles !== null && miles > maxMiles) continue;
    out.push({
      kind: "google",
      candidateId: `g:${r.placeId}`,
      name: r.name,
      address: r.address,
      cityText: null,
      phone: r.phone,
      email: null,
      website: r.website,
      rating: r.rating,
      reviewCount: r.reviewCount,
      ratingSource: r.rating !== null ? "Google" : null,
      ratingAsOf: fetchedAt,
      distanceMiles: miles,
      openNow: r.openNow ?? null,
      open24h: r.open24h ?? null,
      flags: { emergencyService: null, condoWork: null, smallJobs: null, freeEstimates: null },
      placeId: r.placeId,
      sourceUrls: [],
      snippet: null,
      alreadySaved: match({ placeId: r.placeId, website: r.website, name: r.name }),
    });
  }
  return out;
}

export function webCandidates(rowId: string, items: WebContractor[], fetchedAt: string, match: SavedMatcher): FoundCandidate[] {
  return (Array.isArray(items) ? items : []).map((w, i) => ({
    kind: "web" as const,
    candidateId: `w:${rowId}:${i}`,
    name: w.name,
    address: null,
    cityText: w.cityOrArea ?? null,
    phone: w.phone ?? null,
    email: w.email ?? null,
    website: w.websiteUrl ?? null,
    rating: w.rating ?? null,
    reviewCount: w.reviewCount ?? null,
    ratingSource: w.ratingSource ?? null,
    ratingAsOf: fetchedAt,
    distanceMiles: null,
    flags: {
      emergencyService: w.emergencyService ?? null,
      condoWork: w.mentionsCondoWork ?? null,
      smallJobs: w.smallJobsWelcome ?? null,
      freeEstimates: w.freeEstimates ?? null,
    },
    placeId: null,
    sourceUrls: Array.isArray(w.sourceUrls) ? w.sourceUrls : [],
    snippet: w.snippet ?? null,
    alreadySaved: match({ website: w.websiteUrl ?? null, name: w.name }),
  }));
}

export interface SearchLocation { city: string | null; state: string | null; postalCode: string | null }

/** The building's area for web search: city, state and ZIP only (brief decision 4, never the street). */
export async function webLocation(supabase: Supabase): Promise<{ associationId: string; loc: SearchLocation } | null> {
  const { data } = await supabase.from("associations").select("id, city, state_code, postal_code").limit(1);
  const a = data?.[0];
  if (!a) return null;
  return {
    associationId: a.id as string,
    loc: {
      city: (a.city as string | null)?.trim() || null,
      state: (a.state_code as string | null)?.trim() || null,
      postalCode: (a.postal_code as string | null)?.trim() || null,
    },
  };
}

/** Server-side read used by the find page: the cache row for this web search, mapped (§9.3). */
export async function loadWebSearch(
  supabase: Supabase,
  key: { trade: string; phrase: string; wants: JobWant[] },
  now: Date = new Date(),
): Promise<{ source: SourceState; candidates: FoundCandidate[] }> {
  const where = await webLocation(supabase);
  if (!where) return { source: { state: "off" }, candidates: [] };
  if (!where.loc.city && !where.loc.postalCode) return { source: { state: "error", message: NEEDS_CITY }, candidates: [] };
  const k = webCacheKey(key.phrase, cleanWants(key.wants), where.loc);
  const { data } = await supabase
    .from("contractor_search_cache")
    .select("id, results_json, fetched_at, dropped_count, ai_state, ai_started_at, ai_error")
    .eq("association_id", where.associationId)
    .eq("provider", "web")
    .eq("trade", key.trade)
    .eq("query_key", k.query_key)
    .eq("location_key", k.location_key)
    .limit(1);
  const row = data?.[0];
  if (!row) return { source: aiConfigured() ? { state: "idle" } : { state: "off" }, candidates: [] };

  const match = await savedMatcher(supabase, where.associationId);
  const items = (row.results_json ?? []) as WebContractor[];
  const candidates = () => webCandidates(row.id, items, row.fetched_at, match);
  const status = aiRunStatus(row.ai_state as AiRunState, row.ai_started_at ?? null, now);
  switch (status) {
    case "running":
      return { source: { state: "running", rowId: row.id, startedAt: row.ai_started_at }, candidates: [] };
    case "stalled":
      return { source: { state: "error", message: `${POLL_COPY.stalledHeading}. ${POLL_COPY.stalledBody}` }, candidates: candidates() };
    case "failed":
      return { source: { state: "error", message: row.ai_error || POLL_COPY.stalledHeading }, candidates: candidates() };
    case "done":
      if (!fresh(row.fetched_at, WEB_MAX_AGE_MS, now)) {
        return { source: aiConfigured() ? { state: "idle" } : { state: "off" }, candidates: [] };
      }
      return { source: { state: "ok", cached: true, fetchedAt: row.fetched_at, dropped: row.dropped_count ?? 0 }, candidates: candidates() };
    default:
      return { source: aiConfigured() ? { state: "idle" } : { state: "off" }, candidates: [] };
  }
}
