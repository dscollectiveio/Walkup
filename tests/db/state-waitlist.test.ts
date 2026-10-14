import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, freshDb } from "./harness";
import { seed, type Fixture } from "./fixtures";

const HASH = (c: string) => c.repeat(64);

/** Run as a signed-out visitor (the anon role), restoring the identity after. */
async function asAnon<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role anon;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
  }
}

const join = (db: PGlite, email: string, state: string, hash: string | null = HASH("a")) =>
  db.query(`select public.join_state_waitlist($1, $2, $3)`, [email, state, hash]);

/** Migration 0049: the other-states waitlist on the landing page. */
describe("state waitlist (0049)", () => {
  let db: PGlite;
  let f: Fixture;

  beforeEach(async () => {
    db = await freshDb();
    f = await seed(db);
  });
  afterEach(async () => {
    await db.close();
  });

  it("lets a signed-out visitor join, normalizing the email and state", async () => {
    await asAnon(db, () => join(db, "  Pat@Example.COM ", "wi"));
    const { rows } = await db.query<{ email: string; state_code: string }>(`select email, state_code from public.state_waitlist`);
    expect(rows).toEqual([{ email: "pat@example.com", state_code: "WI" }]);
  });

  it("ignores a repeat of the same email and state, so it can't reveal who signed up", async () => {
    await asAnon(db, () => join(db, "pat@example.com", "WI"));
    await asAnon(db, () => join(db, "PAT@example.com", "WI"));
    await asAnon(db, () => join(db, "pat@example.com", "MN"));
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.state_waitlist`);
    expect(rows[0].n).toBe(2);
  });

  it("refuses a bad email, Illinois, or a made-up state", async () => {
    await expect(asAnon(db, () => join(db, "not-an-email", "WI"))).rejects.toThrow(/valid email/);
    await expect(asAnon(db, () => join(db, "pat@example.com", "IL"))).rejects.toThrow(/choose your state/);
    await expect(asAnon(db, () => join(db, "pat@example.com", "Wisconsin"))).rejects.toThrow(/choose your state/);
  });

  it("caps sign-ups from one hashed address at 5 an hour", async () => {
    for (let i = 0; i < 5; i++) await asAnon(db, () => join(db, `v${i}@example.com`, "WI", HASH("b")));
    await expect(asAnon(db, () => join(db, "v6@example.com", "WI", HASH("b")))).rejects.toThrow(/too many sign-ups from here/);
    // A different address is unaffected.
    await asAnon(db, () => join(db, "v7@example.com", "WI", HASH("c")));
  });

  it("caps all sign-ups at 200 an hour, whatever hash is sent", async () => {
    await db.exec(`
      insert into public.state_waitlist (email, state_code)
      select 'bulk' || g || '@example.com', 'WI' from generate_series(1, 200) g;
    `);
    await expect(asAnon(db, () => join(db, "late@example.com", "WI", null))).rejects.toThrow(/too many sign-ups right now/);
  });

  it("gives nobody read or write access through the API, signed in or not", async () => {
    await asAnon(db, () => join(db, "pat@example.com", "WI"));
    const anonRows = await asAnon(db, () => db.query(`select * from public.state_waitlist`));
    expect(anonRows.rows).toEqual([]);
    await expect(asAnon(db, () => db.query(`insert into public.state_waitlist (email, state_code) values ('x@example.com', 'WI')`))).rejects.toThrow();
    const boardRows = await asUser(db, f.cyUser, () => db.query(`select * from public.state_waitlist`));
    expect(boardRows.rows).toEqual([]);
  });
});
