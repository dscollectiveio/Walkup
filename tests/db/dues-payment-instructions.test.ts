import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("dues payment instructions (0033)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("lets board_admin set the payment instructions; an owner-only caller cannot", async () => {
    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ dues_payee_name: string; dues_zelle_handle: string }>(
        `update associations
            set dues_payee_name = '2158 N Damen Ave HOA', dues_zelle_handle = 'treasurer@damen.test'
          where id = $1::uuid
          returning dues_payee_name, dues_zelle_handle`,
        [f.damen],
      );
      expect(rows[0]).toEqual({
        dues_payee_name: "2158 N Damen Ave HOA",
        dues_zelle_handle: "treasurer@damen.test",
      });
    });

    await asUser(db, f.adaUser, async () => {
      const { affectedRows } = await db.query(
        `update associations set dues_payee_name = 'Snuck in' where id = $1::uuid`,
        [f.damen],
      );
      expect(affectedRows).toBe(0); // RLS filtered the row, not an error
    });
  });

  it("lets an owner-only caller read the payment instructions once the board sets them", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `update associations set dues_payee_name = '2158 N Damen Ave HOA' where id = $1::uuid`,
        [f.damen],
      );
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query<{ dues_payee_name: string }>(
        `select dues_payee_name from associations where id = $1::uuid`,
        [f.damen],
      );
      expect(rows[0].dues_payee_name).toBe("2158 N Damen Ave HOA");
    });
  });
});
