import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

// 0057: a grant or an ownership row may only point at people and units of its
// own association (docs/security/ATTACK-REPORT-1.md, findings 4 and 5).
describe("same-association guards on role_grants and unit_owners (0057)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  it("refuses a grant in one building for a person who belongs to another", async () => {
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.role_grants (association_id, person_id, role) values ($1::uuid, $2::uuid, 'board_member')`,
          [f.damen, f.zaraPerson],
        ),
      ),
    ).rejects.toThrow(/different association/);
  });

  it("still lets a board admin grant a role to someone in their own building", async () => {
    const granted = await asUser(db, f.cyUser, () =>
      db.query(
        `insert into public.role_grants (association_id, person_id, role) values ($1::uuid, $2::uuid, 'accountant')`,
        [f.damen, f.boPerson],
      ),
    );
    expect(granted.affectedRows).toBe(1);
  });

  it("refuses a grant that tries to move a person's grant to another building by update", async () => {
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `update public.role_grants set person_id = $1::uuid where person_id = $2::uuid and association_id = $3::uuid`,
          [f.zaraPerson, f.boPerson, f.damen],
        ),
      ),
    ).rejects.toThrow(/different association/);
  });

  it("refuses an ownership row pairing a unit from one building with a person or association from another", async () => {
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2026-01-01')`,
          [f.damen, f.hoyneUnit, f.adaPerson],
        ),
      ),
    ).rejects.toThrow(/different association/);
    await expect(
      asUser(db, f.cyUser, () =>
        db.query(
          `insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2026-01-01')`,
          [f.damen, f.unit1, f.zaraPerson],
        ),
      ),
    ).rejects.toThrow(/different association/);
  });

  it("still lets a board admin record an owner for a unit in their own building", async () => {
    const added = await asUser(db, f.cyUser, () =>
      db.query(
        `insert into public.unit_owners (association_id, unit_id, person_id, effective_from) values ($1::uuid, $2::uuid, $3::uuid, '2026-02-01')`,
        [f.damen, f.unit2, f.adaPerson],
      ),
    );
    expect(added.affectedRows).toBe(1);
  });
});
