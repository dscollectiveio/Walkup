import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";
import { boBoard, pgError, queries, seededDb } from "./repairs-helpers";

/**
 * Migration 0082 (DECISIONS #50): a person's phone and mailing address live in person_contact_details, which
 * the accountant, other owners and observers cannot read. The board and the person themselves can; a property
 * manager can read it; an attorney only through attorney_shared_owners().
 */

const MIGRATION = path.resolve(import.meta.dirname, "../../supabase/migrations/0082_person_contact_details.sql");

const PAT_USER = "dddd0000-0000-0000-0000-0000000000a1"; // property manager
const LEE_USER = "dddd0000-0000-0000-0000-0000000000a2"; // attorney
const OLA_USER = "dddd0000-0000-0000-0000-0000000000a3"; // observer
const PAT = "eeee0000-0000-0000-0000-0000000000a1";
const LEE = "eeee0000-0000-0000-0000-0000000000a2";
const OLA = "eeee0000-0000-0000-0000-0000000000a3";
const NEW_USER = "dddd0000-0000-0000-0000-0000000000b1"; // signed in, not a person in any building

let db: PGlite;
let f: Fixture;
const { q, one, rows, count } = queries(() => db);

beforeEach(async () => {
  ({ db, f } = await seededDb());
  await db.exec(`
    insert into auth.users (id, email) values
      ('${PAT_USER}', 'pat@example.test'), ('${LEE_USER}', 'lee@example.test'), ('${OLA_USER}', 'ola@example.test'), ('${NEW_USER}', 'new@example.test');
    insert into public.persons (id, association_id, full_name, email, auth_user_id) values
      ('${PAT}', '${f.damen}', 'Pat Manager', 'pat@example.test', '${PAT_USER}'),
      ('${LEE}', '${f.damen}', 'Lee Counsel', 'lee@example.test', '${LEE_USER}'),
      ('${OLA}', '${f.damen}', 'Ola Observer', 'ola@example.test', '${OLA_USER}');
    insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values
      ('${f.damen}', '${PAT}', 'property_manager', current_date, current_date + 90),
      ('${f.damen}', '${LEE}', 'attorney', current_date, current_date + 90),
      ('${f.damen}', '${OLA}', 'observer', current_date, current_date + 90);
    -- Details for Ada (owner), Bo (owner) and Zara (the other building).
    insert into public.person_contact_details (person_id, association_id, phone, mailing_address) values
      ('${f.adaPerson}', '${f.damen}', '312-555-0101', '1 Ada St'),
      ('${f.boPerson}', '${f.damen}', '312-555-0102', '2 Bo St'),
      ('${f.zaraPerson}', '${f.hoyne}', '312-555-0103', '3 Zara St');
  `);
  await boBoard(db, f); // Bo is also a board member
});
afterEach(async () => {
  await db.close();
});

const phones = async (user: string) => (await rows<{ phone: string | null }>(user, `select phone from public.person_contact_details order by phone`)).map((r) => r.phone);

describe("who can read it", () => {
  it("the board reads every person's details in its own building, and none in another", async () => {
    expect(await phones(f.cyUser)).toEqual(["312-555-0101", "312-555-0102"]); // board admin: Ada and Bo, not Zara
    expect(await phones(f.boUser)).toEqual(["312-555-0101", "312-555-0102"]); // board member
    expect(await phones(f.zaraUser)).toEqual(["312-555-0103"]); // Zara reads only her own
  });

  it("a person reads only their own", async () => {
    expect(await phones(f.adaUser)).toEqual(["312-555-0101"]);
    expect(await rows(NEW_USER, `select 1 from public.person_contact_details`)).toHaveLength(0);
  });

  it("a property manager reads everyone's in the building", async () => {
    expect(await phones(PAT_USER)).toEqual(["312-555-0101", "312-555-0102"]);
  });

  it("the accountant, an observer and an attorney read none of it directly, though all still read names and email", async () => {
    for (const [who, user] of [["accountant", f.niaUser], ["observer", OLA_USER], ["attorney", LEE_USER]] as const) {
      expect(await rows(user, `select 1 from public.person_contact_details`), who).toHaveLength(0);
    }
    // The accountant keeps what the books need: names and email stay on persons.
    const nia = await rows<{ email: string | null }>(f.niaUser, `select email from public.persons`);
    expect(nia.length).toBeGreaterThanOrEqual(6);
    expect(nia.map((r) => r.email)).toContain("ada@example.test");
  });

  it("an owner cannot read a neighbour's, and the expired accountant reads nothing", async () => {
    expect(await phones(f.adaUser)).not.toContain("312-555-0102");
    expect(await rows(f.vicUser, `select 1 from public.person_contact_details`)).toHaveLength(0);
  });

  it("phone and mailing_address are no longer columns on persons", async () => {
    const cols = await rows<{ column_name: string }>(null, `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'persons'`);
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("email");
    expect(names).not.toContain("phone");
    expect(names).not.toContain("mailing_address");
    expect((await pgError(q(f.niaUser, `select phone from public.persons`))).code).toBe("42703");
  });

  it("an attorney reads a shared unit's owner details through attorney_shared_owners only", async () => {
    await q(f.cyUser, `insert into public.attorney_shares (association_id, person_id, unit_id) values ($1::uuid, $2::uuid, $3::uuid)`, [f.damen, LEE, f.unit2]);
    const owners = await rows<{ unit_label: string; phone: string | null; mailing_address: string | null }>(LEE_USER, `select * from public.attorney_shared_owners($1::uuid)`, [f.damen]);
    expect(owners).toEqual([expect.objectContaining({ unit_label: "Unit 2", phone: "312-555-0102", mailing_address: "2 Bo St" })]);
    expect(await rows(LEE_USER, `select 1 from public.person_contact_details`)).toHaveLength(0);
    // Nobody else gets rows from it.
    for (const user of [f.niaUser, OLA_USER, PAT_USER, f.adaUser, f.cyUser]) {
      expect(await rows(user, `select 1 from public.attorney_shared_owners($1::uuid)`, [f.damen])).toHaveLength(0);
    }
  });
});

describe("who can write it", () => {
  it("the board adds, changes and removes details for anyone in its building", async () => {
    const add = await q(f.cyUser, `insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, '312-555-0199')`, [f.cyPerson, f.damen]);
    expect(add.affectedRows).toBe(1);
    expect((await q(f.boUser, `update public.person_contact_details set phone = '312-555-0200' where person_id = $1::uuid`, [f.adaPerson])).affectedRows).toBe(1);
    expect((await q(f.boUser, `delete from public.person_contact_details where person_id = $1::uuid`, [f.boPerson])).affectedRows).toBe(1);
    expect(await count(`select 1 from public.person_contact_details where person_id = '${f.boPerson}'`)).toBe(0);
  });

  it("nobody else can write the table directly, not even for themselves", async () => {
    expect((await pgError(q(f.adaUser, `insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, 'x')`, [f.cyPerson, f.damen]))).code).toBe("42501");
    for (const [who, user] of [["owner", f.adaUser], ["accountant", f.niaUser], ["property manager", PAT_USER], ["attorney", LEE_USER], ["observer", OLA_USER]] as const) {
      const upd = await q(user, `update public.person_contact_details set phone = 'changed' where person_id = $1::uuid`, [f.adaPerson]);
      expect(upd.affectedRows, `${who} update`).toBe(0);
      const del = await q(user, `delete from public.person_contact_details where person_id = $1::uuid`, [f.adaPerson]);
      expect(del.affectedRows, `${who} delete`).toBe(0);
    }
    expect((await pgError(q(f.niaUser, `insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, 'x')`, [f.cyPerson, f.damen]))).code).toBe("42501");
    expect(await phones(f.cyUser)).toEqual(["312-555-0101", "312-555-0102"]);
  });

  it("the association always comes from the person, so the board of one building cannot write another's", async () => {
    // Zara belongs to Hoyne: whatever association_id is typed, the row is Hoyne's, and Damen's board cannot write it.
    const e = await pgError(q(f.cyUser, `insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, 'x') on conflict (person_id) do update set phone = excluded.phone`, [f.zaraPerson, f.damen]));
    expect(e.code).toBe("42501");
    expect(await one(null, `select phone from public.person_contact_details where person_id = $1::uuid`, [f.zaraPerson])).toEqual({ phone: "312-555-0103" });
    // A typed-in wrong association on the board's own person is corrected, not trusted.
    expect((await q(f.cyUser, `insert into public.person_contact_details (person_id, association_id, phone) values ($1::uuid, $2::uuid, '312-555-0198')`, [f.cyPerson, f.hoyne])).affectedRows).toBe(1);
    expect(await one(null, `select association_id from public.person_contact_details where person_id = $1::uuid`, [f.cyPerson])).toEqual({ association_id: f.damen });
  });

  it("a row cannot be moved to another person, and a missing person is refused", async () => {
    expect((await pgError(q(f.cyUser, `update public.person_contact_details set person_id = $1::uuid where person_id = $2::uuid`, [f.cyPerson, f.adaPerson]))).code).toBe("42501");
    expect((await pgError(q(null, `insert into public.person_contact_details (person_id, association_id) values (gen_random_uuid(), $1::uuid)`, [f.damen]))).code).toBeDefined();
  });

  it("is audited under the person's id, readable by a board admin only", async () => {
    await q(f.cyUser, `update public.person_contact_details set phone = '312-555-0300' where person_id = $1::uuid`, [f.adaPerson]);
    const entries = await rows<{ action: string; record_id: string }>(f.cyUser, `select action, record_id from public.audit_log where table_name = 'person_contact_details' and action = 'update'`);
    expect(entries).toEqual([{ action: "update", record_id: f.adaPerson }]);
    expect(await rows(f.niaUser, `select 1 from public.audit_log where table_name = 'person_contact_details'`)).toHaveLength(0);
    expect(await rows(f.boUser, `select 1 from public.audit_log where table_name = 'person_contact_details'`)).toHaveLength(0);
  });

  it("goes with the person when they are deleted", async () => {
    await db.query(`delete from public.person_contact_details where person_id = $1::uuid`, [f.adaPerson]);
    await db.query(`insert into public.persons (id, association_id, full_name) values ('eeee0000-0000-0000-0000-0000000000c9', $1::uuid, 'Temp Person')`, [f.damen]);
    await db.query(`insert into public.person_contact_details (person_id, association_id, phone) values ('eeee0000-0000-0000-0000-0000000000c9', $1::uuid, '1')`, [f.damen]);
    await db.query(`delete from public.persons where id = 'eeee0000-0000-0000-0000-0000000000c9'`);
    expect(await count(`select 1 from public.person_contact_details where person_id = 'eeee0000-0000-0000-0000-0000000000c9'`)).toBe(0);
  });
});

describe("update_my_profile", () => {
  const profile = (user: string, phone: string | null, address: string | null) =>
    q(user, `select public.update_my_profile($1::uuid, $2, $3)`, [f.damen, phone, address]);

  it("saves the caller's own phone and address, trimmed, and only theirs", async () => {
    await profile(f.adaUser, "  312-555-0400 ", " 4 New St ");
    expect(await one(null, `select phone, mailing_address from public.person_contact_details where person_id = $1::uuid`, [f.adaPerson])).toEqual({ phone: "312-555-0400", mailing_address: "4 New St" });
    expect(await one(null, `select phone from public.person_contact_details where person_id = $1::uuid`, [f.boPerson])).toEqual({ phone: "312-555-0102" });
  });

  it("creates the row for someone who had none, and removes it when both are blank", async () => {
    expect(await count(`select 1 from public.person_contact_details where person_id = '${f.cyPerson}'`)).toBe(0);
    await profile(f.cyUser, "312-555-0500", null);
    expect(await one(null, `select phone, mailing_address from public.person_contact_details where person_id = $1::uuid`, [f.cyPerson])).toEqual({ phone: "312-555-0500", mailing_address: null });
    await profile(f.cyUser, "", "   ");
    expect(await count(`select 1 from public.person_contact_details where person_id = '${f.cyPerson}'`)).toBe(0);
  });

  it("keeps its validations: 40 characters for the phone, 300 for the address, and a person on file", async () => {
    expect((await pgError(profile(f.adaUser, "9".repeat(41), null))).code).toBe("22023");
    expect((await pgError(profile(f.adaUser, null, "x".repeat(301)))).code).toBe("22023");
    expect((await pgError(profile(NEW_USER, "1", "2"))).code).toBe("42501");
    expect((await pgError(q(f.zaraUser, `select public.update_my_profile($1::uuid, '1', '2')`, [f.damen]))).code).toBe("42501");
    expect(await one(null, `select phone from public.person_contact_details where person_id = $1::uuid`, [f.adaPerson])).toEqual({ phone: "312-555-0101" });
  });

  it("is not callable signed out", async () => {
    const r = await one<{ anon: boolean; auth: boolean }>(
      null,
      `select has_function_privilege('anon', 'public.update_my_profile(uuid, text, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.update_my_profile(uuid, text, text)', 'execute') as auth`,
    );
    expect(r).toEqual({ anon: false, auth: true });
  });
});

describe("removing a person's data", () => {
  const retire = async (person: string) => {
    await db.query(`update public.unit_owners set effective_to = '2025-01-01' where person_id = $1::uuid`, [person]);
    await db.query(`update public.role_grants set revoked_at = now() where person_id = $1::uuid`, [person]);
  };

  it("redact_person clears the details and every audit trace of them", async () => {
    await retire(f.adaPerson);
    await q(f.cyUser, `update public.person_contact_details set phone = '312-555-0601' where person_id = $1::uuid`, [f.adaPerson]);
    await q(f.cyUser, `select public.redact_person($1::uuid)`, [f.adaPerson]);
    expect(await count(`select 1 from public.person_contact_details where person_id = '${f.adaPerson}'`)).toBe(0);
    expect(await one(null, `select full_name, email, auth_user_id from public.persons where id = $1::uuid`, [f.adaPerson])).toEqual({ full_name: "Former member", email: null, auth_user_id: null });
    const leaks = await count(
      `select 1 from public.audit_log where coalesce(before_data::text, '') || coalesce(after_data::text, '') ~* '(312-555-0101|312-555-0601|1 Ada St|ada@example)'`,
    );
    expect(leaks).toBe(0);
    // Someone else's details are untouched.
    expect(await count(`select 1 from public.person_contact_details where person_id = '${f.boPerson}'`)).toBe(1);
  });

  it("delete_former_member refuses while details are on file, then deletes once they are gone", async () => {
    const former = "eeee0000-0000-0000-0000-0000000000d9";
    await db.query(`insert into public.persons (id, association_id, full_name) values ($1::uuid, $2::uuid, 'Former member')`, [former, f.damen]);
    await db.query(`insert into public.person_contact_details (person_id, association_id, mailing_address) values ($1::uuid, $2::uuid, '9 Old Rd')`, [former, f.damen]);
    expect((await pgError(q(f.cyUser, `select public.delete_former_member($1::uuid)`, [former]))).code).toBe("22023");
    await db.query(`update public.person_contact_details set mailing_address = null where person_id = $1::uuid`, [former]);
    // An empty row holds nothing, and goes with the person.
    await q(f.cyUser, `select public.delete_former_member($1::uuid)`, [former]);
    expect(await count(`select 1 from public.persons where id = '${former}'`)).toBe(0);
    expect(await count(`select 1 from public.person_contact_details where person_id = '${former}'`)).toBe(0);
  });
});

describe("the migration on existing data", () => {
  it("copies phone and mailing address across, skips people with neither, and drops the columns", async () => {
    await db.close();
    db = await freshDb({ before: "0082" });
    f = await seed(db);
    await db.query(`update public.persons set phone = '312-555-0701', mailing_address = '7 Seven St' where id = $1::uuid`, [f.adaPerson]);
    await db.query(`update public.persons set phone = '312-555-0702' where id = $1::uuid`, [f.boPerson]);
    await db.query(`update public.persons set mailing_address = '9 Nine St' where id = $1::uuid`, [f.zaraPerson]);
    await db.exec(await readFile(MIGRATION, "utf8"));
    const copied = await rows<{ person_id: string; association_id: string; phone: string | null; mailing_address: string | null }>(
      null,
      `select person_id, association_id, phone, mailing_address from public.person_contact_details order by phone nulls last`,
    );
    expect(copied).toEqual([
      { person_id: f.adaPerson, association_id: f.damen, phone: "312-555-0701", mailing_address: "7 Seven St" },
      { person_id: f.boPerson, association_id: f.damen, phone: "312-555-0702", mailing_address: null },
      { person_id: f.zaraPerson, association_id: f.hoyne, phone: null, mailing_address: "9 Nine St" },
    ]);
    const cols = (await rows<{ column_name: string }>(null, `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'persons'`)).map((c) => c.column_name);
    expect(cols).not.toContain("phone");
    expect(cols).not.toContain("mailing_address");
    // The copy itself is not logged as an edit.
    expect(await count(`select 1 from public.audit_log where table_name = 'person_contact_details'`)).toBe(0);
  });
});
