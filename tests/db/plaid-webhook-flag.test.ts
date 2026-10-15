import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const CONN = "bc000000-0000-0000-0000-000000000001";

/** Migration 0058: the one thing the Plaid webhook may do to the database. */
describe("flag_bank_item_for_attention (0058)", () => {
  let db: PGlite;
  let f: Fixture;

  const status = async () =>
    (await db.query<{ s: string }>(`select status as s from public.bank_connections where id = $1`, [CONN])).rows[0].s;
  const asRole = async (role: string, sql: string, params: unknown[] = []) => {
    await db.exec(`set role ${role}`);
    try {
      return await db.query(sql, params);
    } finally {
      await db.exec(`reset role`);
    }
  };

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.query(
      `insert into public.bank_connections (id, association_id, institution_name, plaid_item_id, status, created_by)
       values ($1, $2, 'Test Bank', 'item-1', 'active', $3)`,
      [CONN, f.damen, f.cyUser],
    );
  });
  afterEach(async () => {
    await db.close();
  });

  it("flips an active connection to error for service_role, once", async () => {
    const first = await asRole("service_role", `select public.flag_bank_item_for_attention('item-1') as n`);
    expect((first.rows[0] as { n: number }).n).toBe(1);
    expect(await status()).toBe("error");
    const again = await asRole("service_role", `select public.flag_bank_item_for_attention('item-1') as n`);
    expect((again.rows[0] as { n: number }).n).toBe(0);
    expect(await status()).toBe("error");
  });

  it("does nothing for an unknown item id", async () => {
    const r = await asRole("service_role", `select public.flag_bank_item_for_attention('nope') as n`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
    expect(await status()).toBe("active");
  });

  it("never revives or touches a disconnected connection", async () => {
    await db.query(`update public.bank_connections set status = 'disconnected' where id = $1`, [CONN]);
    await asRole("service_role", `select public.flag_bank_item_for_attention('item-1')`);
    expect(await status()).toBe("disconnected");
  });

  it("is not callable by anon, authenticated or a board admin", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(asRole(role, `select public.flag_bank_item_for_attention('item-1')`)).rejects.toThrow(/permission denied/);
    }
    await expect(
      asUser(db, f.cyUser, () => db.query(`select public.flag_bank_item_for_attention('item-1')`)),
    ).rejects.toThrow(/permission denied/);
    expect(await status()).toBe("active");
  });

  it("is security definer with a pinned search_path and service_role the only grantee", async () => {
    const { rows } = await db.query<{ prosecdef: boolean; cfg: string[] | null; acl: string | null }>(
      `select prosecdef, proconfig as cfg, proacl::text as acl from pg_proc where proname = 'flag_bank_item_for_attention'`,
    );
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].cfg).toEqual(['search_path=""']);
    expect(rows[0].acl).toMatch(/service_role=X/);
    expect(rows[0].acl).not.toMatch(/(^|[{,])=X|anon=|authenticated=/);
  });
});
