import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0025: role- and unit-scoped access requires AAL2 (MFA already
 * completed this session), not just a valid password login. A stolen or
 * password-only session must not be able to reach financial data by calling
 * PostgREST directly, even if the application's own redirect logic (proxy.ts)
 * would have sent that same request to an MFA prompt.
 */
describe("MFA (AAL2) enforcement", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("blocks a board_admin's financial reads at aal1", async () => {
    // Cy is board_admin + owner. At full assurance she sees both her units.
    const atAal2 = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query(`select unit_id from assessment_charges`);
      return rows;
    });
    expect(atAal2.length).toBeGreaterThan(0);

    // Same person, same password-verified session, but no MFA challenge
    // completed yet — sees nothing.
    const atAal1 = await asUser(
      db,
      f.cyUser,
      async () => {
        const { rows } = await db.query(`select unit_id from assessment_charges`);
        return rows;
      },
      { aal: "aal1" },
    );
    expect(atAal1).toEqual([]);
  });

  it("blocks an owner from reading their own unit's charges at aal1", async () => {
    // owned_unit_ids() is the path owners (not board/accountant) read
    // through — has to be gated independently of has_role_in().
    const atAal1 = await asUser(
      db,
      f.adaUser,
      async () => {
        const { rows } = await db.query(`select unit_id from assessment_charges`);
        return rows;
      },
      { aal: "aal1" },
    );
    expect(atAal1).toEqual([]);
  });

  it("blocks post_journal_entry() at aal1, even for a board_admin", async () => {
    await asUser(
      db,
      f.cyUser,
      async () => {
        await expect(
          db.query(
            `select post_journal_entry(
               '${f.damen}', 'f1500000-0000-0000-0000-000000000001', '2026-03-01',
               'Should be blocked', 'manual',
               '[{"account_id":"acc00000-0000-0000-0000-000000001000","debit":1,"credit":0},
                 {"account_id":"acc00000-0000-0000-0000-000000004000","debit":0,"credit":1}]'::jsonb
             )`,
          ),
        ).rejects.toThrow(/not authorized/i);
      },
      { aal: "aal1" },
    );
  });

  it("still allows normal access once aal2 is satisfied", async () => {
    // Not a new assertion so much as a guard against the gate being
    // accidentally inverted (e.g. `not session_is_aal2()`).
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query(`select unit_id from assessment_charges`);
      expect(rows.length).toBeGreaterThan(0);
    });
  });
});
