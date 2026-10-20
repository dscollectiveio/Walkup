"use server";

import { revalidatePath } from "next/cache";
import { snapBathrooms, splitBathrooms } from "@/lib/building/bathrooms";
import { createClient, getUser } from "@/lib/supabase/server";
import { geocode } from "@/lib/google/places";
import { validateBoardContact } from "@/lib/owner/board-contact";
import { buildingTodayIso } from "@/lib/dates";
import { parsePeople, type PersonEntry } from "@/lib/building/unit-people";
import { parseUnitType } from "@/lib/building/unit-types";
import { saveBuildingFacts } from "@/app/insurance/facts-actions";
import { freshSignInError } from "@/lib/security/fresh-signin";
import { APP_ROLES, TIMED_ACCESS_DAYS, TIMED_ROLES, isTimedRole } from "@/lib/access/outside-roles";

// Every role a person can be given here: the four original ones and the three outside roles (0077, 0080).
const ROLES = APP_ROLES;

/** The day before a yyyy-mm-dd date. */
function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The accountant's access and the three outside roles' (property manager, attorney, observer) run this many
 * days, then end unless a board admin renews it.
 */
const ACCOUNTANT_DAYS = TIMED_ACCESS_DAYS;

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").order("created_at").order("id").limit(1);
  return associations?.[0]?.id ?? null;
}

function revalidateBuilding() {
  revalidatePath("/building");
  revalidatePath("/");
  // The state, incorporation date, fiscal year end and EIN feed the Taxes
  // tab's answers and due dates.
  revalidatePath("/tax");
}

// ============================================================================
// ASSOCIATION PROFILE
// ============================================================================

export async function updateAssociationProfile(_prev: unknown, formData: FormData) {
  const legalName = String(formData.get("legal_name") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const stateCode = String(formData.get("state_code") ?? "").trim().toUpperCase();
  const county = String(formData.get("county") ?? "").trim() || null;
  const city = String(formData.get("city") ?? "").trim() || null;
  const streetAddress = String(formData.get("street_address") ?? "").trim() || null;
  const postalCode = String(formData.get("postal_code") ?? "").trim() || null;
  const optionalInt = (key: string, min: number, max: number): number | null | "invalid" => {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : "invalid";
  };
  const yearBuilt = optionalInt("year_built", 1700, 2100);
  const stories = optionalInt("stories", 1, 200);
  const roofYear = optionalInt("roof_replaced_year", 1700, 2100);
  if (yearBuilt === "invalid" || roofYear === "invalid") return { error: "Years must be four digits, like 1924." };
  if (stories === "invalid") return { error: "Stories must be a whole number." };
  const constructionType = String(formData.get("construction_type") ?? "").trim() || null;
  if (
    constructionType &&
    !["frame", "joisted_masonry", "masonry_noncombustible", "fire_resistive", "other"].includes(constructionType)
  ) {
    return { error: "Choose a construction type from the list." };
  }
  const ein = String(formData.get("ein") ?? "").trim() || null;
  const incorporatedOn = String(formData.get("incorporated_on") ?? "").trim() || null;
  const fyEndMonth = Number(formData.get("fiscal_year_end_month") ?? "");
  // Who owners write to (owner-portal-spec 6.9). All optional; the email uses the same pattern as the database.
  const contactName = String(formData.get("board_contact_name") ?? "").trim() || null;
  const contactEmail = String(formData.get("board_contact_email") ?? "").trim() || null;
  const contactPhone = String(formData.get("board_contact_phone") ?? "").trim() || null;
  const contactError = validateBoardContact({ name: contactName, email: contactEmail, phone: contactPhone });
  if (contactError) return { error: contactError };
  const capThresholdRaw = String(formData.get("capitalization_threshold") ?? "").trim();
  const capThresholdSource =
    String(formData.get("capitalization_threshold_source") ?? "").trim() || null;

  if (!legalName || !displayName) return { error: "Legal name and display name are required." };
  if (!/^[A-Z]{2}$/.test(stateCode)) return { error: "State must be a two-letter code, like IL." };
  if (!Number.isInteger(fyEndMonth) || fyEndMonth < 1 || fyEndMonth > 12) {
    return { error: "Fiscal year end month must be between 1 and 12." };
  }
  const capThreshold = capThresholdRaw === "" ? 2500 : Number(capThresholdRaw);
  if (!Number.isFinite(capThreshold) || capThreshold < 0) {
    return { error: "The capitalization threshold must be zero or more." };
  }

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  // A changed address invalidates the stored coordinates. Re-geocode only when
  // a Google key exists; otherwise they stay empty until contractor search
  // does it on first use.
  const { data: before } = await supabase
    .from("associations")
    .select("street_address, city, state_code, postal_code")
    .eq("id", associationId)
    .limit(1);
  const prev = before?.[0];
  const addressChanged =
    !prev ||
    prev.street_address !== streetAddress ||
    prev.city !== city ||
    prev.state_code !== stateCode ||
    prev.postal_code !== postalCode;
  let coordinates: { latitude: number | null; longitude: number | null } | Record<string, never> = {};
  if (addressChanged) {
    coordinates = { latitude: null, longitude: null };
    if (streetAddress) {
      try {
        const loc = await geocode([streetAddress, city, stateCode, postalCode].filter(Boolean).join(", "));
        if (loc) {
          coordinates = loc;
          await supabase.from("google_api_calls").insert({ association_id: associationId, kind: "geocode" });
        }
      } catch (cause) {
        console.error("Geocoding failed; address saved without coordinates", cause);
      }
    }
  }

  const { data, error } = await supabase
    .from("associations")
    .update({
      legal_name: legalName,
      display_name: displayName,
      state_code: stateCode,
      county,
      city,
      street_address: streetAddress,
      postal_code: postalCode,
      ...coordinates,
      year_built: yearBuilt,
      construction_type: constructionType,
      stories,
      roof_replaced_year: roofYear,
      incorporated_on: incorporatedOn,
      fiscal_year_end_month: fyEndMonth,
      capitalization_threshold: capThreshold,
      capitalization_threshold_source: capThresholdSource,
      board_contact_name: contactName,
      board_contact_email: contactEmail,
      board_contact_phone: contactPhone,
    })
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can edit the association's profile." };
  }

  // The EIN lives apart from the association row, where owners can't read it.
  const { error: einError } = await supabase
    .from("association_tax_ids")
    .upsert({ association_id: associationId, ein, updated_at: new Date().toISOString() }, { onConflict: "association_id" });
  if (einError) return { error: einError.message };

  revalidateBuilding();
  return { ok: true };
}

/**
 * The Association profile card's single Save: the profile fields (board
 * admin only, sent when `_profile` is set) and the insurance facts it shows
 * (any board member, named in `_keys`). Profile first, so a refused profile
 * never leaves half the card saved.
 */
export async function saveAssociationSummary(
  _prev: unknown,
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  if (formData.get("_profile") === "1") {
    const profile = await updateAssociationProfile(null, formData);
    if ("error" in profile && profile.error) return { error: profile.error };
  }
  if (String(formData.get("_keys") ?? "").trim()) {
    const facts = await saveBuildingFacts(null, formData);
    if ("error" in facts) {
      return {
        error: formData.get("_profile") === "1"
          ? `The profile was saved, but the insurance details were not: ${facts.error}`
          : facts.error,
      };
    }
  }
  revalidateBuilding();
  return { ok: true };
}

// ============================================================================
// UNITS
// ============================================================================

function unitFields(formData: FormData) {
  const int = (key: string) => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const baths = snapBathrooms(String(formData.get("bathrooms") ?? ""));
  const rawFloor = int("floor");
  const floor = rawFloor !== null && Number.isInteger(rawFloor) && rawFloor >= -5 && rawFloor <= 200 ? rawFloor : null;
  return {
    label: String(formData.get("label") ?? "").trim(),
    unit_type: parseUnitType(formData.get("unit_type")),
    floor,
    notes: String(formData.get("notes") ?? "").trim().slice(0, 1000) || null,
    // The roster's order follows the floor; a unit with no floor keeps the order it has.
    ...(floor !== null ? { sort_order: floor } : {}),
    square_footage: int("square_footage"),
    bedroom_count: int("bedroom_count"),
    // One "Bathrooms" box (2.5 is two full baths and a half); kept in the two columns the database has.
    full_bathrooms: baths === null ? null : splitBathrooms(baths).full,
    half_bathrooms: baths === null ? null : splitBathrooms(baths).half,
  };
}

export async function addUnit(_prev: unknown, formData: FormData) {
  const fields = unitFields(formData);
  if (!fields.label) return { error: "Give the unit a label, like “Unit 4”." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase
    .from("units")
    .insert({ association_id: associationId, ...fields });

  if (error) {
    if (error.code === "23505") {
      return { error: `A unit named “${fields.label}” already exists.` };
    }
    return { error: error.message };
  }

  revalidateBuilding();
  revalidatePath("/repairs");
  return { ok: true };
}

type Db = Awaited<ReturnType<typeof createClient>>;

// A unit's page is now its row on Building & Owners, so revalidating the building covers it.
function revalidateUnit(unitId: string) {
  void unitId;
  revalidateBuilding();
  revalidatePath("/repairs");
  revalidatePath("/dues");
  revalidatePath("/building");
}

/**
 * Adds the people from a unit form who are new to the unit: someone entirely
 * new (a person, their roles, optionally the ownership) or someone already on
 * file (just the ownership). Returns a sentence for the first thing that
 * failed, or null. Earlier steps stay saved, so the sentence says what the
 * board still has to do.
 */
async function addPeopleToUnit(
  supabase: Db,
  associationId: string,
  unitId: string,
  entries: Extract<PersonEntry, { kind: "new" | "link" }>[],
): Promise<string | null> {
  for (const e of entries) {
    let personId: string;
    let name: string;
    if (e.kind === "new") {
      name = e.fields.full_name;
      const { data: created, error } = await supabase
        .from("persons")
        .insert({ association_id: associationId, ...e.fields })
        .select("id")
        .single();
      if (error || !created) {
        return error?.code === "23505"
          ? `${name} couldn't be saved: someone with that email is already on file. Choose them from the list instead.`
          : `${name} couldn't be saved: ${error?.message ?? "try again."}`;
      }
      personId = created.id;
      if (e.rolesSubmitted) {
        const roleError = await syncPersonRoles(supabase, personId, e.roles);
        if (roleError) return `${name}'s role couldn't be saved: ${roleError} You can set it on their row.`;
      }
    } else {
      personId = e.personId;
      name = "That person";
    }
    if (e.owns) {
      const { error } = await supabase.from("unit_owners").insert({
        association_id: associationId,
        unit_id: unitId,
        person_id: personId,
        effective_from: e.since,
      });
      if (error) return `${name} couldn't be recorded as an owner: ${error.message} Use Edit on the unit to add them.`;
    }
  }
  return null;
}

/**
 * Adds a unit and, in the same step, everyone who is in it: any number of new
 * people (name, contact details, role in the HOA) or people already on file,
 * or no one yet. The writes happen in order and each is its own request, so if
 * a later one fails the earlier ones stay. The message then says exactly what
 * was saved and what was not, rather than pretending the whole thing failed;
 * the unit shows up in the list either way.
 */
export async function addUnitWithPerson(_prev: unknown, formData: FormData) {
  const fields = unitFields(formData);
  if (!fields.label) return { error: "Give the unit a label, like “Unit 4”." };

  const parsed = parsePeople(formData, buildingTodayIso());
  if (!parsed.ok) return { error: parsed.error };
  const additions = parsed.entries.filter((e): e is Extract<PersonEntry, { kind: "new" | "link" }> => e.kind !== "resident");

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data: unit, error: unitError } = await supabase
    .from("units")
    .insert({ association_id: associationId, ...fields })
    .select("id")
    .single();
  if (unitError || !unit) {
    if (unitError?.code === "23505") return { error: `A unit named “${fields.label}” already exists.` };
    return { error: unitError?.message ?? "Couldn't add the unit." };
  }

  const problem = await addPeopleToUnit(supabase, associationId, unit.id, additions);
  revalidateUnit(unit.id);
  if (problem) return { error: `${fields.label} was added, but ${problem}` };
  return { ok: true };
}

/**
 * The single Edit on a unit: saves the unit's details, every resident's
 * details and roles, removes anyone marked as no longer there, and adds anyone
 * new, all from one form. Steps run in that order; if one fails the earlier
 * ones stay saved and the message says which.
 */
export async function saveUnitAndPeople(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const fields = unitFields(formData);
  if (!unitId) return { error: "Missing unit." };
  if (!fields.label) return { error: "Give the unit a label, like “Unit 4”." };

  const today = buildingTodayIso();
  const parsed = parsePeople(formData, today);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data: updated, error: unitError } = await supabase.from("units").update(fields).eq("id", unitId).select("id");
  if (unitError) {
    if (unitError.code === "23505") return { error: `A unit named “${fields.label}” already exists.` };
    return { error: unitError.message };
  }
  if (!updated || updated.length === 0) return { error: "Only the board can edit units." };

  const stop = (what: string) => {
    revalidateUnit(unitId);
    return { error: `The unit's details were saved, but ${what}` };
  };

  for (const e of parsed.entries) {
    if (e.kind !== "resident") continue;
    if (e.remove) {
      const { data: row } = await supabase.from("unit_owners").select("effective_from").eq("id", e.ownerRowId).single();
      if (row && row.effective_from < e.endDate) {
        // effective_to is the LAST day they were in the unit, and the unit's people are everyone whose
        // effective_to is today or later. A past date is kept as typed (a sale last month is last month)
        // and a future one too (they are leaving next week). But "left today" must end YESTERDAY: ending
        // it today kept them in the unit all day, which looked like the removal had been undone.
        const endsOn = e.endDate === today ? dayBefore(today) : e.endDate;
        const { data, error } = await supabase.from("unit_owners").update({ effective_to: endsOn }).eq("id", e.ownerRowId).select("id");
        if (error || !data || data.length === 0) return stop(`${e.fields.full_name || "a person"} couldn't be removed from the unit: ${error?.message ?? "only the board can change ownership."}`);
      } else {
        // They were only recorded from that date on (or later), so there is nothing to end-date: the record has to be deleted, which only a board admin may do.
        const { data, error } = await supabase.from("unit_owners").delete().eq("id", e.ownerRowId).select("id");
        if (error || !data || data.length === 0) return stop(`that person's ownership starts on or after that date, so only a board admin can remove it${error ? `: ${error.message}` : "."}`);
      }
      continue;
    }
    const { data, error } = await supabase.from("persons").update(e.fields).eq("id", e.personId).select("id");
    if (error) {
      return stop(
        error.code === "23505" ? `${e.fields.full_name}'s email is already used by someone else on file.` : `${e.fields.full_name} couldn't be saved: ${error.message}`,
      );
    }
    if (!data || data.length === 0) return stop(`${e.fields.full_name} couldn't be saved: only the board can edit contact details.`);
    if (e.rolesSubmitted) {
      const roleError = await syncPersonRoles(supabase, e.personId, e.roles);
      if (roleError) return stop(`${e.fields.full_name}'s role couldn't be saved: ${roleError}`);
    }
  }

  const additions = parsed.entries.filter((e): e is Extract<PersonEntry, { kind: "new" | "link" }> => e.kind !== "resident");
  const problem = await addPeopleToUnit(supabase, associationId, unitId, additions);
  revalidateUnit(unitId);
  if (problem) return { error: `The unit and the other changes were saved, but ${problem}` };
  return { ok: true };
}

export async function updateUnit(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const fields = unitFields(formData);
  if (!unitId) return { error: "Missing unit." };
  if (!fields.label) return { error: "Give the unit a label, like “Unit 4”." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("units").update(fields).eq("id", unitId).select("id");

  if (error) {
    if (error.code === "23505") {
      return { error: `A unit named “${fields.label}” already exists.` };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) return { error: "Only the board can edit units." };

  revalidateBuilding();
  revalidatePath("/repairs");
  revalidatePath("/building");
  return { ok: true };
}

export async function deleteUnit(unitId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("units").delete().eq("id", unitId).select("id");

  if (error) {
    if (error.code === "23503") {
      return {
        error: "This unit has charges, payments, or other history on record and can't be deleted.",
      };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) {
    return { error: "Only a board admin can delete a unit." };
  }

  revalidateBuilding();
  revalidatePath("/repairs");
  return { ok: true };
}

// ============================================================================
// PEOPLE
// ============================================================================

function personFields(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    mailing_address: String(formData.get("mailing_address") ?? "").trim() || null,
  };
}

export async function addPerson(_prev: unknown, formData: FormData) {
  const fields = personFields(formData);
  if (!fields.full_name) return { error: "Give this person a name." };

  const roles = formData.getAll("roles").map(String);
  for (const r of roles) if (!ROLES.includes(r as (typeof ROLES)[number])) return { error: "Unrecognized role." };
  const rolesSubmitted = formData.get("roles_submitted") === "1";
  const unitId = String(formData.get("unit_id") ?? "").trim();
  const since = String(formData.get("effective_from") ?? "").trim() || buildingTodayIso();
  if (unitId && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return { error: "Enter the date they became the owner." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data: created, error } = await supabase
    .from("persons")
    .insert({ association_id: associationId, ...fields })
    .select("id")
    .single();

  if (error || !created) {
    if (error?.code === "23505") {
      return { error: "Someone with that email is already on file." };
    }
    return { error: error?.message ?? "Couldn't add the person." };
  }

  // The person is saved from here on; a later step failing says so rather than implying nothing happened.
  let problem: string | null = null;
  if (rolesSubmitted) {
    const roleError = await syncPersonRoles(supabase, created.id, roles);
    if (roleError) problem = `their role couldn't be saved: ${roleError} You can set it on their row.`;
  }
  if (!problem && unitId) {
    const { error: ownerError } = await supabase.from("unit_owners").insert({
      association_id: associationId,
      unit_id: unitId,
      person_id: created.id,
      effective_from: since,
    });
    if (ownerError) problem = `they couldn't be put in the unit: ${ownerError.message} Use Edit on the unit to add them.`;
  }

  revalidateBuilding();
  if (unitId) revalidateUnit(unitId);
  if (problem) return { error: `${fields.full_name} was added, but ${problem}` };
  return { ok: true };
}

export async function updatePerson(_prev: unknown, formData: FormData) {
  const personId = String(formData.get("person_id") ?? "");
  const fields = personFields(formData);
  if (!personId) return { error: "Missing person." };
  if (!fields.full_name) return { error: "Give this person a name." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("persons")
    .update(fields)
    .eq("id", personId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { error: "Someone with that email is already on file." };
    }
    return { error: error.message };
  }
  if (!data || data.length === 0) {
    return { error: "You can only edit your own contact details, or you're not on the board." };
  }

  // Roles inputs only render for a board_admin (person-row.tsx) — this
  // sentinel is how a board_member's submission (contact info only) is told
  // apart from a board_admin submission with every role box unchecked, which
  // would otherwise look identical to formData.getAll("roles") and revoke
  // everyone's access.
  if (formData.get("roles_submitted") === "1") {
    const roleError = await syncPersonRoles(
      supabase,
      personId,
      formData.getAll("roles").map(String),
    );
    if (roleError) return { error: roleError };
  }

  revalidateBuilding();
  return { ok: true };
}

/**
 * Reconciles a person's role_grants against the checked roles from the
 * building page's Units and people section (merged with role granting/revoking per
 * Doug's request — previously a separate "Role grants" card). Only the
 * roles that actually changed are touched, so an unchanged role keeps its
 * original granted_on/expires_on rather than resetting on every save.
 */
async function syncPersonRoles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personId: string,
  selectedRoles: string[],
): Promise<string | null> {
  for (const r of selectedRoles) {
    if (!ROLES.includes(r as (typeof ROLES)[number])) return "Unrecognized role.";
  }

  const associationId = await currentAssociationId(supabase);
  if (!associationId) return "No association is visible to you.";

  const user = await getUser();
  if (!user) return "Not signed in.";

  const { data: currentGrants, error: fetchError } = await supabase
    .from("role_grants")
    .select("id, role")
    .eq("person_id", personId)
    .is("revoked_at", null);
  if (fetchError) return fetchError.message;

  const selected = new Set(selectedRoles);
  const currentRoles = new Set((currentGrants ?? []).map((g) => g.role));

  // Only an actual change needs a recent two-step code; saving a form with the
  // roles untouched does not.
  const changes =
    [...selected].some((r) => !currentRoles.has(r)) || [...currentRoles].some((r) => !selected.has(r));
  if (changes) {
    const stale = await freshSignInError(supabase);
    if (stale) return stale;
  }

  for (const role of selected) {
    if (currentRoles.has(role)) continue;

    // "accountant grants expire; default 90d set in app" — see the comment
    // on role_grants.expires_on in 0001_core_schema.sql. The outside roles always end too (0080 refuses
    // one without an end date).
    const expiresOn = isTimedRole(role) ? inDays(ACCOUNTANT_DAYS) : null;

    const { error } = await supabase.from("role_grants").upsert(
      {
        association_id: associationId,
        person_id: personId,
        role,
        granted_on: new Date().toISOString().slice(0, 10),
        granted_by: user.id,
        expires_on: expiresOn,
        revoked_at: null,
        revoked_by: null,
      },
      { onConflict: "association_id,person_id,role" },
    );
    if (error) return error.message;
  }

  for (const grant of currentGrants ?? []) {
    if (selected.has(grant.role)) continue;

    const { error } = await supabase
      .from("role_grants")
      .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
      .eq("id", grant.id);
    if (error) return error.message;
  }

  return null;
}

// ============================================================================
// UNIT OWNERSHIP (who occupies/owns a unit, over time — separate from
// percentage; see ownership amendments below)
// ============================================================================

/**
 * Assigns a person to a unit, optionally closing out whoever held it before.
 * The new row is inserted BEFORE the old one is closed, deliberately: a
 * failure between the two steps then leaves a harmless overlap (both people
 * briefly show as current) rather than a gap (someone silently locked out
 * of a unit they still own).
 */
export async function changeUnitOwner(_prev: unknown, formData: FormData) {
  const unitId = String(formData.get("unit_id") ?? "");
  const personId = String(formData.get("person_id") ?? "");
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const closingRowId = String(formData.get("closing_row_id") ?? "").trim() || null;

  if (!unitId || !personId) return { error: "Choose a unit and a person." };
  if (!effectiveFrom) return { error: "Enter the date this takes effect." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error: insertError } = await supabase.from("unit_owners").insert({
    association_id: associationId,
    unit_id: unitId,
    person_id: personId,
    effective_from: effectiveFrom,
  });
  if (insertError) return { error: insertError.message };

  if (closingRowId) {
    const dayBefore = new Date(`${effectiveFrom}T00:00:00`);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const effectiveTo = dayBefore.toISOString().slice(0, 10);

    const { error: closeError } = await supabase
      .from("unit_owners")
      .update({ effective_to: effectiveTo })
      .eq("id", closingRowId);

    if (closeError) {
      // The new owner is already recorded — surface this as a warning to
      // finish manually rather than implying the whole action failed.
      return {
        ok: true as const,
        warning: `The new owner is recorded, but the previous owner's record couldn't be closed out: ${closeError.message}`,
      };
    }
  }

  revalidateBuilding();
  revalidatePath("/delinquency");
  revalidatePath("/building");
  return { ok: true };
}

/** A unit becomes vacant — closes the current owner's row with no replacement. */
export async function endUnitOwnership(_prev: unknown, formData: FormData) {
  const rowId = String(formData.get("row_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const effectiveTo = String(formData.get("effective_to") ?? "");
  if (!rowId) return { error: "Missing record." };
  if (!effectiveTo) return { error: "Enter the date this takes effect." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_owners")
    .update({ effective_to: effectiveTo })
    .eq("id", rowId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: "Only the board can change unit ownership." };

  revalidateBuilding();
  revalidatePath("/delinquency");
  if (unitId) revalidatePath("/building");
  return { ok: true };
}

/**
 * Hard-deletes a unit_owners row outright — for a data-entry mistake (the
 * wrong person assigned to a unit), not a real ownership change. A real
 * change should still go through endUnitOwnership, which closes the row
 * with an effective_to date and keeps it on record; this exists only to
 * remove a row that should never have been created. board_admin only
 * (0030), one step stricter than endUnitOwnership/changeUnitOwner's is_board.
 */
export async function deleteUnitOwner(rowId: string, unitId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_owners")
    .delete()
    .eq("id", rowId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can remove an ownership record." };
  }

  revalidateBuilding();
  revalidatePath("/delinquency");
  if (unitId) revalidatePath("/building");
  return { ok: true as const };
}

/**
 * Deletes a former member: a person whose details were already removed, when no
 * payment, ownership, email, repair or document still refers to them (0067).
 * Board admin only; the database says why when it can't.
 */
export async function deleteFormerMember(personId: string): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) return { error: "Choose someone to delete." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_former_member", { p_person_id: personId });
  if (error) {
    if (error.code === "42501") return { error: "Only a board admin can delete a former member." };
    if (error.code === "22023" && error.message) return { error: error.message };
    console.error("[building] delete_former_member", error.code ?? "-");
    return { error: "Couldn't delete that. Try again." };
  }
  revalidateBuilding();
  return { ok: true };
}

/**
 * Deletes one ownership percentage change (an amendment and its lines). Board
 * admin only (the database allows nobody else). The units' shares go back to
 * the previous recorded split, or to none if this was the only one. The audit
 * log keeps a record that it was deleted.
 */
export async function deleteOwnershipAmendment(id: string): Promise<{ ok: true } | { error: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { error: "Choose a change to delete." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("ownership_amendments").delete().eq("id", id).select("id");
  if (error) return { error: "Couldn't delete that. Try again." };
  if (!data || data.length === 0) return { error: "Only a board admin can delete an ownership change." };
  revalidateBuilding();
  revalidatePath("/tax");
  return { ok: true };
}

// ============================================================================
// OWNERSHIP PERCENTAGES (amendments — see DECISIONS #7)
// ============================================================================

/**
 * Records a new ownership amendment covering every unit in the association.
 * The percentage inputs are named percentage_<unit_id> so the form can be
 * generated from the unit list without knowing field names in advance.
 */
export async function recordOwnershipAmendment(_prev: unknown, formData: FormData) {
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const recordedDocumentRef =
    String(formData.get("recorded_document_ref") ?? "").trim() || null;
  if (!effectiveFrom) return { error: "Enter the date this amendment takes effect." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data: units } = await supabase
    .from("units")
    .select("id")
    .eq("association_id", associationId);
  if (!units || units.length === 0) return { error: "Add units before recording ownership." };

  const lines = units.map((u) => ({
    unit_id: u.id,
    percentage: Number(formData.get(`percentage_${u.id}`) ?? "0"),
  }));

  const total = lines.reduce((s, l) => s + l.percentage, 0);
  if (Math.abs(total - 100) > 0.0001) {
    return { error: `Percentages must add up to 100. They currently total ${total.toFixed(4)}.` };
  }

  const { error } = await supabase.rpc("record_ownership_amendment", {
    p_association_id: associationId,
    p_effective_from: effectiveFrom,
    p_lines: lines,
    p_reason: reason,
    p_recorded_document_ref: recordedDocumentRef,
  });
  if (error) return { error: error.message };

  revalidateBuilding();
  return { ok: true };
}

// ============================================================================
// INVITES
// ============================================================================

export async function createInvite(_prev: unknown, formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const email = String(formData.get("email") ?? "").trim() || null;
  // An owner invite may point at someone already in the list (claim your record, 0054).
  const personRaw = String(formData.get("person_id") ?? "").trim();
  const personId = role === "owner" && personRaw !== "" ? personRaw : null;

  if (!ROLES.includes(role as (typeof ROLES)[number])) return { error: "Choose a role." };
  // Any link for a role other than owner only works for the email it was made for (0075).
  if (role !== "owner" && (!email || !/^[^@\s]+@[^@\s]+$/.test(email))) {
    return { error: "Enter the email address this person will sign in with. The link only works for that email." };
  }
  if (personId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
    return { error: "Choose someone from the list, or leave it blank." };
  }

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };

  const { error } = await supabase.from("invites").insert({
    association_id: associationId,
    role,
    email,
    ...(personId ? { person_id: personId } : {}),
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidateBuilding();
  return { ok: true };
}

/**
 * Gives an accountant, property manager, attorney or observer another 90 days from today. Board admins only
 * (role_grants RLS). The name is kept from when the accountant was the only role that ends.
 */
export async function extendAccountantAccess(personId: string): Promise<{ ok?: true; error?: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) return { error: "Missing person." };
  const supabase = await createClient();
  const stale = await freshSignInError(supabase);
  if (stale) return { error: stale };
  const { data, error } = await supabase
    .from("role_grants")
    .update({ expires_on: inDays(ACCOUNTANT_DAYS), revoked_at: null, revoked_by: null })
    .eq("person_id", personId)
    .in("role", [...TIMED_ROLES])
    // Also brings back access the daily clean-up just ended (revoked by the system, not by a person).
    .or("revoked_at.is.null,revoked_by.is.null")
    .select("id");
  if (error) return { error: "Couldn't extend that. Try again." };
  if (!data || data.length === 0) return { error: "Only a board admin can extend access." };
  revalidateBuilding();
  return { ok: true };
}

export async function deleteInvite(inviteId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invites").delete().eq("id", inviteId).select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "That invite is already gone, or only a board admin can remove it." };
  }

  revalidateBuilding();
  return { ok: true };
}

// ============================================================================
// ACCESS REVIEWS AND PERSONAL-DATA REDACTION (0037, DECISIONS #30)
// ============================================================================

export async function recordAccessReview(_prev: unknown, formData: FormData) {
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { data, error } = await supabase.rpc("record_access_review", {
    p_association_id: associationId,
    p_notes: notes,
  });
  if (error) return { error: error.message };

  revalidateBuilding();
  const revoked = (data as { revoked_count?: number } | null)?.revoked_count ?? 0;
  return { ok: true, revoked };
}

export async function redactPerson(personId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("redact_person", { p_person_id: personId });
  if (error) return { error: error.message };

  revalidateBuilding();
  return { ok: true };
}
