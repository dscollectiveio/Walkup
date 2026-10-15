"use server";

import type { CoverageType } from "@/lib/insurance/coverage";
import { friendlyDbError } from "@/lib/insurance/errors";
import type { Supabase } from "@/lib/insurance/queries";
import { actionContext, cleanText, isUuid, revalidateInsurance } from "./action-helpers";

/**
 * Insurance contacts (insurance-spec §8.6): the board's agent, agencies and
 * insurers it saved from the Marketplace, and partners listed with Walkup.
 * Saving a found contact reads the cached research row, never client data,
 * so only what was verified against the search (decision 5) is stored.
 */

const BOARD_ONLY = "Only a board member can change contacts.";
const KINDS = ["agent", "agency", "broker", "insurer", "adjuster", "other"] as const;
export type ContactKind = (typeof KINDS)[number];
const CONTACT_LINES = new Set([
  "property", "general_liability", "directors_officers", "umbrella", "flood", "workers_comp", "fidelity_crime",
  "equipment_breakdown", "cyber", "earthquake", "employment_practices", "other",
]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const DUPLICATE = "A contact with that name and email already exists.";

export interface ContactInput {
  id: string | null;
  kind: ContactKind;
  name: string;
  personName: string | null;
  email: string | null;
  phone: string | null;
  websiteUrl: string | null;
  city: string | null;
  stateCode: string | null;
  lines: CoverageType[];
  isCurrentAgent: boolean;
  notes: string | null;
}

export async function saveContact(input: ContactInput): Promise<{ ok: true; contactId: string } | { error: string; fieldErrors?: Record<string, string> }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;

  const fieldErrors: Record<string, string> = {};
  const name = cleanText(input.name, 200);
  if (!name) fieldErrors.name = "Enter a name.";
  const kind = (KINDS as readonly string[]).includes(input.kind) ? input.kind : null;
  if (!kind) fieldErrors.kind = "Choose what kind of contact this is.";
  const email = cleanText(input.email, 320);
  if (email && !EMAIL_RE.test(email)) fieldErrors.email = "Check the email address.";
  const website = cleanText(input.websiteUrl, 500);
  if (website && !URL_RE.test(website)) fieldErrors.websiteUrl = "Enter the full web address, starting with https://.";
  const state = cleanText(input.stateCode, 2)?.toUpperCase() ?? null;
  if (state && !/^[A-Z]{2}$/.test(state)) fieldErrors.stateCode = "Use the two-letter state code, like IL.";
  const id = input.id && isUuid(input.id) ? input.id : null;
  if (input.id && !id) return { error: "That contact was not found." };
  const keys = Object.keys(fieldErrors);
  if (keys.length) return { error: fieldErrors[keys[0]], fieldErrors };

  const row = {
    kind,
    name,
    person_name: cleanText(input.personName, 200),
    email,
    phone: cleanText(input.phone, 40),
    website_url: website,
    city: cleanText(input.city, 120),
    state_code: state,
    lines: [...new Set((input.lines ?? []).filter((l) => CONTACT_LINES.has(l)))],
    notes: cleanText(input.notes, 2000),
    is_current_agent: false,
    updated_at: new Date().toISOString(),
  };

  let contactId: string;
  if (id) {
    const { data, error } = await supabase.from("insurance_contacts").update(row).eq("id", id).select("id");
    if (error) return error.code === "23505" ? { error: DUPLICATE } : friendlyDbError(error, "Walkup couldn't save this contact. Try again.");
    if (!data || data.length === 0) return { error: "That contact was not found." };
    contactId = id;
  } else {
    const { data, error } = await supabase
      .from("insurance_contacts")
      .insert({ ...row, association_id: association.id, source: "manual" })
      .select("id")
      .single();
    if (error || !data) {
      return error?.code === "23505" ? { error: DUPLICATE } : friendlyDbError(error ?? { message: "" }, "Walkup couldn't save this contact. Try again.");
    }
    contactId = (data as { id: string }).id;
  }

  if (input.isCurrentAgent === true) {
    const { error } = await supabase.rpc("set_current_insurance_agent", { p_contact_id: contactId });
    if (error) return friendlyDbError(error, "The contact was saved, but Walkup couldn't make it your current agent. Try again.");
  }
  revalidateInsurance();
  return { ok: true, contactId };
}

export async function archiveContact(contactId: string, archived: boolean): Promise<{ ok: true } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  if (!isUuid(contactId)) return { error: "That contact was not found." };
  const patch = archived
    ? { archived_at: new Date().toISOString(), is_current_agent: false, updated_at: new Date().toISOString() }
    : { archived_at: null, updated_at: new Date().toISOString() };
  const { data, error } = await ctx.supabase.from("insurance_contacts").update(patch).eq("id", contactId).select("id");
  if (error) {
    return error.code === "23505"
      ? { error: "A contact with that name and email is already in your list. Archive or edit that one first." }
      : friendlyDbError(error, "Walkup couldn't change this contact. Try again.");
  }
  if (!data || data.length === 0) return { error: "That contact was not found." };
  revalidateInsurance();
  return { ok: true };
}

/** An existing contact with this found key, or this name and email. */
async function existingContact(supabase: Supabase, associationId: string, foundKey: string | null, name: string, email: string | null): Promise<string | null> {
  if (foundKey) {
    const { data } = await supabase
      .from("insurance_contacts")
      .select("id")
      .eq("association_id", associationId)
      .eq("found_key", foundKey)
      .is("archived_at", null)
      .limit(1);
    const hit = ((data ?? [])[0] as { id: string } | undefined)?.id;
    if (hit) return hit;
  }
  const escape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  let q = supabase.from("insurance_contacts").select("id").eq("association_id", associationId).is("archived_at", null).ilike("name", escape(name));
  q = email ? q.ilike("email", escape(email)) : q.is("email", null);
  const { data } = await q.limit(1);
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
}

interface FoundItem {
  key: string; name: string; website: string | null; city?: string | null; state?: string | null;
  phone?: string | null; email?: string | null; lines?: string[]; sourceUrls?: string[];
}

export async function saveFoundContact(input: { kind: "agencies" | "insurers"; fetchedAt: string; key: string }): Promise<{ ok: true; contactId: string } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (input.kind !== "agencies" && input.kind !== "insurers") return { error: "Unknown search." };

  const { data } = await supabase
    .from("insurance_market_research")
    .select("items, fetched_at")
    .eq("association_id", association.id)
    .eq("kind", input.kind)
    .maybeSingle();
  const row = data as { items: FoundItem[]; fetched_at: string | null } | null;
  const changed = "The search results changed. Look at the new results and save again.";
  if (!row?.fetched_at || Date.parse(row.fetched_at) !== Date.parse(input.fetchedAt)) return { error: changed };
  const item = (Array.isArray(row.items) ? row.items : []).find((i) => i && i.key === input.key);
  if (!item) return { error: changed };

  const email = item.email && EMAIL_RE.test(item.email) ? item.email : null;
  const name = item.name.trim().slice(0, 200);
  const found = await existingContact(supabase, association.id, item.key, name, email);
  if (found) return { ok: true, contactId: found };

  const { data: inserted, error } = await supabase
    .from("insurance_contacts")
    .insert({
      association_id: association.id,
      kind: input.kind === "agencies" ? "agency" : "insurer",
      name,
      email,
      phone: item.phone ?? null,
      website_url: item.website && URL_RE.test(item.website) ? item.website : null,
      city: item.city ?? null,
      state_code: item.state && /^[A-Z]{2}$/.test(item.state) ? item.state : null,
      lines: (item.lines ?? []).filter((l) => CONTACT_LINES.has(l)),
      source: "web",
      source_urls: (item.sourceUrls ?? []).filter((u) => typeof u === "string" && URL_RE.test(u)),
      found_key: item.key,
      found_at: row.fetched_at,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    if (error?.code === "23505") {
      const again = await existingContact(supabase, association.id, item.key, name, email);
      if (again) return { ok: true, contactId: again };
    }
    return friendlyDbError(error ?? { message: "" }, "Walkup couldn't save this contact. Try again.");
  }
  revalidateInsurance();
  return { ok: true, contactId: (inserted as { id: string }).id };
}

export async function savePartnerAsContact(partnerId: string): Promise<{ ok: true; contactId: string } | { error: string }> {
  const ctx = await actionContext(BOARD_ONLY);
  if ("error" in ctx) return ctx;
  const { supabase, association } = ctx;
  if (!isUuid(partnerId)) return { error: "That broker was not found." };
  const { data } = await supabase
    .from("insurance_partners")
    .select("id, name, contact_email, phone, active")
    .eq("id", partnerId)
    .maybeSingle();
  const partner = data as { id: string; name: string; contact_email: string; phone: string | null; active: boolean } | null;
  if (!partner || !partner.active) return { error: "That broker was not found." };

  const { data: linked } = await supabase
    .from("insurance_contacts")
    .select("id")
    .eq("association_id", association.id)
    .eq("partner_id", partner.id)
    .is("archived_at", null)
    .limit(1);
  const already = ((linked ?? [])[0] as { id: string } | undefined)?.id;
  if (already) return { ok: true, contactId: already };

  const email = EMAIL_RE.test(partner.contact_email.trim()) ? partner.contact_email.trim() : null;
  const { data: inserted, error } = await supabase
    .from("insurance_contacts")
    .insert({
      association_id: association.id, kind: "broker", name: partner.name.trim(), email, phone: partner.phone,
      source: "partner", partner_id: partner.id,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    if (error?.code === "23505") {
      const again = await existingContact(supabase, association.id, null, partner.name.trim(), email);
      if (again) return { ok: true, contactId: again };
    }
    return friendlyDbError(error ?? { message: "" }, "Walkup couldn't save this broker. Try again.");
  }
  revalidateInsurance();
  return { ok: true, contactId: (inserted as { id: string }).id };
}
