/**
 * Local development database.
 *
 * PGlite (real Postgres, WASM) exposed on a Postgres wire-protocol socket, so
 * the Next.js server connects with node-postgres exactly as it would to a real
 * Supabase instance — same policies, same triggers, same RLS engine, no Docker.
 *
 * What this is NOT, and why it matters:
 *   - no Supabase Auth. Identity comes from a dev cookie (see src/lib/db.ts).
 *   - no PostgREST, so the one-transaction-per-request property that motivates
 *     post_journal_entry() is NOT reproduced here. It still has to be verified
 *     against a real project.
 *   - in-memory. Every restart is a fresh database.
 *
 * See docs/DECISIONS.md #15.
 */
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.DEV_DB_PORT ?? 5433);
const ROOT = path.resolve(import.meta.dirname, "..");

const db = await PGlite.create({ extensions: { btree_gist } });

await db.exec(`
  create schema if not exists extensions;
  create schema if not exists auth;
  create extension if not exists btree_gist with schema extensions;

  create table auth.users (id uuid primary key default gen_random_uuid(), email text);

  create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  end $$;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);

const dir = path.join(ROOT, "supabase/migrations");
for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(await readFile(path.join(dir, file), "utf8"));
  console.log(`  applied ${file}`);
}

// Development data. The same deliberately awkward fixture the tests use:
// a delinquent owner, reserve interest, a capital item over threshold, and a
// board member who is also an owner.
const { seedDev } = await import("./dev-seed.mjs");
await seedDev(db);
console.log("  seeded dev data");

const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1" });
await server.start();
console.log(`\n  dev database listening on postgres://127.0.0.1:${PORT}\n`);

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  });
}
