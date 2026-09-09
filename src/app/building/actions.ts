"use server";

import { revalidatePath } from "next/cache";
import { createClient, getUser } from "@/lib/supabase/server";

const ROLES = ["board_admin", "board_member", "accountant", "owner"] as const;

async function currentAssociationId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: associations } = await supabase.from("associations").select("id").limit(1);
  return associations?.[0]?.id ?? null;
}

function revalidateBuilding() {
  revalidatePath("/building");
  revalidatePath("/");
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
  const ein = String(formData.get("ein") ?? "").trim() || null;
  const incorporatedOn = String(formData.get("incorporated_on") ?? "").trim() || null;
  const fyEndMonth = Number(formData.get("fiscal_year_end_month") ?? "");
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

  const { data, error } = await supabase
    .from("associations")
    .update({
      legal_name: legalName,
      display_name: displayName,
      state_code: stateCode,
      county,
      city,
      ein,
      incorporated_on: incorporatedOn,
      fiscal_year_end_month: fyEndMonth,
      capitalization_threshold: capThreshold,
      capitalization_threshold_source: capThresholdSource,
    })
    .eq("id", associationId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can edit the association's profile." };
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
  return {
    label: String(formData.get("label") ?? "").trim(),
    sort_order: int("sort_order") ?? 0,
    square_footage: int("square_footage"),
    bedroom_count: int("bedroom_count"),
    full_bathrooms: int("full_bathrooms"),
    half_bathrooms: int("half_bathrooms"),
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
  revalidatePath("/maintenance");
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
  revalidatePath("/maintenance");
  revalidatePath(`/units/${unitId}`);
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
  revalidatePath("/maintenance");
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

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const { error } = await supabase
    .from("persons")
    .insert({ association_id: associationId, ...fields });

  if (error) {
    if (error.code === "23505") {
      return { error: "Someone with that email is already on file." };
    }
    return { error: error.message };
  }

  revalidateBuilding();
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

  revalidateBuilding();
  return { ok: true };
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
  revalidatePath(`/units/${unitId}`);
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
  if (unitId) revalidatePath(`/units/${unitId}`);
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
  if (unitId) revalidatePath(`/units/${unitId}`);
  return { ok: true as const };
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
    return { error: `Percentages must add up to 100 — they currently total ${total.toFixed(4)}.` };
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
// ROLE GRANTS
// ============================================================================

/**
 * Grants a role, or re-grants one that was previously revoked. role_grants
 * has UNIQUE(association_id, person_id, role), so re-granting is an upsert —
 * every field that should "reset" is set explicitly, since Postgres column
 * defaults don't apply on the ON CONFLICT DO UPDATE path.
 */
export async function grantRole(_prev: unknown, formData: FormData) {
  const personId = String(formData.get("person_id") ?? "");
  const role = String(formData.get("role") ?? "");
  const expiresOnRaw = String(formData.get("expires_on") ?? "").trim();

  if (!personId) return { error: "Choose a person." };
  if (!ROLES.includes(role as (typeof ROLES)[number])) return { error: "Choose a role." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  // "accountant grants expire; default 90d set in app" — see the comment on
  // role_grants.expires_on in 0001_core_schema.sql.
  let expiresOn: string | null = expiresOnRaw || null;
  if (!expiresOn && role === "accountant") {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    expiresOn = d.toISOString().slice(0, 10);
  }

  const { error } = await supabase
    .from("role_grants")
    .upsert(
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

  if (error) return { error: error.message };

  revalidateBuilding();
  return { ok: true };
}

export async function revokeRole(roleGrantId: string): Promise<{ ok?: true; error?: string }> {
  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", roleGrantId)
    .select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can revoke a role." };
  }

  revalidateBuilding();
  return { ok: true };
}

// ============================================================================
// INVITES
// ============================================================================

export async function createInvite(_prev: unknown, formData: FormData) {
  const role = String(formData.get("role") ?? "");
  const email = String(formData.get("email") ?? "").trim() || null;

  if (!ROLES.includes(role as (typeof ROLES)[number])) return { error: "Choose a role." };

  const supabase = await createClient();
  const associationId = await currentAssociationId(supabase);
  if (!associationId) return { error: "No association is visible to you." };

  const user = await getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("invites").insert({
    association_id: associationId,
    role,
    email,
    created_by: user.id,
  });

  if (error) return { error: error.message };

  revalidateBuilding();
  return { ok: true };
}

export async function deleteInvite(inviteId: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("invites").delete().eq("id", inviteId).select("id");

  if (error) return { error: error.message };
  if (!data || data.length === 0) {
    return { error: "Only a board admin can revoke an invite." };
  }

  revalidateBuilding();
  return { ok: true };
}
