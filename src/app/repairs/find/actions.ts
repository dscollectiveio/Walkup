"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AI_MODEL, aiConfigured } from "@/lib/ai/client";
import { aiFailure } from "@/lib/ai/errors";
import { claimAiRun, finishAiRun } from "@/lib/ai/jobs";
import { claimAiCall, finishAiCall } from "@/lib/ai/usage";
import { loadRedactionTerms, webResearch } from "@/lib/ai/web-research";
import {
  cleanWants,
  fresh,
  GOOGLE_DOWN,
  GOOGLE_MAX_AGE_MS,
  googleCacheKey,
  googleCandidates,
  NEEDS_CITY,
  savedMatcher,
  WEB_MAX_AGE_MS,
  webCacheKey,
  webLocation,
  type SourceState,
} from "@/lib/contractors/found";
import { DEFAULT_MILES, parseMiles } from "@/lib/contractors/find-params";
import type { FoundCandidate, JobWant } from "@/lib/contractors/ranking";
import { isTradeSlug, tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import { verifyWebContractor, WEB_ITEM_GUIDANCE, webContractorSchema, webSearchTask, type WebContractor } from "@/lib/contractors/web-verify";
import {
  geocode,
  GOOGLE_DAILY_LIMIT,
  googleKey,
  GoogleUnavailableError,
  searchNearby,
  type PlaceResult,
} from "@/lib/google/places";
import { revalidateRepairs } from "@/lib/repairs/revalidate";
import { currentAssociationId, isBoard, isUuid, type Supabase } from "@/lib/repairs/server";
import { searchPhraseFor } from "@/lib/repairs/vocabulary";

/**
 * Finding contractors for a job (repairs-spec §9). What leaves Walkup is
 * decided here and only here: Google gets the building's location and
 * either the trade's own query or a phrase of Walkup's fixed repair
 * vocabulary; web search gets the city, state, ZIP, the trade label, that
 * phrase and the "what matters" wording (brief decision 4, DECISIONS #31 and
 * #35(h)). Anything the browser sends is re-checked: the phrase through
 * vocabPhrase, the trade through isTradeSlug, the wants against the four
 * known values.
 */

const NOT_BOARD = "Only board members can search for contractors.";
const EXPIRED = "That result has expired. Search again, then save it.";

// ---------------------------------------------------------------------------
// Google Places (§9.2)
// ---------------------------------------------------------------------------

async function logGoogleCall(supabase: Supabase, associationId: string, kind: "geocode" | "text_search" | "place_details", trade: string | null) {
  const { error } = await supabase.from("google_api_calls").insert({ association_id: associationId, kind, trade });
  if (error) console.error("[repairs] google_api_calls", error.code ?? "-", error.message ?? "");
}

async function googleCallsToday(supabase: Supabase, associationId: string): Promise<number> {
  const { data } = await supabase.rpc("google_calls_today", { p_association_id: associationId });
  return typeof data === "number" ? data : 0;
}

/**
 * Google candidates for a trade. `cacheOnly` answers from the 24-hour cache and never spends a Places call: the
 * page asks that way on load, so opening a link costs nothing, and a person presses a button for a live search
 * (REVIEW-2 #27).
 */
export async function searchPlaces(input: { trade: string; phrase: string; refresh?: boolean; cacheOnly?: boolean; miles?: number }): Promise<{ source: SourceState; candidates: FoundCandidate[] }> {
  if (!googleKey()) return { source: { state: "off" }, candidates: [] };
  const trade = isTradeSlug(String(input?.trade ?? "")) ? tradeBySlug(input.trade) : null;
  if (!trade || (!trade.googleQuery && trade.slug !== "other")) return { source: { state: "error", message: "Choose a kind of work to search for." }, candidates: [] };
  const phrase = searchPhraseFor(trade.slug, String(input?.phrase ?? ""));
  if (!trade.googleQuery && !phrase) return { source: { state: "error", message: "Describe the work you need done." }, candidates: [] };

  const miles = parseMiles(input?.miles);
  const supabase = await createClient();
  const { data: assocRows } = await supabase
    .from("associations")
    .select("id, street_address, city, state_code, postal_code, latitude, longitude")
    .limit(1);
  const a = assocRows?.[0];
  if (!a) return { source: { state: "error", message: "No association is visible to you." }, candidates: [] };
  if (!(await isBoard(supabase, a.id))) return { source: { state: "error", message: NOT_BOARD }, candidates: [] };

  try {
    // 1. Where the building is: stored, else geocoded once and stored (works for any board member).
    let location: { latitude: number; longitude: number } | null =
      a.latitude !== null && a.longitude !== null ? { latitude: Number(a.latitude), longitude: Number(a.longitude) } : null;
    if (!location) {
      if (!a.street_address?.trim()) return { source: { state: "no_address" }, candidates: [] };
      if (input.cacheOnly) return { source: { state: "idle" }, candidates: [] };
      const used = await googleCallsToday(supabase, a.id);
      if (used >= GOOGLE_DAILY_LIMIT) return { source: { state: "quota", used, limit: GOOGLE_DAILY_LIMIT }, candidates: [] };
      const address = [a.street_address, a.city, a.state_code, a.postal_code].filter(Boolean).join(", ");
      await logGoogleCall(supabase, a.id, "geocode", null);
      location = await geocode(address);
      if (!location) return { source: { state: "no_address" }, candidates: [] };
      const { error } = await supabase.rpc("set_association_coordinates", {
        p_association_id: a.id,
        p_latitude: location.latitude,
        p_longitude: location.longitude,
      });
      if (error) console.error("[repairs] set_association_coordinates", error.code ?? "-", error.message ?? "");
    }

    // 2. The cache, 24 hours (brief decision 10).
    const textQuery = phrase || (trade.googleQuery as string);
    const key = googleCacheKey(textQuery, location.latitude, location.longitude, miles);
    const { data: cacheRows } = await supabase
      .from("contractor_search_cache")
      .select("id, results_json, fetched_at")
      .eq("association_id", a.id)
      .eq("provider", "google")
      .eq("trade", trade.slug)
      .eq("query_key", key.query_key)
      .eq("location_key", key.location_key)
      .limit(1);
    const hit = cacheRows?.[0];
    const match = await savedMatcher(supabase, a.id);
    if (hit && !input.refresh && fresh(hit.fetched_at, GOOGLE_MAX_AGE_MS)) {
      return {
        source: { state: "ok", cached: true, fetchedAt: hit.fetched_at },
        candidates: googleCandidates(hit.results_json as PlaceResult[], hit.fetched_at, location, match, miles),
      };
    }

    if (input.cacheOnly) {
      return { source: { state: "idle" }, candidates: [] };
    }

    // 3. A live call, within the day's budget.
    const used = await googleCallsToday(supabase, a.id);
    if (used >= GOOGLE_DAILY_LIMIT) {
      const old = hit
        ? googleCandidates(hit.results_json as PlaceResult[], hit.fetched_at, location, match, miles)
        : [];
      return { source: { state: "quota", used, limit: GOOGLE_DAILY_LIMIT }, candidates: old };
    }
    await logGoogleCall(supabase, a.id, "text_search", trade.slug);
    // The usual 15 miles keeps the original search circle; another distance sizes it to match (Google caps it at 50 km).
    const results = await searchNearby(textQuery, location.latitude, location.longitude, {
      includedType: trade.placesType,
      ...(miles === DEFAULT_MILES ? {} : { radiusMeters: Math.min(50_000, Math.round(miles * 1609.34)) }),
    });
    const fetchedAt = new Date().toISOString();
    const { error: cacheError } = await supabase.from("contractor_search_cache").upsert(
      {
        association_id: a.id,
        provider: "google",
        trade: trade.slug,
        query_key: key.query_key,
        location_key: key.location_key,
        results_json: results,
        fetched_at: fetchedAt,
        ai_state: "done",
      },
      { onConflict: "association_id,provider,trade,query_key,location_key" },
    );
    if (cacheError) console.error("[repairs] google cache", cacheError.code ?? "-", cacheError.message ?? "");

    return {
      source: { state: "ok", cached: false, fetchedAt },
      candidates: googleCandidates(results, fetchedAt, location, match, miles),
    };
  } catch (cause) {
    if (cause instanceof GoogleUnavailableError) {
      console.error("[repairs] Google Places unavailable", cause.message);
      return { source: { state: "error", message: GOOGLE_DOWN }, candidates: [] };
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Web research (§9.3), in the background
// ---------------------------------------------------------------------------

export async function startWebSearch(input: { trade: string; phrase: string; wants: JobWant[]; refresh?: boolean }): Promise<
  { ok: true; rowId: string; state: "running" | "done" } | { error: string; quota?: true; off?: true }
> {
  if (!aiConfigured()) return { error: aiFailure("not_configured", "contractor_search").reason, off: true };
  const trade = isTradeSlug(String(input?.trade ?? "")) ? tradeBySlug(input.trade) : null;
  if (!trade) return { error: "Choose a kind of work to search for." };
  const phrase = searchPhraseFor(trade.slug, String(input?.phrase ?? ""));
  if (trade.slug === "other" && !phrase) return { error: "Describe the work you need done." };
  const wants = cleanWants(input?.wants);

  const supabase = await createClient();
  const where = await webLocation(supabase);
  if (!where) return { error: "No association is visible to you." };
  const { associationId, loc } = where;
  if (!(await isBoard(supabase, associationId))) return { error: NOT_BOARD };
  if (!loc.city && !loc.postalCode) return { error: NEEDS_CITY };

  const key = webCacheKey(phrase, wants, loc);
  const lookup = () =>
    supabase
      .from("contractor_search_cache")
      .select("id, ai_state, ai_started_at, fetched_at")
      .eq("association_id", associationId)
      .eq("provider", "web")
      .eq("trade", trade.slug)
      .eq("query_key", key.query_key)
      .eq("location_key", key.location_key)
      .limit(1);
  const { data: existingRows } = await lookup();
  const existing = existingRows?.[0];
  if (existing && !input.refresh && existing.ai_state === "done" && fresh(existing.fetched_at, WEB_MAX_AGE_MS)) {
    return { ok: true, rowId: existing.id, state: "done" };
  }

  // Quota first, so a building at its limit hears it before anything starts.
  const claimed = await claimAiCall(supabase, associationId, "contractor_search");
  if (!claimed.ok) return claimed.quota ? { error: claimed.reason, quota: true } : { error: claimed.reason };
  const release = () =>
    finishAiCall(supabase, claimed.claim, { model: AI_MODEL, input_tokens: 0, output_tokens: 0, ok: false, error_code: "not_started" });

  let rowId = existing?.id as string | undefined;
  if (!rowId) {
    const { error } = await supabase.from("contractor_search_cache").upsert(
      {
        association_id: associationId,
        provider: "web",
        trade: trade.slug,
        query_key: key.query_key,
        location_key: key.location_key,
        results_json: [],
        ai_state: "idle",
      },
      { onConflict: "association_id,provider,trade,query_key,location_key", ignoreDuplicates: true },
    );
    if (error) console.error("[repairs] web cache row", error.code ?? "-", error.message ?? "");
    const { data: again } = await lookup();
    rowId = again?.[0]?.id as string | undefined;
  }
  if (!rowId) {
    await release();
    return { error: "Couldn't start the search. Try again." };
  }
  if (!(await claimAiRun(supabase, "contractor_search_cache", rowId))) {
    // Someone already started this exact search.
    await release();
    return { ok: true, rowId, state: "running" };
  }

  const task = webSearchTask({ tradeLabel: trade.label, phrase, wants, city: loc.city, state: loc.state, postalCode: loc.postalCode });
  const id = rowId;
  after(async () => {
    const bg = await createClient();
    try {
      const listed = new Set<WebContractor>();
      const r = await webResearch<WebContractor>({
        kind: "contractor_search",
        supabase: bg,
        associationId,
        claim: claimed.claim,
        task,
        redact: await loadRedactionTerms(bg, associationId),
        itemSchema: webContractorSchema,
        nameOf: (item) => {
          listed.add(item);
          return item.name;
        },
        itemGuidance: WEB_ITEM_GUIDANCE,
        verify: (item, ctx) => verifyWebContractor(item, ctx),
        maxSearches: 4,
        userLocation: {
          ...(loc.city ? { city: loc.city } : {}),
          ...(loc.state ? { region: loc.state } : {}),
          country: "US",
          ...(loc.postalCode ? { postal_code: loc.postalCode } : {}),
        },
      });
      if (r.ok) {
        // Verified items, with their evidence quotes (each kept source and what it said).
        const items = r.result.items;
        const { error } = await bg
          .from("contractor_search_cache")
          .update({
            results_json: items,
            sources_json: r.result.sources,
            fetched_at: r.result.fetchedAt,
            dropped_count: Math.max(0, listed.size - items.length),
          })
          .eq("id", id);
        if (error) console.error("[repairs] web cache write", error.code ?? "-", error.message ?? "");
        await finishAiRun(bg, "contractor_search_cache", id, error ? { ok: false, reason: aiFailure("unknown").reason } : { ok: true });
      } else {
        // Results from an earlier run stay and show with their date.
        await finishAiRun(bg, "contractor_search_cache", id, { ok: false, reason: r.reason });
      }
    } catch (e) {
      console.error("[repairs] web search", e instanceof Error ? e.name : "unknown");
      await finishAiRun(bg, "contractor_search_cache", id, { ok: false, reason: aiFailure("unknown").reason });
    }
    revalidatePath("/repairs/find");
  });

  revalidatePath("/repairs/find");
  return { ok: true, rowId, state: "running" };
}

// ---------------------------------------------------------------------------
// Save, link (§9.4): details always re-read from the cache row
// ---------------------------------------------------------------------------

type Cached =
  | { kind: "google"; place: PlaceResult; fetchedAt: string }
  | { kind: "web"; item: WebContractor; fetchedAt: string };

async function cachedCandidate(supabase: Supabase, associationId: string, candidateId: string): Promise<Cached | null> {
  const now = new Date();
  if (candidateId.startsWith("g:")) {
    const placeId = candidateId.slice(2);
    if (!placeId || placeId.length > 300) return null;
    const since = new Date(now.getTime() - GOOGLE_MAX_AGE_MS).toISOString();
    const { data } = await supabase
      .from("contractor_search_cache")
      .select("results_json, fetched_at")
      .eq("association_id", associationId)
      .eq("provider", "google")
      .gte("fetched_at", since)
      .order("fetched_at", { ascending: false })
      .limit(50);
    for (const row of data ?? []) {
      const place = ((row.results_json ?? []) as PlaceResult[]).find((p) => p?.placeId === placeId);
      if (place) return { kind: "google", place, fetchedAt: row.fetched_at };
    }
    return null;
  }
  const m = /^w:([0-9a-f-]{36}):(\d{1,3})$/i.exec(candidateId);
  if (!m || !isUuid(m[1])) return null;
  const { data } = await supabase
    .from("contractor_search_cache")
    .select("results_json, fetched_at")
    .eq("id", m[1])
    .eq("association_id", associationId)
    .eq("provider", "web")
    .limit(1);
  const row = data?.[0];
  if (!row || !fresh(row.fetched_at, WEB_MAX_AGE_MS, now)) return null;
  const item = ((row.results_json ?? []) as WebContractor[])[Number(m[2])];
  return item?.name ? { kind: "web", item, fetchedAt: row.fetched_at } : null;
}

function nameOf(c: Cached): string {
  return c.kind === "google" ? c.place.name : c.item.name;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type SaveFailure = { ok: false; reason: "expired" | "name_taken" | "not_allowed" | "do_not_use" | "error"; message: string; existingVendorId?: string };
type SaveResult = { ok: true; vendorId: string; alreadySaved: boolean } | SaveFailure;

async function saveOne(
  supabase: Supabase,
  associationId: string,
  candidateId: string,
  trade: string,
  match: Awaited<ReturnType<typeof savedMatcher>>,
): Promise<{ name: string | null; result: SaveResult }> {
  const c = await cachedCandidate(supabase, associationId, String(candidateId ?? ""));
  if (!c) return { name: null, result: { ok: false, reason: "expired", message: EXPIRED } };
  const name = nameOf(c);

  const saved =
    c.kind === "google"
      ? match({ placeId: c.place.placeId, website: c.place.website, name })
      : match({ website: c.item.websiteUrl, name });
  if (saved?.status === "do_not_use") {
    return {
      name,
      result: {
        ok: false,
        reason: "do_not_use",
        message: `Your board marked ${name} as do not use: ${saved.doNotUseReason ?? "no reason recorded"}.`,
        existingVendorId: saved.vendorId,
      },
    };
  }
  if (saved) return { name, result: { ok: true, vendorId: saved.vendorId, alreadySaved: true } };

  const row =
    c.kind === "google"
      ? {
          name,
          phone: c.place.phone,
          website_url: c.place.website,
          address: c.place.address,
          google_place_id: c.place.placeId,
          google_rating: c.place.rating,
          google_review_count: c.place.reviewCount,
          google_fetched_at: c.fetchedAt,
          google_business_status: c.place.businessStatus ?? null,
          source: "google",
        }
      : {
          name,
          website_url: c.item.websiteUrl,
          phone: c.item.phone,
          email: c.item.email,
          emergency_service: c.item.emergencyService === true,
          job_tags: [
            ...(c.item.mentionsCondoWork === true ? ["condo_work"] : []),
            ...(c.item.smallJobsWelcome === true ? ["small_jobs"] : []),
            ...(c.item.freeEstimates === true ? ["free_estimates"] : []),
          ],
          source: "web",
          source_urls: c.item.sourceUrls ?? [],
        };

  const { data, error } = await supabase
    .from("vendors")
    .insert({ association_id: associationId, trades: [trade], trade: tradeLabel(trade), status: "okay", ...row })
    .select("id");
  if (!error && data?.[0]) return { name, result: { ok: true, vendorId: data[0].id as string, alreadySaved: false } };

  if (error?.code === "23505") {
    if (c.kind === "google") {
      const { data: byPlace } = await supabase
        .from("vendors")
        .select("id")
        .eq("association_id", associationId)
        .eq("google_place_id", c.place.placeId)
        .limit(1);
      if (byPlace?.[0]) return { name, result: { ok: true, vendorId: byPlace[0].id as string, alreadySaved: true } };
    }
    const { data: byName } = await supabase
      .from("vendors")
      .select("id")
      .eq("association_id", associationId)
      .ilike("name", escapeLike(name))
      .limit(1);
    return {
      name,
      result: {
        ok: false,
        reason: "name_taken",
        message: `You already have a contractor called ${name}.`,
        ...(byName?.[0] ? { existingVendorId: byName[0].id as string } : {}),
      },
    };
  }
  if (error?.code === "42501") return { name, result: { ok: false, reason: "not_allowed", message: "Only a board member can save a contractor." } };
  console.error("[repairs] saveCandidate", error?.code ?? "-", error?.message ?? "");
  return { name, result: { ok: false, reason: "error", message: "Something went wrong saving that. Try again." } };
}

export async function saveCandidate(candidateId: string, trade: string): Promise<SaveResult> {
  if (!isTradeSlug(String(trade ?? ""))) return { ok: false, reason: "error", message: "Choose a kind of work first." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { ok: false, reason: "not_allowed", message: "No association is visible to you." };
  if (!(await isBoard(supabase, associationId))) return { ok: false, reason: "not_allowed", message: "Only a board member can save a contractor." };
  const { result } = await saveOne(supabase, associationId, candidateId, trade, await savedMatcher(supabase, associationId));
  if (result.ok && !result.alreadySaved) revalidateRepairs({ vendorId: result.vendorId });
  return result;
}

/** For the ask bar: saves each found result (or finds the existing contractor), skipping do-not-use. */
export async function saveCandidates(candidateIds: string[], trade: string): Promise<
  { ok: true; vendorIds: string[]; skipped: { candidateId: string; name: string; reason: string }[] } | { error: string }
> {
  if (!isTradeSlug(String(trade ?? ""))) return { error: "Choose a kind of work first." };
  const ids = [...new Set((candidateIds ?? []).map(String))].slice(0, 20);
  if (ids.length === 0) return { error: "Pick at least one contractor." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };
  if (!(await isBoard(supabase, associationId))) return { error: "Only a board member can save a contractor." };

  const match = await savedMatcher(supabase, associationId);
  const vendorIds: string[] = [];
  const skipped: { candidateId: string; name: string; reason: string }[] = [];
  for (const id of ids) {
    const { name, result } = await saveOne(supabase, associationId, id, trade, match);
    if (result.ok) vendorIds.push(result.vendorId);
    else if (result.reason === "name_taken" && result.existingVendorId) vendorIds.push(result.existingVendorId);
    else skipped.push({ candidateId: id, name: name ?? "This result", reason: result.message });
  }
  revalidateRepairs();
  return { ok: true, vendorIds: [...new Set(vendorIds)], skipped };
}

/** "Link to them": fill what the existing contractor doesn't have yet; never overwrite what the board typed. */
export async function linkCandidate(candidateId: string, vendorId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isUuid(vendorId)) return { ok: false, message: "That contractor isn't visible to you." };
  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { ok: false, message: "No association is visible to you." };
  if (!(await isBoard(supabase, associationId))) return { ok: false, message: "Only a board member can change a contractor." };
  const c = await cachedCandidate(supabase, associationId, String(candidateId ?? ""));
  if (!c) return { ok: false, message: EXPIRED };

  const { data: rows } = await supabase
    .from("vendors")
    .select("id, google_place_id, website_url, source_urls, phone")
    .eq("id", vendorId)
    .eq("association_id", associationId)
    .limit(1);
  const v = rows?.[0];
  if (!v) return { ok: false, message: "That contractor isn't visible to you." };

  const update: Record<string, unknown> = {};
  if (c.kind === "google") {
    if (!v.google_place_id) {
      update.google_place_id = c.place.placeId;
      update.google_rating = c.place.rating;
      update.google_review_count = c.place.reviewCount;
      update.google_fetched_at = c.fetchedAt;
      update.google_business_status = c.place.businessStatus ?? null;
    }
    if (!v.website_url && c.place.website) update.website_url = c.place.website;
    if (!v.phone && c.place.phone) update.phone = c.place.phone;
  } else {
    if (!v.website_url && c.item.websiteUrl) update.website_url = c.item.websiteUrl;
    if ((!v.source_urls || v.source_urls.length === 0) && c.item.sourceUrls?.length) update.source_urls = c.item.sourceUrls;
    if (!v.phone && c.item.phone) update.phone = c.item.phone;
  }
  if (Object.keys(update).length === 0) return { ok: true };

  const { data, error } = await supabase.from("vendors").update(update).eq("id", vendorId).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Another of your contractors is already linked to this Google listing." };
    console.error("[repairs] linkCandidate", error.code ?? "-", error.message ?? "");
    return { ok: false, message: "Something went wrong saving that. Try again." };
  }
  if (!data || data.length === 0) return { ok: false, message: "Only a board member can change a contractor." };
  revalidateRepairs({ vendorId });
  return { ok: true };
}
