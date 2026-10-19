import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/** Migration 0067: a board admin deletes a former member, only when nothing still refers to them. */
const MEL_USER = "dddd0000-0000-0000-0000-0000000000d1";
const MEL_PERSON = "eeee0000-0000-0000-0000-0000000000d1";
const GONE = "eeee0000-0000-0000-0000-0000000000d2"; // a redacted person nothing refers to
const OWNED = "eeee0000-0000-0000-0000-0000000000d3"; // a redacted person with an owner record
const LIVE = "eeee0000-0000-0000-0000-0000000000d4"; // not redacted

type Err = { code?: string; message: string };

describe("delete_former_member (0067)", () => {
  let db: PGlite;
  let f: Fixture;
  const fail = async (p: Promise<unknown>): Promise<Err> => {
    try {
      await p;
    } catch (e) {
      return e as Err;
    }
    throw new Error("expected the call to fail");
  };
  const del = (user: string, person: string) => asUser(db, user, () => db.query(`select public.delete_former_member($1::uuid)`, [person]));
  const exists = async (id: string) => (await db.query(`select 1 from public.persons where id = $1::uuid`, [id])).rows.length === 1;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      insert into auth.users (id, email) values ('${MEL_USER}', 'mel@example.test');
      insert into public.persons (id, association_id, full_name, email, auth_user_id) values
        ('${MEL_PERSON}', '${f.damen}', 'Mel Board', 'mel@example.test', '${MEL_USER}');
      insert into public.persons (id, association_id, full_name) values
        ('${GONE}', '${f.damen}', 'Former member'),
        ('${OWNED}', '${f.damen}', 'Former member');
      insert into public.persons (id, association_id, full_name, email) values
        ('${LIVE}', '${f.damen}', 'Liv Live', 'liv@example.test');
      insert into public.role_grants (association_id, person_id, role, granted_on) values
        ('${f.damen}', '${MEL_PERSON}', 'board_member', '2024-01-01');
      insert into public.role_grants (association_id, person_id, role, granted_on, revoked_at) values
        ('${f.damen}', '${GONE}', 'owner', '2020-01-01', now());
      insert into public.unit_owners (association_id, unit_id, person_id, effective_from, effective_to) values
        ('${f.damen}', '${f.unit1}', '${OWNED}', '2010-01-01', '2012-01-01');
    `);
  });
  afterEach(async () => {
    await db.close();
  });

  it("lets a board admin delete a former member nothing refers to, with their ended access", async () => {
    await del(f.cyUser, GONE);
    expect(await exists(GONE)).toBe(false);
    expect((await db.query(`select 1 from public.role_grants where person_id = $1::uuid`, [GONE])).rows).toHaveLength(0);
  });

  it("refuses a board member", async () => {
    expect((await fail(del(MEL_USER, GONE))).code).toBe("42501");
    expect(await exists(GONE)).toBe(true);
  });

  it("refuses an owner", async () => {
    expect((await fail(del(f.adaUser, GONE))).code).toBe("42501");
  });

  it("refuses anyone whose details have not been removed", async () => {
    const e = await fail(del(f.cyUser, LIVE));
    expect(e.code).toBe("22023");
    expect(e.message).toMatch(/remove this person's personal data first/);
    expect(await exists(LIVE)).toBe(true);
  });

  it("refuses, and keeps the row, when an ownership record still refers to them", async () => {
    const e = await fail(del(f.cyUser, OWNED));
    expect(e.code).toBe("22023");
    expect(e.message).toMatch(/still used in: 1 ownership record \(Building & Owners, Owner records\)/);
    expect(await exists(OWNED)).toBe(true);
  });

  it("works once the mistaken owner record is deleted", async () => {
    await asUser(db, f.cyUser, () => db.query(`delete from public.unit_owners where person_id = $1::uuid`, [OWNED]));
    await del(f.cyUser, OWNED);
    expect(await exists(OWNED)).toBe(false);
  });
});
