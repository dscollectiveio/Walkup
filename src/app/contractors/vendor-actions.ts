"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isTradeSlug, tradeBySlug, tradeLabel } from "@/lib/contractors/trades";
import {
  geocode,
  googleKey,
  GoogleUnavailableError,
  isStale,
  milesBetween,
  placeDetails,
  searchNearby,
  SEARCH_CACHE_HOURS,
  type PlaceResult,
} from "@/lib/google/places";

const ENTITY_TYPES = ["individual", "sole_prop", "partnership", "c_corp", "s_corp", "llc", "other"] as const;
const STATUSES = ["preferred", "okay", "do_not_use"] as const;

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function currentAssociation(supabase: Supabase) {
  const { data } = await supabase
    .from("associations")
    .select("id, street_address, city, state_code, postal_code, latitude, longitude")
    .limit(1);
  return data?.[0] ?? null;
}

function optionalText(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function revalidateContractors(vendorId?: string) {
  revalidatePath("/contractors");
  if (vendorId) revalidatePath(`/contractors/${vendorId}`);
  revalidatePath("/");
}

/** Everything a contractor row carries, validated. Shared by add and edit. */
function vendorFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Add the company or person's name." };

  const trades = [...new Set(formData.getAll("trades").map(String).filter(isTradeSlug))];
  if (trades.length === 0) return { error: "Pick at least one kind of work they do." };

  const phone = optionalText(formData, "phone");
  const email = optionalText(formData, "email");
  if (!phone && !email) return { error: "Add a phone number or email so you can reach them." };

  const status = String(formData.get("status") ?? "okay");
  if (!(STATUSES as readonly string[]).includes(status)) return { error: "Choose a valid status." };
  const doNotUseReason = optionalText(formData, "do_not_use_reason");
  if (status === "do_not_use" && !doNotUseReason) {
    return { error: "Say why the board shouldn't use them, so the next board knows." };
  }

  const entityType = optionalText(formData, "entity_type");
  if (entityType && !(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return { error: "Choose a valid business type." };
  }

  // Last four only, on purpose — DECISIONS #4. A full TIN never enters this app.
  const tinLast4 = optionalText(formData, "tin_last4");
  if (tinLast4 && !/^[0-9]{4}$/.test(tinLast4)) {
    return { error: "Enter only the last four digits of their tax ID." };
  }

  const ratingRaw = optionalText(formData, "board_rating");
  const boardRating = ratingRaw === null ? null : Number(ratingRaw);
  if (boardRating !== null && !(Number.isInteger(boardRating) && boardRating >= 1 && boardRating <= 5)) {
    return { error: "The board's rating is 1 to 5 stars." };
  }

  let website = optionalText(formData, "website_url");
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;

  const w9OnFile = formData.get("w9_on_file") === "on";

  return {
    fields: {
      name,
      trades,
      trade: trades.map(tradeLabel).join(", "),
      phone,
      email,
      website_url: website,
      contact_name: optionalText(formData, "contact_name"),
      address: optionalText(formData, "address"),
      status,
      do_not_use_reason: status === "do_not_use" ? doNotUseReason : null,
      board_rating: boardRating,
      entity_type: entityType,
      license_number: optionalText(formData, "license_number"),
      license_expires_on: optionalText(formData, "license_expires_on"),
      insured_until: optionalText(formData, "insured_until"),
      w9_on_file: w9OnFile,
      w9_received_on: w9OnFile ? optionalText(formData, "w9_received_on") : null,
      tin_last4: tinLast4,
      is_1099_exempt: formData.get("is_1099_exempt") === "on",
      notes: optionalText(formData, "notes"),
    },
  };
}

export async function addVendor(_prev: unknown, formData: FormData) {
  const parsed = vendorFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { data, error } = await supabase
    .from("vendors")
    .insert({ association_id: association.id, source: "manual", ...parsed.fields })
    .select("id");

  if (error) {
    if (error.code === "23505") return { error: "A contractor with that name is already on your list." };
    return { error: error.code === "42501" ? "Only a board member can add a contractor." : error.message };
  }

  revalidateContractors();
  return { ok: true, vendorId: data?.[0]?.id as string | undefined };
}

export async function updateVendor(_prev: unknown, formData: FormData) {
  const vendorId = String(formData.get("vendor_id") ?? "");
  if (!vendorId) return { error: "Missing contractor." };

  const parsed = vendorFields(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase.from("vendors").update(parsed.fields).eq("id", vendorId).select("id");

  if (error) {
    if (error.code === "23505") return { error: "A contractor with that name is already on your list." };
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "Only a board member can edit a contractor." };

  revalidateContractors(vendorId);
  return { ok: true };
}

export async function updateVendorNotes(vendorId: string, notes: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vendors")
    .update({ notes: notes.trim() || null })
    .eq("id", vendorId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can edit notes." };
  revalidateContractors(vendorId);
  return { ok: true };
}

export async function addReview(_prev: unknown, formData: FormData) {
  const vendorId = String(formData.get("vendor_id") ?? "");
  const rating = Number(formData.get("rating") ?? "");
  const body = optionalText(formData, "body");
  const ticketId = optionalText(formData, "ticket_id");
  if (!vendorId) return { error: "Missing contractor." };
  if (!(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return { error: "Pick 1 to 5 stars." };

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { error: "No association is visible to you." };

  const { error } = await supabase.from("contractor_reviews").insert({
    association_id: association.id,
    vendor_id: vendorId,
    ticket_id: ticketId,
    rating,
    body,
  });
  if (error) return { error: error.code === "42501" ? "Only a board member can add a review." : error.message };

  revalidateContractors(vendorId);
  return { ok: true };
}

export async function assignTicketContractor(ticketId: string, vendorId: string | null) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ assigned_vendor_id: vendorId })
    .eq("id", ticketId)
    .select("id");
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only a board member can assign a contractor." };
  revalidatePath(`/maintenance/${ticketId}`);
  if (vendorId) revalidatePath(`/contractors/${vendorId}`);
  return { ok: true };
}

// ============================================================================
// GOOGLE PLACES — server only; the key never reaches the browser
// ============================================================================

export interface SearchResult extends PlaceResult {
  distanceMiles: number | null;
  alreadySaved: boolean;
  savedVendorId: string | null;
}

export type SearchResponse =
  | { ok: true; results: SearchResult[]; cached: boolean }
  | { ok: false; reason: "no_key" | "no_address" | "google_down" | "bad_trade" | "not_allowed"; message: string };

async function logCall(supabase: Supabase, associationId: string, kind: string, trade: string | null) {
  await supabase.from("google_api_calls").insert({ association_id: associationId, kind, trade });
}

/** The building's coordinates, geocoding its address once if needed. */
async function buildingLocation(
  supabase: Supabase,
  association: NonNullable<Awaited<ReturnType<typeof currentAssociation>>>,
): Promise<{ latitude: number; longitude: number } | null> {
  if (association.latitude !== null && association.longitude !== null) {
    return { latitude: Number(association.latitude), longitude: Number(association.longitude) };
  }
  if (!association.street_address) return null;
  const address = [association.street_address, association.city, association.state_code, association.postal_code]
    .filter(Boolean)
    .join(", ");
  await logCall(supabase, association.id, "geocode", null);
  const loc = await geocode(address);
  if (!loc) return null;
  // Board admins can store it (associations_update); for anyone else the
  // update matches no rows and the coordinates are just used for this search.
  await supabase.from("associations").update({ latitude: loc.latitude, longitude: loc.longitude }).eq("id", association.id);
  return loc;
}

export async function searchContractors(tradeSlug: string): Promise<SearchResponse> {
  const trade = tradeBySlug(tradeSlug);
  if (!trade?.googleQuery) return { ok: false, reason: "bad_trade", message: "Choose a kind of work to search for." };
  if (!googleKey()) return { ok: false, reason: "no_key", message: "Contractor search isn't set up yet." };

  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { ok: false, reason: "not_allowed", message: "No association is visible to you." };
  const { data: isBoard } = await supabase.rpc("is_board", { assoc: association.id });
  if (isBoard !== true) return { ok: false, reason: "not_allowed", message: "Only board members can search for contractors." };

  try {
    const location = await buildingLocation(supabase, association);
    if (!location) {
      return {
        ok: false,
        reason: "no_address",
        message: "Add your building's address in Building Info first so we can search nearby.",
      };
    }

    let results: PlaceResult[] | null = null;
    let cached = false;
    const { data: cache } = await supabase
      .from("contractor_search_cache")
      .select("results_json, fetched_at")
      .eq("trade", trade.slug)
      .limit(1);
    const hit = cache?.[0];
    if (hit && !isStale(hit.fetched_at, new Date(), SEARCH_CACHE_HOURS / 24)) {
      results = hit.results_json as PlaceResult[];
      cached = true;
    } else {
      await logCall(supabase, association.id, "text_search", trade.slug);
      results = await searchNearby(trade.googleQuery, location.latitude, location.longitude);
      await supabase
        .from("contractor_search_cache")
        .upsert(
          { association_id: association.id, trade: trade.slug, results_json: results, fetched_at: new Date().toISOString() },
          { onConflict: "association_id,trade" },
        );
    }

    const placeIds = results.map((r) => r.placeId);
    const { data: saved } = placeIds.length
      ? await supabase.from("vendors").select("id, google_place_id").in("google_place_id", placeIds)
      : { data: [] as { id: string; google_place_id: string }[] };
    const savedByPlace = new Map((saved ?? []).map((v) => [v.google_place_id, v.id]));

    return {
      ok: true,
      cached,
      results: results.map((r) => ({
        ...r,
        distanceMiles:
          r.latitude !== null && r.longitude !== null
            ? Math.round(milesBetween(location.latitude, location.longitude, r.latitude, r.longitude) * 10) / 10
            : null,
        alreadySaved: savedByPlace.has(r.placeId),
        savedVendorId: savedByPlace.get(r.placeId) ?? null,
      })),
    };
  } catch (cause) {
    if (cause instanceof GoogleUnavailableError) {
      console.error("Google Places unavailable", cause.message);
      return {
        ok: false,
        reason: "google_down",
        message: "We couldn't reach Google right now. Try again in a minute, or add a contractor manually.",
      };
    }
    throw cause;
  }
}

/** Saves a search result as a contractor, once — a second save returns the first. */
export async function saveFromSearch(
  tradeSlug: string,
  placeId: string,
): Promise<{ ok: true; vendorId: string; alreadySaved: boolean } | { ok: false; message: string }> {
  if (!isTradeSlug(tradeSlug)) return { ok: false, message: "Unknown trade." };
  const supabase = await createClient();
  const association = await currentAssociation(supabase);
  if (!association) return { ok: false, message: "No association is visible to you." };

  const { data: existing } = await supabase.from("vendors").select("id").eq("google_place_id", placeId).limit(1);
  if (existing?.[0]) return { ok: true, vendorId: existing[0].id, alreadySaved: true };

  // Details come from the cached search the board just looked at; nothing is
  // fetched or invented that the board didn't see.
  const { data: cache } = await supabase
    .from("contractor_search_cache")
    .select("results_json, fetched_at")
    .eq("trade", tradeSlug)
    .limit(1);
  const place = ((cache?.[0]?.results_json ?? []) as PlaceResult[]).find((r) => r.placeId === placeId);
  if (!place) return { ok: false, message: "That result has expired — search again, then save it." };

  const { data, error } = await supabase
    .from("vendors")
    .insert({
      association_id: association.id,
      name: place.name,
      trades: [tradeSlug],
      trade: tradeLabel(tradeSlug),
      phone: place.phone,
      website_url: place.website,
      address: place.address,
      google_place_id: place.placeId,
      google_rating: place.rating,
      google_review_count: place.reviewCount,
      google_fetched_at: cache?.[0]?.fetched_at ?? new Date().toISOString(),
      source: "google",
      status: "okay",
    })
    .select("id");

  if (error) {
    if (error.code === "23505") {
      const { data: again } = await supabase.from("vendors").select("id").eq("google_place_id", placeId).limit(1);
      if (again?.[0]) return { ok: true, vendorId: again[0].id, alreadySaved: true };
      return { ok: false, message: "A contractor with that name is already on your list." };
    }
    return { ok: false, message: error.code === "42501" ? "Only a board member can save a contractor." : error.message };
  }

  revalidateContractors();
  return { ok: true, vendorId: data![0].id, alreadySaved: false };
}

/**
 * Re-reads Google's rating and contact details for a saved contractor. Google's
 * terms allow keeping the place id indefinitely but not the rest, so it's
 * refreshed once it's more than 30 days old (or when forced).
 */
export async function refreshGoogle(vendorId: string, force = false) {
  if (!googleKey()) return { ok: false as const, message: "Contractor search isn't set up yet." };
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("vendors")
    .select("id, association_id, google_place_id, google_fetched_at")
    .eq("id", vendorId)
    .limit(1);
  const vendor = rows?.[0];
  if (!vendor?.google_place_id) return { ok: false as const, message: "This contractor wasn't saved from Google." };
  if (!force && !isStale(vendor.google_fetched_at, new Date())) return { ok: true as const, refreshed: false };

  try {
    await logCall(supabase, vendor.association_id, "place_details", null);
    const d = await placeDetails(vendor.google_place_id);
    await supabase
      .from("vendors")
      .update({
        google_rating: d.rating,
        google_review_count: d.reviewCount,
        google_fetched_at: new Date().toISOString(),
      })
      .eq("id", vendorId);
    revalidateContractors(vendorId);
    return { ok: true as const, refreshed: true };
  } catch (cause) {
    if (cause instanceof GoogleUnavailableError) return { ok: false as const, message: cause.message };
    throw cause;
  }
}
