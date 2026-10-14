import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CONN = "bc000000-0000-0000-0000-000000000001";
const SEALED = "enc:v1:aaaa:bbbb:cccc";

/** Migration 0050: swapping a plain Plaid token for its sealed form, and nothing else. */
describe("reseal_bank_access_token (0050)", () => {
  let db: PGlite;
  let f: Fixture;

  const stored = async () =>
    (await db.query<{ t: string }>(`select plaid_access_token as t from public.bank_connection_secrets where bank_connection_id = $1`, [CONN])).rows[0].t;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(
      `insert into public.bank_connections (id, association_id, institution_name, plaid_item_id, status, created_by)
       values ($1, $2, 'Test Bank', 'item-1', 'active', $3)`,
      [CONN, f.damen, f.cyUser],
    );
    await db.query(
      `insert into public.bank_connection_secrets (bank_connection_id, association_id, plaid_access_token)
       values ($1, $2, 'access-sandbox-plain')`,
      [CONN, f.damen],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("lets a board admin seal a plain token", async () => {
    await asUser(db, f.cyUser, () => db.query(`select public.reseal_bank_access_token($1, $2)`, [CONN, SEALED]));
    expect(await stored()).toBe(SEALED);
  });

  it("won't store a value that isn't sealed", async () => {
    await expect(
      asUser(db, f.cyUser, () => db.query(`select public.reseal_bank_access_token($1, 'junk')`, [CONN])),
    ).rejects.toThrow(/only a sealed value/);
    expect(await stored()).toBe("access-sandbox-plain");
  });

  it("never overwrites a token that is already sealed", async () => {
    await asUser(db, f.cyUser, () => db.query(`select public.reseal_bank_access_token($1, $2)`, [CONN, SEALED]));
    await asUser(db, f.cyUser, () => db.query(`select public.reseal_bank_access_token($1, 'enc:v1:x:y:z')`, [CONN]));
    expect(await stored()).toBe(SEALED);
  });

  it("refuses anyone who isn't a board admin of that building", async () => {
    await expect(
      asUser(db, f.adaUser, () => db.query(`select public.reseal_bank_access_token($1, $2)`, [CONN, SEALED])),
    ).rejects.toThrow(/not authorized/);
    expect(await stored()).toBe("access-sandbox-plain");
  });

  it("is not callable signed out", async () => {
    await db.exec(`set role anon;`);
    try {
      await expect(db.query(`select public.reseal_bank_access_token($1, $2)`, [CONN, SEALED])).rejects.toThrow();
    } finally {
      await db.exec(`reset role;`);
    }
  });
});
