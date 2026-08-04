import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("building settings (0018)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  // --------------------------------------------------------------------------
  // Unit spec columns
  // --------------------------------------------------------------------------

  it("lets board_admin set unit specs; an owner cannot", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query(
        `update units set square_footage = 850, bedroom_count = 2, full_bathrooms = 1, half_bathrooms = 1
          where id = $1::uuid returning square_footage, bedroom_count, full_bathrooms, half_bathrooms`,
        [f.unit1],
      );
      expect(rows).toEqual([
        { square_footage: 850, bedroom_count: 2, full_bathrooms: 1, half_bathrooms: 1 },
      ]);
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(
        `update units set square_footage = 900 where id = $1::uuid returning id`,
        [f.unit1],
      );
      expect(rows).toHaveLength(0); // RLS filtered the row, not an error
    });
  });

  it("rejects negative/zero spec values by CHECK constraint", async () => {
    await asUser(db, f.cyUser, async () => {
      await expect(
        db.query(`update units set bedroom_count = -1 where id = $1::uuid`, [f.unit1]),
      ).rejects.toThrow();
      await expect(
        db.query(`update units set square_footage = 0 where id = $1::uuid`, [f.unit1]),
      ).rejects.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // record_ownership_amendment
  // --------------------------------------------------------------------------

  const fullLines = (pcts: [string, number][]) =>
    JSON.stringify(pcts.map(([unit_id, percentage]) => ({ unit_id, percentage })));

  it("records a valid amendment covering every unit at exactly 100%", async () => {
    await asUser(db, f.cyUser, async () => {
      const lines = fullLines([
        [f.unit1, 34],
        [f.unit2, 33],
        [f.unit3, 33],
      ]);
      const { rows } = await db.query<{ record_ownership_amendment: string }>(
        `select public.record_ownership_amendment($1::uuid, '2026-06-01'::date, $2::jsonb, 'test amendment')`,
        [f.damen, lines],
      );
      const amendmentId = rows[0].record_ownership_amendment;
      expect(amendmentId).toBeTruthy();

      const { rows: header } = await db.query<{ created_by: string; reason: string }>(
        `select created_by::text, reason from public.ownership_amendments where id = $1::uuid`,
        [amendmentId],
      );
      expect(header[0]).toEqual({ created_by: f.cyUser, reason: "test amendment" });

      const { rows: lineRows } = await db.query<{ n: number }>(
        `select count(*)::int n from public.ownership_amendment_lines where amendment_id = $1::uuid`,
        [amendmentId],
      );
      expect(lineRows[0].n).toBe(3);
    });
  });

  it("rejects an amendment whose lines don't sum to 100, even through the RPC", async () => {
    await asUser(db, f.cyUser, async () => {
      const lines = fullLines([
        [f.unit1, 34],
        [f.unit2, 33],
        [f.unit3, 30], // sums to 97
      ]);
      await expect(
        db.query(
          `select public.record_ownership_amendment($1::uuid, '2026-06-02'::date, $2::jsonb)`,
          [f.damen, lines],
        ),
      ).rejects.toThrow(/not 100/i);
    });
  });

  it("rejects a line count that doesn't match the association's unit count", async () => {
    await asUser(db, f.cyUser, async () => {
      const lines = fullLines([
        [f.unit1, 50],
        [f.unit2, 50],
        // unit3 omitted — 2 lines for 3 units, even though they sum to 100
      ]);
      await expect(
        db.query(
          `select public.record_ownership_amendment($1::uuid, '2026-06-03'::date, $2::jsonb)`,
          [f.damen, lines],
        ),
      ).rejects.toThrow(/must cover every unit/i);
    });
  });

  it("rejects a non-board caller and a cross-tenant caller", async () => {
    const lines = fullLines([
      [f.unit1, 34],
      [f.unit2, 33],
      [f.unit3, 33],
    ]);

    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.record_ownership_amendment($1::uuid, '2026-06-04'::date, $2::jsonb)`,
          [f.damen, lines],
        ),
      ).rejects.toThrow(/not authorized/i);
    });

    await asUser(db, f.zaraUser, async () => {
      await expect(
        db.query(
          `select public.record_ownership_amendment($1::uuid, '2026-06-04'::date, $2::jsonb)`,
          [f.damen, lines],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("rejects an empty lines array", async () => {
    await asUser(db, f.cyUser, async () => {
      await expect(
        db.query(
          `select public.record_ownership_amendment($1::uuid, '2026-06-05'::date, '[]'::jsonb)`,
          [f.damen],
        ),
      ).rejects.toThrow(/at least one/i);
    });
  });

  it("documents the residual gap: a direct zero-line header insert is not caught by anything", async () => {
    await asUser(db, f.cyUser, async () => {
      // This is deliberately NOT going through the RPC, proving the app-level
      // discipline requirement the migration's header comment calls out.
      await expect(
        db.query(
          `insert into public.ownership_amendments (association_id, effective_from, reason)
           values ($1::uuid, '2026-06-06'::date, 'bypassed the RPC')`,
          [f.damen],
        ),
      ).resolves.toBeTruthy();
    });
  });

  // --------------------------------------------------------------------------
  // Role grant re-grant after revoke
  // --------------------------------------------------------------------------

  it("round-trips a revoked role back to active via upsert, without duplicating the row", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `update role_grants set revoked_at = now()
          where association_id = $1::uuid and person_id = $2::uuid and role = 'accountant'`,
        [f.damen, f.niaPerson],
      );

      await db.query(
        `insert into role_grants
           (association_id, person_id, role, granted_on, granted_by, expires_on, revoked_at, revoked_by)
         values ($1::uuid, $2::uuid, 'accountant', current_date, $3::uuid, null, null, null)
         on conflict (association_id, person_id, role)
         do update set
           granted_on = excluded.granted_on,
           granted_by = excluded.granted_by,
           expires_on = excluded.expires_on,
           revoked_at = excluded.revoked_at,
           revoked_by = excluded.revoked_by`,
        [f.damen, f.niaPerson, f.cyUser],
      );

      const { rows } = await db.query<{ n: number; revoked_at: string | null }>(
        `select count(*)::int n, max(revoked_at)::text as revoked_at from role_grants
          where association_id = $1::uuid and person_id = $2::uuid and role = 'accountant'`,
        [f.damen, f.niaPerson],
      );
      expect(rows[0]).toEqual({ n: 1, revoked_at: null });
    });
  });

  it("lets board_admin grant a role never held before (fresh insert path)", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into role_grants (association_id, person_id, role, granted_on, granted_by)
         values ($1::uuid, $2::uuid, 'board_member', current_date, $3::uuid)
         on conflict (association_id, person_id, role) do update set revoked_at = null`,
        [f.damen, f.boPerson, f.cyUser],
      );
      const { rows } = await db.query<{ role: string }>(
        `select role from role_grants where association_id = $1::uuid and person_id = $2::uuid`,
        [f.damen, f.boPerson],
      );
      expect(rows.map((r) => r.role).sort()).toEqual(["board_member", "owner"]);
    });
  });

  it("refuses a role grant from an owner-only caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `insert into role_grants (association_id, person_id, role, granted_on, granted_by)
           values ($1::uuid, $2::uuid, 'board_member', current_date, $3::uuid)`,
          [f.damen, f.boPerson, f.adaUser],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("refuses a role grant from a board_member (board_admin only, unlike most board writes)", async () => {
    // Scoped, test-local grant — Bo becomes board_member for this test only,
    // rather than editing the shared fixture set every other suite relies on.
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into role_grants (association_id, person_id, role, granted_on, granted_by)
         values ($1::uuid, $2::uuid, 'board_member', current_date, $3::uuid)`,
        [f.damen, f.boPerson, f.cyUser],
      );
    });

    await asUser(db, f.boUser, async () => {
      await expect(
        db.query(
          `insert into role_grants (association_id, person_id, role, granted_on, granted_by)
           values ($1::uuid, $2::uuid, 'accountant', current_date, $3::uuid)`,
          [f.damen, f.adaPerson, f.boUser],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // --------------------------------------------------------------------------
  // Replacing a unit's owner
  // --------------------------------------------------------------------------

  it("insert-then-close leaves one open row and one closed row for the unit", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows: existing } = await db.query<{ id: string }>(
        `select id from unit_owners where unit_id = $1::uuid and effective_to is null`,
        [f.unit1],
      );
      expect(existing).toHaveLength(1);

      await db.query(
        `insert into unit_owners (association_id, unit_id, person_id, effective_from)
         values ($1::uuid, $2::uuid, $3::uuid, '2026-07-01'::date)`,
        [f.damen, f.unit1, f.boPerson],
      );
      await db.query(
        `update unit_owners set effective_to = '2026-06-30'::date where id = $1::uuid`,
        [existing[0].id],
      );

      const { rows: after } = await db.query<{ effective_to: string | null }>(
        `select effective_to::text from unit_owners where unit_id = $1::uuid order by effective_from`,
        [f.unit1],
      );
      expect(after).toEqual([{ effective_to: "2026-06-30" }, { effective_to: null }]);
    });
  });

  it("insert-without-close leaves a deliberate overlap rather than a gap", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `insert into unit_owners (association_id, unit_id, person_id, effective_from)
         values ($1::uuid, $2::uuid, $3::uuid, '2026-07-01'::date)`,
        [f.damen, f.unit1, f.boPerson],
      );
      const { rows } = await db.query<{ n: number }>(
        `select count(*)::int n from unit_owners where unit_id = $1::uuid and effective_to is null`,
        [f.unit1],
      );
      expect(rows[0].n).toBe(2); // both Ada's original row and Bo's new row are open
    });
  });

  it("refuses a unit_owners write from an owner-only caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `insert into unit_owners (association_id, unit_id, person_id, effective_from)
           values ($1::uuid, $2::uuid, $3::uuid, '2026-07-01'::date)`,
          [f.damen, f.unit1, f.boPerson],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it("still enforces effective_to > effective_from on close-out", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows: existing } = await db.query<{ id: string }>(
        `select id from unit_owners where unit_id = $1::uuid and effective_to is null`,
        [f.unit1],
      );
      await expect(
        db.query(
          `update unit_owners set effective_to = effective_from where id = $1::uuid`,
          [existing[0].id],
        ),
      ).rejects.toThrow();
    });
  });
});
