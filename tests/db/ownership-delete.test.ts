import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Deleting an ownership change (a percentage amendment, or a unit's owner
 * record) is a board admin's action only. The Building & Owners page offers it; the
 * database is what enforces it.
 */
describe("deleting ownership changes", () => {
  let db: PGlite;
  let f: Fixture;
  const MEL_USER = "dddd0000-0000-0000-0000-0000000000c1";
  const MEL_PERSON = "eeee0000-0000-0000-0000-0000000000c1";

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      insert into auth.users (id, email) values ('${MEL_USER}', 'mel@example.test');
      insert into public.persons (id, association_id, full_name, email, auth_user_id)
        values ('${MEL_PERSON}', '${f.damen}', 'Mel Board', 'mel@example.test', '${MEL_USER}');
      insert into public.role_grants (association_id, person_id, role, granted_on)
        values ('${f.damen}', '${MEL_PERSON}', 'board_member', '2024-01-01');
    `);
  });
  afterEach(async () => {
    await db.close();
  });

  const amend = async (day: string) => {
    const lines = JSON.stringify([
      { unit_id: f.unit1, percentage: 34 },
      { unit_id: f.unit2, percentage: 33 },
      { unit_id: f.unit3, percentage: 33 },
    ]);
    const { rows } = await asUser(db, f.cyUser, () =>
      db.query<{ id: string }>(`select public.record_ownership_amendment($1::uuid, $2::date, $3::jsonb, 'test') as id`, [f.damen, day, lines]),
    );
    return rows[0].id;
  };
  const count = (table: string, where = "true") =>
    db.query<{ n: number }>(`select count(*)::int as n from public.${table} where ${where}`).then((r) => r.rows[0].n);

  it("lets a board admin delete an amendment, and its lines go with it", async () => {
    const id = await amend("2026-06-01");
    const { rows } = await asUser(db, f.cyUser, () => db.query(`delete from public.ownership_amendments where id = $1::uuid returning id`, [id]));
    expect(rows).toHaveLength(1);
    expect(await count("ownership_amendment_lines", `amendment_id = '${id}'`)).toBe(0);
  });

  it("refuses a board member, who deletes nothing", async () => {
    const id = await amend("2026-06-01");
    const { rows } = await asUser(db, MEL_USER, () => db.query(`delete from public.ownership_amendments where id = $1::uuid returning id`, [id]));
    expect(rows).toHaveLength(0);
    expect(await count("ownership_amendments", `id = '${id}'`)).toBe(1);
    expect(await count("ownership_amendment_lines", `amendment_id = '${id}'`)).toBe(3);
  });

  it("refuses an owner", async () => {
    const id = await amend("2026-06-01");
    const { rows } = await asUser(db, f.adaUser, () => db.query(`delete from public.ownership_amendments where id = $1::uuid returning id`, [id]));
    expect(rows).toHaveLength(0);
    expect(await count("ownership_amendments", `id = '${id}'`)).toBe(1);
  });

  it("shares go back to the earlier split when the newest amendment is deleted", async () => {
    await amend("2026-01-01");
    const newest = await amend("2026-06-01");
    await asUser(db, f.cyUser, () => db.query(`delete from public.ownership_amendments where id = $1::uuid`, [newest]));
    const { rows } = await db.query<{ effective_from: string }>(
      `select effective_from::text from public.ownership_amendments where association_id = $1::uuid order by effective_from desc limit 1`,
      [f.damen],
    );
    expect(rows[0].effective_from).toBe("2026-01-01");
  });

  it("lets only a board admin delete an owner record", async () => {
    const { rows: row } = await db.query<{ id: string }>(`select id from public.unit_owners where unit_id = $1::uuid limit 1`, [f.unit1]);
    const id = row[0].id;
    expect((await asUser(db, MEL_USER, () => db.query(`delete from public.unit_owners where id = $1::uuid returning id`, [id]))).rows).toHaveLength(0);
    expect(await count("unit_owners", `id = '${id}'`)).toBe(1);
    expect((await asUser(db, f.cyUser, () => db.query(`delete from public.unit_owners where id = $1::uuid returning id`, [id]))).rows).toHaveLength(1);
  });
});
