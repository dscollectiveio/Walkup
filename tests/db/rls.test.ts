import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * The tests CLAUDE.md says to write before the policies exist and watch fail.
 *
 * "An owner must never be able to read another owner's balance" is the single
 * claim this product cannot be wrong about: it is neighbours in a four-unit
 * building, and the delinquent one did not consent to the others knowing.
 */
describe("row-level security", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const chargesVisibleTo = (user: string) =>
    asUser(db, user, async () => {
      const { rows } = await db.query<{ unit_id: string; amount: string }>(
        `select unit_id, amount from assessment_charges order by amount`,
      );
      return rows;
    });

  it("does not let an owner read another owner's balance", async () => {
    const visible = await chargesVisibleTo(f.adaUser);

    // Ada owns unit 1 and nothing else. Bo's $750 delinquency is not hers.
    expect(visible.map((r) => r.unit_id)).toEqual([f.unit1]);
    expect(visible.map((r) => r.amount)).not.toContain("750.00");
  });

  it("does not let an owner read another association at all", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{ id: string }>(`select id from associations`);
      expect(rows.map((r) => r.id)).toEqual([f.damen]);
    });

    await asUser(db, f.zaraUser, async () => {
      const { rows } = await db.query(`select id from assessment_charges`);
      expect(rows).toEqual([]);
    });
  });

  it("lets a board_admin who is also an owner see every unit", async () => {
    // Cy holds both roles. The permissive one must win — this is the case
    // the original single-role schema could not represent (DECISIONS #6).
    const visible = await chargesVisibleTo(f.cyUser);
    expect(visible.map((r) => r.unit_id).sort()).toEqual([f.unit1, f.unit2].sort());
  });

  it("lets an accountant with a live grant read the financials", async () => {
    // The mirror of the expired-grant test below. Without this pair, a suite
    // that denied EVERYTHING to EVERYONE would look exactly as green as one
    // that works.
    const visible = await chargesVisibleTo(f.niaUser);
    expect(visible.map((r) => r.amount)).toEqual(["500.00", "750.00"]);
  });

  it("does not let an owner write", async () => {
    await asUser(db, f.adaUser, async () => {
      // No INSERT policy exists on assessment_charges for anyone — charges are
      // written by SECURITY DEFINER functions only (DECISIONS #5).
      await expect(
        db.query(
          `insert into assessment_charges
             (association_id, unit_id, charge_type, period_start, due_on, amount)
           values ('${f.damen}', '${f.unit1}', 'assessment', '2026-02-01', '2026-02-01', 1.00)`,
        ),
      ).rejects.toThrow(/row-level security/i);

      // Updating a neighbour's charge does NOT raise. The row is invisible
      // under USING, so Postgres matches nothing and reports success with zero
      // rows affected. That is correct and secure, but it means application
      // code must check affectedRows — an "it didn't throw" check would read
      // this as having worked.
      const res = await db.query(
        `update assessment_charges set amount = 0 where id = '${f.boCharge}'`,
      );
      expect(res.affectedRows).toBe(0);
    });

    // And the row is genuinely untouched.
    const { rows } = await db.query<{ amount: string }>(
      `select amount from assessment_charges where id = '${f.boCharge}'`,
    );
    expect(rows[0].amount).toBe("750.00");
  });

  it("does not let an owner read the neighbours' contact details", async () => {
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{ full_name: string }>(`select full_name from persons`);
      expect(rows.map((r) => r.full_name)).toEqual(["Ada Okonkwo"]);
    });
  });

  it("does not let an accountant with an expired grant read anything", async () => {
    // Vic's grant ran 2024-01-01 to 2024-04-01. Grants expire by default and
    // an expired one must behave as no grant at all.
    const visible = await chargesVisibleTo(f.vicUser);
    expect(visible).toEqual([]);
  });

  it("does not let an unauthenticated session read anything", async () => {
    await asUser(db, null, async () => {
      const { rows } = await db.query(`select id from assessment_charges`);
      expect(rows).toEqual([]);
    });
  });

  it("does not let an owner reach the ledger directly", async () => {
    // An owner's statement is built from charges and payments. Raw journal
    // lines would expose every other unit's activity.
    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select id from journal_lines`);
      expect(rows).toEqual([]);
    });
  });

  it("does not let units be used as an access check for another unit", async () => {
    // Regression. The owner statement page originally gated on `select from
    // units`, which every member can read — so navigating directly to a
    // neighbour's unit URL rendered a real statement shell showing a confident
    // $0.00 balance. unit_owners is the correct gate.
    await asUser(db, f.adaUser, async () => {
      const visibleUnits = await db.query<{ id: string }>(`select id from units`);
      // units itself is intentionally readable — an owner knows the building
      // has three units, and hiding that achieves nothing.
      expect(visibleUnits.rows.length).toBeGreaterThan(1);

      const owned = await db.query<{ unit_id: string }>(
        `select unit_id from unit_owners`,
      );
      expect(owned.rows.map((r) => r.unit_id)).toEqual([f.unit1]);

      const neighbour = await db.query(
        `select 1 from unit_owners where unit_id = '${f.unit2}'`,
      );
      expect(neighbour.rows).toEqual([]);
    });
  });

  it("enables row-level security on every table in public", async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and rowsecurity = false
        order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });

  it("pins search_path on every SECURITY DEFINER function", async () => {
    // An unpinned search_path on a definer function is a privilege escalation
    // vector, and Supabase's own linter flags it. CLAUDE.md invariant 11.
    const { rows } = await db.query<{ proname: string }>(
      `select p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('public', 'auth')
          and (p.proconfig is null
               or not exists (
                 select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
        order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });
});
