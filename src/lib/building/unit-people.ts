/**
 * Reads the "people in this unit" part of the Building & Owners forms.
 *
 * One form can hold several people, so each person's fields are named
 * `p.<key>.<field>` (the key is anything without a dot). Three kinds:
 *   - a resident already in the unit (`p.<key>.owner_row_id` is set): edited, or removed from the unit;
 *   - someone new (`p.<key>.mode` = "new"): created, optionally with roles, optionally recorded as an owner;
 *   - someone already on file (`p.<key>.mode` = "link"): linked to the unit as an owner.
 * Pure, so it can be tested without a database. Money-free; only names, contact details and dates.
 */

import { APP_ROLES } from "@/lib/access/outside-roles";

export const HOA_ROLES = APP_ROLES;

export interface PersonFieldsInput {
  full_name: string;
  email: string | null;
  phone: string | null;
  mailing_address: string | null;
}

export type PersonEntry =
  | {
      kind: "resident";
      key: string;
      personId: string;
      ownerRowId: string;
      remove: boolean;
      /** The date they stopped being in the unit, when removed (defaults to today). */
      endDate: string;
      fields: PersonFieldsInput;
      rolesSubmitted: boolean;
      roles: string[];
    }
  | {
      kind: "new";
      key: string;
      fields: PersonFieldsInput;
      rolesSubmitted: boolean;
      roles: string[];
      owns: boolean;
      since: string;
    }
  | { kind: "link"; key: string; personId: string; owns: boolean; since: string };

export type ParsedPeople = { ok: true; entries: PersonEntry[] } | { ok: false; error: string };

const KEY = /^p\.([^.]+)\.([a-z_]+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePeople(formData: FormData, today: string): ParsedPeople {
  const keys: string[] = [];
  const get = (k: string, f: string) => String(formData.get(`p.${k}.${f}`) ?? "").trim();
  const getAll = (k: string, f: string) => formData.getAll(`p.${k}.${f}`).map((v) => String(v));

  for (const name of formData.keys()) {
    const m = KEY.exec(name);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }

  const entries: PersonEntry[] = [];
  for (const key of keys) {
    const ownerRowId = get(key, "owner_row_id");
    const roles = getAll(key, "roles");
    for (const r of roles) if (!(HOA_ROLES as readonly string[]).includes(r)) return { ok: false, error: "Unrecognized role." };
    const rolesSubmitted = get(key, "roles_submitted") === "1";
    const fields: PersonFieldsInput = {
      full_name: get(key, "full_name"),
      email: get(key, "email") || null,
      phone: get(key, "phone") || null,
      mailing_address: get(key, "mailing_address") || null,
    };
    const owns = get(key, "owns_unit") === "on";
    const since = get(key, "effective_from") || today;

    if (ownerRowId) {
      const remove = get(key, "remove") === "1";
      const personId = get(key, "person_id");
      if (!personId) return { ok: false, error: "Missing person." };
      if (!remove && !fields.full_name) return { ok: false, error: "Every person needs a name." };
      const endDate = get(key, "end_date") || today;
      if (remove && !DATE.test(endDate)) return { ok: false, error: "Enter the date they left the unit." };
      entries.push({ kind: "resident", key, personId, ownerRowId, remove, endDate, fields, rolesSubmitted, roles });
      continue;
    }

    const mode = get(key, "mode");
    if (mode === "link") {
      const personId = get(key, "existing_person_id");
      if (!personId) return { ok: false, error: "Choose who to add, or remove that entry." };
      if (owns && !DATE.test(since)) return { ok: false, error: "Enter the date they became the owner." };
      entries.push({ kind: "link", key, personId, owns, since });
      continue;
    }
    if (mode === "new") {
      if (!fields.full_name) return { ok: false, error: "Give each new person a name, or remove that entry." };
      if (owns && !DATE.test(since)) return { ok: false, error: "Enter the date they became the owner." };
      entries.push({ kind: "new", key, fields, rolesSubmitted, roles, owns, since });
      continue;
    }
    return { ok: false, error: "Choose who is in this unit." };
  }

  // The same person twice in one save would create two ownership rows for one person.
  const linked = entries.flatMap((e) => (e.kind === "link" || e.kind === "resident" ? [e.personId] : []));
  if (new Set(linked).size !== linked.length) return { ok: false, error: "The same person is listed twice." };
  return { ok: true, entries };
}
