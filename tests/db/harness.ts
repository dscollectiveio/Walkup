import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");

/**
 * An in-process Postgres for testing the schema. Real Postgres compiled to
 * WASM — same planner, same constraint semantics, same RLS engine — so
 * triggers and policies behave as they will in production.
 *
 * What it is NOT: Supabase. There is no PostgREST, no Auth service, no
 * Storage. The `auth` schema below is a stub good enough for RLS policies to
 * compile and run, and nothing more. Anything that depends on the real Auth
 * service must be tested against a Supabase project.
 *
 * The deliberate consequence: every RLS policy and every trigger can be
 * proven locally, with no Docker and no cloud project, before real data
 * exists anywhere.
 */
export async function freshDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist } });

  await db.exec(`
    -- Supabase creates these. PGlite does not.
    create schema if not exists extensions;
    create schema if not exists auth;

    create extension if not exists btree_gist with schema extensions;

    -- Minimal stand-in for auth.users. Only the columns the schema's foreign
    -- keys actually reference.
    create table auth.users (
      id    uuid primary key default gen_random_uuid(),
      email text
    );

    -- Supabase derives auth.uid() from the request JWT. Here it reads a
    -- session GUC, so a test can say "run as this user" by setting it.
    create or replace function auth.uid() returns uuid
      language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    -- Roles PostgREST connects as. Policies reference them by name.
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;

    -- Supabase grants table access broadly and relies on RLS to restrict.
    -- Replicated here so that a denied read is a POLICY decision, not a
    -- missing GRANT — otherwise the isolation tests would pass for the wrong
    -- reason and keep passing after someone removed the policy.
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
  `);

  for (const file of await migrationFiles()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (cause) {
      throw new Error(`migration ${file} failed: ${(cause as Error).message}`, { cause });
    }
  }

  return db;
}

export async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith(".sql")).sort();
}

/** Run `fn` as the given auth user, restoring the previous identity after. */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
  await db.exec(`set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  }
}
