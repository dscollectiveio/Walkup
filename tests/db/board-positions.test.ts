import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/** Migration 0076: officer positions, the Treasurer and Secretary duties, and the change of board. */

describe("board positions (0076)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    // Bo joins the board as a member.
    await db.query(
      `insert into public.role_grants (association_id, person_id, role, granted_on) values ($1::uuid, $2::uuid, 'board_member', '2024-01-01')`,
      [f.damen, f.boPerson],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  const change = (user: string, position: string, person: string, endOld = false) =>
    asUser(db, user, () =>
      db.query(`select public.change_board_position($1::uuid, $2, $3::uuid, null, $4)`, [f.damen, position, person, endOld]),
    );
  const hasDuty = async (user: string, duty: string) =>
    (await asUser(db, user, () => db.query<{ d: boolean }>(`select public.has_duty($1::uuid, $2) as d`, [f.damen, duty]))).rows[0].d;

  it("only a board admin changes the board", async () => {
    await expect(change(f.boUser, "treasurer", f.boPerson)).rejects.toThrow(/only a board admin/i);
    await expect(change(f.cyUser, "treasurer", f.boPerson)).resolves.toBeDefined();
  });

  it("the Treasurer has the books duty, an ordinary board member does not, and an admin always does", async () => {
    expect(await hasDuty(f.boUser, "books")).toBe(false);
    await change(f.cyUser, "treasurer", f.boPerson);
    expect(await hasDuty(f.boUser, "books")).toBe(true);
    expect(await hasDuty(f.boUser, "records")).toBe(false);
    expect(await hasDuty(f.cyUser, "books")).toBe(true);
    expect(await hasDuty(f.adaUser, "books")).toBe(false);
  });

  it("the Treasurer can create a budget category; a plain board member cannot", async () => {
    await expect(asUser(db, f.boUser, () => db.query(`select public.create_expense_account($1::uuid, 'Snow removal')`, [f.damen]))).rejects.toThrow(/not authorized/i);
    await change(f.cyUser, "treasurer", f.boPerson);
    await expect(asUser(db, f.boUser, () => db.query(`select public.create_expense_account($1::uuid, 'Snow removal')`, [f.damen]))).resolves.toBeDefined();
  });

  it("a new holder replaces the old one, and the old one can lose board access with it", async () => {
    await change(f.cyUser, "secretary", f.boPerson);
    await change(f.cyUser, "secretary", f.cyPerson, true);
    const { rows } = await db.query<{ person_id: string; ended: boolean }>(
      `select person_id, ended_at is not null as ended from public.board_positions where position = 'secretary' order by created_at`,
    );
    expect(rows).toEqual([
      { person_id: f.boPerson, ended: true },
      { person_id: f.cyPerson, ended: false },
    ]);
    const g = await db.query(`select 1 from public.role_grants where person_id = $1::uuid and role = 'board_member' and revoked_at is null`, [f.boPerson]);
    expect(g.rows).toHaveLength(0);
  });

  it("giving a position to someone off the board makes them a board member", async () => {
    await change(f.cyUser, "director", f.vicPerson);
    const g = await db.query(`select 1 from public.role_grants where person_id = $1::uuid and role = 'board_member' and revoked_at is null`, [f.vicPerson]);
    expect(g.rows).toHaveLength(1);
  });

  it("owners read officer titles through the board roster", async () => {
    await change(f.cyUser, "president", f.cyPerson);
    const r = await asUser(db, f.adaUser, () => db.query<{ full_name: string; title: string | null }>(`select full_name, title from public.board_roster($1::uuid)`, [f.damen]));
    expect(r.rows.find((x) => x.full_name === "Cy Ferreira")?.title).toBe("President");
  });

  it("an owner cannot read the positions table", async () => {
    await change(f.cyUser, "president", f.cyPerson);
    const r = await asUser(db, f.adaUser, () => db.query(`select * from public.board_positions`));
    expect(r.rows).toHaveLength(0);
  });
});
