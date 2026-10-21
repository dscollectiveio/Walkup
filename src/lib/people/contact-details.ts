import type { Supabase } from "@/lib/repairs/server";

/**
 * A person's phone and mailing address live in person_contact_details, not on persons (0082, DECISIONS #50).
 * The accountant, other owners and observers have no policy on it, so a page they can open must not ask for
 * it; the board, the person themselves and a property manager read it. Reads come back empty for anyone
 * else rather than failing.
 */
export interface ContactDetails {
  phone: string | null;
  mailing_address: string | null;
}

export const NO_CONTACT: ContactDetails = { phone: null, mailing_address: null };

/** Contact details for these people, by person id. A person with none on file is absent from the map. */
export async function loadContactDetails(supabase: Supabase, personIds: string[]): Promise<Map<string, ContactDetails>> {
  const out = new Map<string, ContactDetails>();
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("person_contact_details").select("person_id, phone, mailing_address").in("person_id", ids);
  if (error) {
    console.error("[contact-details] read", error.code ?? "-");
    return out;
  }
  for (const r of (data ?? []) as { person_id: string; phone: string | null; mailing_address: string | null }[]) {
    out.set(r.person_id, { phone: r.phone, mailing_address: r.mailing_address });
  }
  return out;
}

/**
 * Every contact-details row the caller may read: the board's and a property manager's pages, which list the
 * whole building, use this instead of a long id list.
 */
export async function loadAllContactDetails(supabase: Supabase): Promise<Map<string, ContactDetails>> {
  const out = new Map<string, ContactDetails>();
  const { data, error } = await supabase.from("person_contact_details").select("person_id, phone, mailing_address").limit(5000);
  if (error) {
    console.error("[contact-details] read all", error.code ?? "-");
    return out;
  }
  for (const r of (data ?? []) as { person_id: string; phone: string | null; mailing_address: string | null }[]) {
    out.set(r.person_id, { phone: r.phone, mailing_address: r.mailing_address });
  }
  return out;
}

/**
 * Board only (RLS refuses anyone else): set a person's phone and address. Both blank removes the row.
 * With `keepAddress` only the phone is set and the address on file is left as it is (the property manager
 * form has a phone field and no address field).
 * Returns the database error on failure, null on success.
 */
export async function saveContactDetails(
  supabase: Supabase,
  associationId: string,
  personId: string,
  details: ContactDetails & { keepAddress?: boolean },
): Promise<{ code: string | null; message: string } | null> {
  const phone = details.phone?.trim() || null;
  let address = details.mailing_address?.trim() || null;
  if (details.keepAddress) {
    const { data } = await supabase.from("person_contact_details").select("mailing_address").eq("person_id", personId).maybeSingle();
    address = (data?.mailing_address as string | null | undefined) ?? null;
  }
  if (!phone && !address) {
    const { error } = await supabase.from("person_contact_details").delete().eq("person_id", personId);
    return error ? { code: error.code ?? null, message: error.message } : null;
  }
  const { error } = await supabase
    .from("person_contact_details")
    .upsert({ person_id: personId, association_id: associationId, phone, mailing_address: address }, { onConflict: "person_id" });
  return error ? { code: error.code ?? null, message: error.message } : null;
}
