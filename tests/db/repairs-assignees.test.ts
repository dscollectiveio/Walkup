import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/** Migration 0090: the assignee picker's names, for the board and a property manager only. */

const PAT_USER = "dddd0000-0000-0000-0000-0000000000a1";
const PAT = "eeee0000-0000-0000-0000-0000000000a1";

describe("repairs assignees (0090)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      insert into auth.users (id, email) values ('${PAT_USER}', 'pat@example.test');
      insert into public.persons (id, association_id, full_name, email, auth_user_id) values ('${PAT}', '${f.damen}', 'Pat Manager', 'pat@example.test', '${PAT_USER}');
      insert into public.role_grants (association_id, person_id, role, granted_on, expires_on) values ('${f.damen}', '${PAT}', 'property_manager', '2024-01-01', current_date + 30);
    `);
  });
  afterEach(async () => {
    await db.close();
  });

  const names = (user: string) =>
    asUser(db, user, async () => (await db.query<{ full_name: string }>(`select full_name from public.repairs_assignees($1)`, [f.damen])).rows.map((r) => r.full_name));

  it("gives the board and a property manager the board's names, and no one else anything", async () => {
    const board = await names(f.cyUser);
    expect(board).toContain("Cy Ferreira");
    expect(await names(PAT_USER)).toEqual(board);
    expect(await names(f.adaUser)).toEqual([]); // owner
    expect(await names(f.niaUser)).toEqual([]); // accountant
    expect(await names(f.zaraUser)).toEqual([]); // owner of another building
  });

  it("does not list a property manager or an owner as someone to assign to", async () => {
    expect(await names(f.cyUser)).not.toContain("Pat Manager");
    expect(await names(f.cyUser)).not.toContain("Ada Okonkwo");
  });
});
