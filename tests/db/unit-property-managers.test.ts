import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0066: a property manager per unit and a main contact. Walkup's own
 * email goes to the owner until a board member makes the manager the main
 * contact for that unit; the manager needs an email to receive it; and the
 * manager row is visible only to the board, the accountant and that unit's owner.
 */

const PAT_PERSON = "eeee0000-0000-0000-0000-0000000000b1";
const NOEMAIL_PERSON = "eeee0000-0000-0000-0000-0000000000b2";
const HOYNE_PERSON = "eeee0000-0000-0000-0000-0000000000b3";

type Err = { code?: string; message: string };

describe("property managers and the main contact (0066)", () => {
  let db: PGlite;
  let f: Fixture;
  const q = <T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) => db.query<T>(sql, params);
  const asCy = <T>(fn: () => Promise<T>) => asUser(db, f.cyUser, fn);
  const fail = async (p: Promise<unknown>): Promise<Err> => {
    try {
      await p;
    } catch (e) {
      return e as Err;
    }
    throw new Error("expected the call to fail");
  };
  const link = (unit: string, person: string, main = "owner", user: string = f.cyUser) =>
    asUser(db, user, () =>
      db.query(
        `insert into public.unit_property_managers (unit_id, association_id, person_id, company, main_contact)
         values ($1::uuid, $2::uuid, $3::uuid, 'Lakeview Management', $4)`,
        [unit, f.damen, person, main],
      ),
    );
  const setMain = (unit: string, main: string) =>
    asCy(() => db.query(`update public.unit_property_managers set main_contact = $2 where unit_id = $1::uuid`, [unit, main]));
  const prepare = async (units: string[]) => {
    const { rows } = await asCy(() =>
      db.query<{ id: string }>(`select public.email_prepare_batch($1::uuid, 'dues_reminder', $2::uuid[]) as id`, [f.damen, `{${units.join(",")}}`]),
    );
    return rows[0].id;
  };
  const outbox = async (batch: string) =>
    (
      await q<{ person_id: string; to_email: string; unit_ids: string[]; status: string }>(
        `select person_id, to_email, unit_ids, status from public.email_outbox where batch_id = $1::uuid order by to_email`,
        [batch],
      )
    ).rows;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      insert into public.persons (id, association_id, full_name, email) values
        ('${PAT_PERSON}', '${f.damen}', 'Pat Manager', 'pat@example.test'),
        ('${NOEMAIL_PERSON}', '${f.damen}', 'No Email Manager', null),
        ('${HOYNE_PERSON}', '${f.hoyne}', 'Hal Hoyne', 'hal@example.test');
      update public.associations set board_contact_email = 'board@example.test', board_contact_name = 'Cy Ferreira' where id = '${f.damen}';
    `);
    await asCy(() => db.query(`select public.email_set_sending($1::uuid, true)`, [f.damen]));
  });
  afterEach(async () => {
    await db.close();
  });

  describe("who can see and change it", () => {
    it("lets the board add one, and starts with the owner as the main contact", async () => {
      await link(f.unit1, PAT_PERSON);
      const { rows } = await q<{ main_contact: string; company: string }>(`select main_contact, company from public.unit_property_managers where unit_id = $1::uuid`, [f.unit1]);
      expect(rows[0]).toEqual({ main_contact: "owner", company: "Lakeview Management" });
    });

    it("refuses an owner who is not on the board", async () => {
      expect((await fail(link(f.unit1, PAT_PERSON, "owner", f.adaUser))).code).toBe("42501");
    });

    it("shows a unit's manager to its owner, the board and the accountant, and to nobody else", async () => {
      await link(f.unit1, PAT_PERSON);
      const count = (user: string) =>
        asUser(db, user, async () => (await db.query<{ n: number }>(`select count(*)::int as n from public.unit_property_managers`)).rows[0].n);
      expect(await count(f.adaUser)).toBe(1); // owns unit 1
      expect(await count(f.boUser)).toBe(0); // owns unit 2
      expect(await count(f.cyUser)).toBe(1); // board
      expect(await count(f.niaUser)).toBe(1); // accountant
      expect(await count(f.zaraUser)).toBe(0); // another building
    });

    it("refuses a person or unit from another association", async () => {
      expect((await fail(link(f.unit1, HOYNE_PERSON))).code).toBe("42501");
    });

    it("allows one manager per unit", async () => {
      await link(f.unit1, PAT_PERSON);
      expect((await fail(link(f.unit1, NOEMAIL_PERSON))).code).toBe("23505");
    });
  });

  describe("who Walkup's email goes to", () => {
    it("goes to the owner by default, even when a manager is on file", async () => {
      await link(f.unit1, PAT_PERSON);
      const rows = await outbox(await prepare([f.unit1]));
      expect(rows.map((r) => r.to_email)).toEqual(["ada@example.test"]);
    });

    it("goes to the manager, for that unit, once the manager is the main contact", async () => {
      await link(f.unit1, PAT_PERSON, "manager");
      const rows = await outbox(await prepare([f.unit1, f.unit2]));
      expect(rows).toEqual([
        { person_id: f.boPerson, to_email: "bo@example.test", unit_ids: [f.unit2], status: "draft" },
        { person_id: PAT_PERSON, to_email: "pat@example.test", unit_ids: [f.unit1], status: "draft" },
      ]);
    });

    it("falls back to the owner when the manager has no email", async () => {
      await link(f.unit1, NOEMAIL_PERSON, "manager");
      const rows = await outbox(await prepare([f.unit1]));
      expect(rows.map((r) => r.to_email)).toEqual(["ada@example.test"]);
    });

    it("goes back to the owner when the board switches it back", async () => {
      await link(f.unit1, PAT_PERSON, "manager");
      await setMain(f.unit1, "owner");
      expect((await outbox(await prepare([f.unit1]))).map((r) => r.to_email)).toEqual(["ada@example.test"]);
    });

    it("sends one email to a manager who handles several units", async () => {
      await link(f.unit1, PAT_PERSON, "manager");
      await link(f.unit2, PAT_PERSON, "manager");
      const rows = await outbox(await prepare([f.unit1, f.unit2]));
      expect(rows).toHaveLength(1);
      expect(rows[0].to_email).toBe("pat@example.test");
      expect([...rows[0].unit_ids].sort()).toEqual([f.unit1, f.unit2].sort());
    });

    it("applies to the standing reminder rules too", async () => {
      await link(f.unit1, PAT_PERSON, "manager");
      await asCy(() => db.query(`select public.email_save_rule($1::uuid, 'dues_overdue', 7, 1, 7, 3, true)`, [f.damen]));
      const run = await asService(db, () =>
        db.query<{ batch_id: string; queued: number }>(`select * from public.email_run_rules('2026-10-14'::date)`),
      );
      expect(run.rows[0].queued).toBe(2);
      expect((await outbox(run.rows[0].batch_id)).map((r) => r.to_email)).toEqual(["bo@example.test", "pat@example.test"]);
    });

    it("gives the manager the same protections: an unsubscribe choice stops the email", async () => {
      await link(f.unit1, PAT_PERSON, "manager");
      await q(`insert into public.email_preferences (association_id, person_id, unsubscribed_all) values ($1::uuid, $2::uuid, true)`, [f.damen, PAT_PERSON]);
      const rows = await q<{ status: string; skip_reason: string | null }>(
        `select status, skip_reason from public.email_outbox where batch_id = $1::uuid`,
        [await prepare([f.unit1])],
      );
      expect(rows.rows[0]).toEqual({ status: "skipped", skip_reason: "opted_out" });
    });
  });
});
