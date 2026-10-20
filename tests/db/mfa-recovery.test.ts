import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

/**
 * Migration 0078: MFA recovery codes. The database holds only hashes, hands a
 * person nothing but their own counts, spends each code once, locks after five
 * wrong tries, and removes the caller's authenticator factors on a good code.
 *
 * PGlite has no Auth service, so auth.mfa_factors is a stand-in table made
 * here (the function deletes from it). The scrypt hashing lives in the app and
 * is covered by tests/unit/recovery-codes.test.ts; here the "hashes" are plain
 * strings, which is all the SQL ever sees.
 */

type Amr = { method: string; timestamp: number }[];
const nowSec = () => Math.floor(Date.now() / 1000);

async function as<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
  opts: { aal?: "aal1" | "aal2"; amr?: Amr } = {},
): Promise<T> {
  const claims = JSON.stringify({ sub: userId, aal: opts.aal ?? "aal2", amr: opts.amr ?? [] }).replace(/'/g, "''");
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false);`);
  await db.exec(`select set_config('request.jwt.claims', '${claims}', false);`);
  await db.exec(`set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
    await db.exec(`select set_config('request.jwt.claims', '', false);`);
  }
}

const SALTS = Array.from({ length: 10 }, (_, i) => `salt${i}`);
const HASHES = Array.from({ length: 10 }, (_, i) => `hash${i}`);
const fresh = (): Amr => [{ method: "totp", timestamp: nowSec() - 30 }];

describe("MFA recovery codes (0078)", () => {
  let db: PGlite;
  let f: Fixture;

  const setCodes = (user: string, opts?: Parameters<typeof as>[3]) =>
    as(db, user, () => db.query(`select public.mfa_recovery_set_codes($1::text[], $2::text[]) as n`, [SALTS, HASHES]), opts ?? { amr: fresh() });
  const redeem = (user: string, digests: string[], opts?: Parameters<typeof as>[3]) =>
    as(
      db,
      user,
      async () => (await db.query<{ r: Record<string, unknown> }>(`select public.mfa_recovery_redeem($1::text[]) as r`, [digests])).rows[0].r,
      opts ?? { aal: "aal1" },
    );

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
    await db.exec(`
      create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, factor_type text, status text);
      insert into auth.mfa_factors (user_id, factor_type, status) values
        ('${f.adaUser}', 'totp', 'verified'),
        ('${f.boUser}',  'totp', 'verified');
    `);
  });
  afterEach(async () => {
    await db.close();
  });

  describe("creating the set", () => {
    it("stores ten codes for a session with a fresh two-step code", async () => {
      const { rows } = await setCodes(f.adaUser);
      expect(Number((rows[0] as { n: number }).n)).toBe(10);
      const { rows: status } = await as(db, f.adaUser, () => db.query<{ s: { total: number; remaining: number } }>(`select public.mfa_recovery_status() as s`));
      expect(status[0].s.total).toBe(10);
      expect(status[0].s.remaining).toBe(10);
    });

    it("refuses a session with no recent authenticator code, or at aal1", async () => {
      await expect(setCodes(f.adaUser, { amr: [{ method: "totp", timestamp: nowSec() - 16 * 60 }] })).rejects.toThrow(/fresh code/i);
      await expect(setCodes(f.adaUser, { amr: [{ method: "password", timestamp: nowSec() }] })).rejects.toThrow(/fresh code/i);
      await expect(setCodes(f.adaUser, { aal: "aal1", amr: fresh() })).rejects.toThrow(/two-step/i);
    });

    it("needs exactly ten codes", async () => {
      await expect(
        as(db, f.adaUser, () => db.query(`select public.mfa_recovery_set_codes($1::text[], $2::text[])`, [SALTS.slice(0, 9), HASHES.slice(0, 9)]), { amr: fresh() }),
      ).rejects.toThrow(/ten codes/i);
    });

    it("replaces the old set and clears an earlier lock", async () => {
      await setCodes(f.adaUser);
      for (let i = 0; i < 5; i++) await redeem(f.adaUser, ["nope"]);
      await setCodes(f.adaUser);
      const { rows } = await db.query(`select 1 from public.mfa_recovery_codes where user_id = $1::uuid`, [f.adaUser]);
      expect(rows).toHaveLength(10);
      const r = await redeem(f.adaUser, ["nope"]);
      expect(r.reason).toBe("wrong");
    });
  });

  describe("what a person can read", () => {
    beforeEach(async () => {
      await setCodes(f.adaUser);
      await setCodes(f.boUser);
    });

    it("sees their own used flags and nothing of anyone else", async () => {
      const { rows } = await as(db, f.adaUser, () => db.query(`select id, used_at, user_id from public.mfa_recovery_codes`));
      expect(rows).toHaveLength(10);
      expect(rows.every((r) => (r as { user_id: string }).user_id === f.adaUser)).toBe(true);
    });

    it("can never select the hash or salt, or touch the lockout table", async () => {
      await expect(as(db, f.adaUser, () => db.query(`select code_hash from public.mfa_recovery_codes`))).rejects.toThrow(/permission denied/i);
      await expect(as(db, f.adaUser, () => db.query(`select salt from public.mfa_recovery_codes`))).rejects.toThrow(/permission denied/i);
      await expect(as(db, f.adaUser, () => db.query(`select * from public.mfa_recovery_codes`))).rejects.toThrow(/permission denied/i);
      await expect(as(db, f.adaUser, () => db.query(`select * from public.mfa_recovery_lockouts`))).rejects.toThrow(/permission denied/i);
    });

    it("cannot write the tables directly", async () => {
      await expect(
        as(db, f.adaUser, () => db.query(`insert into public.mfa_recovery_codes (user_id, salt, code_hash) values ($1::uuid, 's', 'h')`, [f.adaUser])),
      ).rejects.toThrow(/permission denied/i);
      await expect(as(db, f.adaUser, () => db.query(`update public.mfa_recovery_codes set used_at = null`))).rejects.toThrow(/permission denied/i);
      await expect(as(db, f.adaUser, () => db.query(`delete from public.mfa_recovery_codes`))).rejects.toThrow(/permission denied/i);
    });

    it("gets back only their own unused salts", async () => {
      await redeem(f.adaUser, [HASHES[0]]);
      const { rows } = await as(db, f.adaUser, () => db.query<{ salt: string }>(`select salt from public.mfa_recovery_salts()`), { aal: "aal1" });
      expect(rows).toHaveLength(9);
    });

    it("anonymous callers cannot run any of the functions", async () => {
      await db.exec(`set role anon;`);
      try {
        await expect(db.query(`select public.mfa_recovery_status()`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select public.mfa_recovery_redeem(array['x'])`)).rejects.toThrow(/permission denied/i);
        await expect(db.query(`select public.mfa_recovery_set_codes(array['x'], array['y'])`)).rejects.toThrow(/permission denied/i);
      } finally {
        await db.exec(`reset role;`);
      }
    });
  });

  describe("redeeming", () => {
    beforeEach(async () => {
      await setCodes(f.adaUser);
      await setCodes(f.boUser);
    });

    it("a right code is spent once and removes only the caller's factors", async () => {
      const ok = await redeem(f.adaUser, ["wrong", HASHES[3], "alsowrong"]);
      expect(ok.ok).toBe(true);
      const { rows: ada } = await db.query(`select 1 from auth.mfa_factors where user_id = $1::uuid`, [f.adaUser]);
      const { rows: bo } = await db.query(`select 1 from auth.mfa_factors where user_id = $1::uuid`, [f.boUser]);
      expect(ada).toHaveLength(0);
      expect(bo).toHaveLength(1);

      // The same code does not work twice.
      await db.exec(`insert into auth.mfa_factors (user_id, factor_type, status) values ('${f.adaUser}', 'totp', 'verified')`);
      const again = await redeem(f.adaUser, [HASHES[3]]);
      expect(again.ok).toBe(false);
      const { rows: still } = await db.query(`select 1 from auth.mfa_factors where user_id = $1::uuid`, [f.adaUser]);
      expect(still).toHaveLength(1);
    });

    it("another person's code does not work for me", async () => {
      await db.exec(`update public.mfa_recovery_codes set code_hash = 'bo-only-hash' where user_id = '${f.boUser}' and salt = 'salt0'`);
      const r = await redeem(f.adaUser, ["bo-only-hash"]);
      expect(r.ok).toBe(false);
      const { rows } = await db.query(`select 1 from auth.mfa_factors where user_id = $1::uuid`, [f.adaUser]);
      expect(rows).toHaveLength(1);
    });

    it("works with a password-only session, which is who needs it", async () => {
      expect((await redeem(f.adaUser, [HASHES[0]], { aal: "aal1" })).ok).toBe(true);
    });

    it("counts wrong codes, then locks for 15 minutes on the fifth", async () => {
      const first = await redeem(f.adaUser, ["x"]);
      expect(first).toMatchObject({ ok: false, reason: "wrong", attempts_left: 4 });
      for (let i = 0; i < 3; i++) await redeem(f.adaUser, ["x"]);
      const fifth = await redeem(f.adaUser, ["x"]);
      expect(fifth).toMatchObject({ ok: false, reason: "locked" });

      const { rows } = await db.query<{ mins: number }>(
        `select extract(epoch from (locked_until - now())) / 60 as mins from public.mfa_recovery_lockouts where user_id = $1::uuid`,
        [f.adaUser],
      );
      expect(Number(rows[0].mins)).toBeGreaterThan(14);
      expect(Number(rows[0].mins)).toBeLessThanOrEqual(15);
    });

    it("refuses even the right code while locked, and returns no salts", async () => {
      for (let i = 0; i < 5; i++) await redeem(f.adaUser, ["x"]);
      const r = await redeem(f.adaUser, [HASHES[0]]);
      expect(r).toMatchObject({ ok: false, reason: "locked" });
      const { rows } = await db.query(`select 1 from auth.mfa_factors where user_id = $1::uuid`, [f.adaUser]);
      expect(rows).toHaveLength(1);
      const salts = await as(db, f.adaUser, () => db.query(`select salt from public.mfa_recovery_salts()`), { aal: "aal1" });
      expect(salts.rows).toHaveLength(0);
      const st = await as(db, f.adaUser, () => db.query<{ s: { locked_until: string | null } }>(`select public.mfa_recovery_status() as s`), { aal: "aal1" });
      expect(st.rows[0].s.locked_until).not.toBeNull();
    });

    it("a lock on one person does not touch another", async () => {
      for (let i = 0; i < 5; i++) await redeem(f.adaUser, ["x"]);
      expect((await redeem(f.boUser, [HASHES[0]])).ok).toBe(true);
    });

    it("starts counting again once the lock has run out", async () => {
      for (let i = 0; i < 5; i++) await redeem(f.adaUser, ["x"]);
      await db.exec(`update public.mfa_recovery_lockouts set locked_until = now() - interval '1 second' where user_id = '${f.adaUser}'`);
      const r = await redeem(f.adaUser, ["x"]);
      expect(r).toMatchObject({ ok: false, reason: "wrong", attempts_left: 4 });
      expect((await redeem(f.adaUser, [HASHES[1]])).ok).toBe(true);
    });

    it("a good code clears the wrong-attempt count", async () => {
      for (let i = 0; i < 4; i++) await redeem(f.adaUser, ["x"]);
      await redeem(f.adaUser, [HASHES[2]]);
      const r = await redeem(f.adaUser, ["x"]);
      expect(r).toMatchObject({ reason: "wrong", attempts_left: 4 });
    });

    it("refuses an oversized request", async () => {
      await expect(redeem(f.adaUser, Array.from({ length: 11 }, (_, i) => `d${i}`))).rejects.toThrow(/malformed/i);
    });
  });
});
