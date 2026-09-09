import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

describe("bank feed", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("refuses to store a connection for a non-board caller", async () => {
    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(
          `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
          [f.damen],
        ),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("lets board_admin store a connection and read the token back", async () => {
    const connectionId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
        [f.damen],
      );
      return rows[0].store_bank_connection;
    });

    await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ get_bank_access_token: string }>(
        `select public.get_bank_access_token($1::uuid)`,
        [connectionId],
      );
      expect(rows[0].get_bank_access_token).toBe("access-token-secret");
    });
  });

  it("never exposes the token through a direct table read, even for board_admin", async () => {
    const connectionId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
        [f.damen],
      );
      return rows[0].store_bank_connection;
    });

    await asUser(db, f.cyUser, async () => {
      // RLS is enabled on bank_connection_secrets with zero policies, so this
      // is not an error -- it is zero rows, for every role, always.
      const { rows } = await db.query(
        `select * from public.bank_connection_secrets where bank_connection_id = $1::uuid`,
        [connectionId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("refuses to read the token for a non-board caller", async () => {
    const connectionId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
        [f.damen],
      );
      return rows[0].store_bank_connection;
    });

    await asUser(db, f.adaUser, async () => {
      await expect(
        db.query(`select public.get_bank_access_token($1::uuid)`, [connectionId]),
      ).rejects.toThrow(/not authorized/i);
    });
  });

  it("lets an owner-only caller see nothing on the bank feed", async () => {
    await asUser(db, f.cyUser, async () => {
      await db.query(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
        [f.damen],
      );
    });

    await asUser(db, f.adaUser, async () => {
      const { rows } = await db.query(`select * from public.bank_connections`);
      expect(rows).toHaveLength(0);
    });
  });

  it("revoke_bank_connection deletes the secret and marks the connection disconnected", async () => {
    const connectionId = await asUser(db, f.cyUser, async () => {
      const { rows } = await db.query<{ store_bank_connection: string }>(
        `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
        [f.damen],
      );
      return rows[0].store_bank_connection;
    });

    await asUser(db, f.cyUser, async () => {
      await db.query(`select public.revoke_bank_connection($1::uuid)`, [connectionId]);

      const { rows: status } = await db.query<{ status: string }>(
        `select status from public.bank_connections where id = $1::uuid`,
        [connectionId],
      );
      expect(status[0].status).toBe("disconnected");

      await expect(
        db.query(`select public.get_bank_access_token($1::uuid)`, [connectionId]),
      ).rejects.toThrow(); // the secret row is gone, so the select into finds nothing
    });
  });

  // --------------------------------------------------------------------------
  // Manual transaction tags (0031) — category override, unit dues match
  // --------------------------------------------------------------------------

  describe("transaction tags", () => {
    async function seedTransaction() {
      const connectionId = await asUser(db, f.cyUser, async () => {
        const { rows } = await db.query<{ store_bank_connection: string }>(
          `select public.store_bank_connection($1::uuid, 'BMO Harris', 'item-1', 'access-token-secret')`,
          [f.damen],
        );
        return rows[0].store_bank_connection;
      });

      const transactionId = await asUser(db, f.cyUser, async () => {
        const { rows } = await db.query<{ id: string }>(
          `insert into public.bank_transactions
             (association_id, bank_connection_id, plaid_transaction_id, posted_on, amount, description)
           values ($1::uuid, $2::uuid, 'plaid-tx-1', '2026-03-01'::date, 500.00, 'Assessment deposit')
           returning id`,
          [f.damen, connectionId],
        );
        return rows[0].id;
      });

      return transactionId;
    }

    it("lets board_admin set a category override and tag a unit's dues payment", async () => {
      const transactionId = await seedTransaction();

      await asUser(db, f.cyUser, async () => {
        const { rows } = await db.query<{
          category_override: string | null;
          matched_unit_id: string | null;
        }>(
          `update public.bank_transactions
              set category_override = 'Landscaping', matched_unit_id = $2::uuid
            where id = $1::uuid
            returning category_override, matched_unit_id`,
          [transactionId, f.unit1],
        );
        expect(rows[0]).toEqual({ category_override: "Landscaping", matched_unit_id: f.unit1 });
      });
    });

    it("refuses the update from an owner-only caller", async () => {
      const transactionId = await seedTransaction();

      await asUser(db, f.adaUser, async () => {
        const { affectedRows } = await db.query(
          `update public.bank_transactions set category_override = 'Snuck in' where id = $1::uuid`,
          [transactionId],
        );
        expect(affectedRows).toBe(0); // RLS filtered the row, not an error
      });
    });

    it("clears both fields back to null", async () => {
      const transactionId = await seedTransaction();

      await asUser(db, f.cyUser, async () => {
        await db.query(
          `update public.bank_transactions
              set category_override = 'Landscaping', matched_unit_id = $2::uuid
            where id = $1::uuid`,
          [transactionId, f.unit1],
        );
        const { rows } = await db.query<{
          category_override: string | null;
          matched_unit_id: string | null;
        }>(
          `update public.bank_transactions
              set category_override = null, matched_unit_id = null
            where id = $1::uuid
            returning category_override, matched_unit_id`,
          [transactionId],
        );
        expect(rows[0]).toEqual({ category_override: null, matched_unit_id: null });
      });
    });
  });
});
