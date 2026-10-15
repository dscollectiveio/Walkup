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
 *
 * `before`: apply only migration files whose name sorts strictly before it
 * ("0053" applies 0001 to 0052). Omitted, every migration is applied.
 */
export async function freshDb(opts: { before?: string } = {}): Promise<PGlite> {
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

    -- Same idea for auth.jwt() — real Supabase exposes the full claim set as
    -- jsonb. Migration 0025's session_is_aal2() reads the 'aal' claim from
    -- this the same way production does.
    create or replace function auth.jwt() returns jsonb
      language sql stable
    as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;

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
    -- Supabase lets these roles resolve names in auth (auth.uid() and
    -- auth.jwt() are callable; auth.users stays unreadable: no table grant).
    -- Without it, a SECURITY INVOKER function that calls auth.uid() in its
    -- body or in dynamic SQL fails here but not in production (0052).
    grant usage on schema auth to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
    -- ... and, on a real project, execute on every NEW function in public to
    -- the same three roles (Supabase's default privileges). A function that a
    -- migration only revokes from public and anon is therefore still callable
    -- by authenticated and service_role in production; without this line the
    -- tests would show it as locked (REVIEW-1 #18). Migrations that mean
    -- "service only" must revoke from authenticated too, and the tests now
    -- prove it.
    alter default privileges in schema public
      grant execute on functions to anon, authenticated, service_role;
  `);

  const files = await migrationFiles();
  await applyFiles(db, opts.before === undefined ? files : files.filter((f) => f < opts.before!));

  return db;
}

/**
 * Apply, in order, every migration file whose name sorts at or after `from`
 * ("0053" applies 0053 and anything later). Pairs with
 * `freshDb({ before: "0053" })` to test a data migration: seed, write the
 * legacy rows the migration has to repair, then apply the rest.
 */
export async function applyMigrations(db: PGlite, opts: { from: string }): Promise<void> {
  const files = await migrationFiles();
  await applyFiles(db, files.filter((f) => f >= opts.from));
}

async function applyFiles(db: PGlite, files: string[]): Promise<void> {
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (cause) {
      throw new Error(`migration ${file} failed: ${(cause as Error).message}`, { cause });
    }
  }
}

/**
 * A stand-in for Supabase Storage's `storage.objects`, with only the columns
 * 0051's functions read (foundation-spec 2.6). Created after the migrations,
 * so the storage policies they would add are absent, exactly as under plain
 * PGlite; what it lets a test prove is the SECURITY DEFINER functions'
 * storage branch (attach_ticket_photo's object check, the pending-upload
 * count). Rows are written as superuser, the way Storage itself writes them.
 */
export async function addStorageStub(db: PGlite): Promise<void> {
  await db.exec(`
    create schema if not exists storage;
    create table storage.objects (
      id         uuid primary key default gen_random_uuid(),
      bucket_id  text,
      name       text,
      owner_id   text,
      metadata   jsonb,
      created_at timestamptz default now()
    );
  `);
}

export async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith(".sql")).sort();
}

/**
 * Run `fn` as the given auth user, restoring the previous identity after.
 *
 * Defaults to aal2 (MFA already completed) so every pre-existing test keeps
 * asserting what it always asserted — role-based access, not MFA state. Pass
 * `{ aal: "aal1" }` to test the migration 0025 gate itself.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: () => Promise<T>,
  opts: { aal?: "aal1" | "aal2" } = {},
): Promise<T> {
  const claims = JSON.stringify({ sub: userId ?? "", aal: opts.aal ?? "aal2" }).replace(/'/g, "''");
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ""}', false);`);
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

/**
 * Run `fn` as a request made with the project's service key (0055): the role is
 * `service_role` and the JWT carries `role: service_role`, which is what
 * `email_is_service()` reads. Only the reminder cron and the Resend webhook
 * ever do this in production.
 */
export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ role: "service_role" });
  await db.exec(`select set_config('request.jwt.claim.sub', '', false);`);
  await db.exec(`select set_config('request.jwt.claims', '${claims}', false);`);
  await db.exec(`set role service_role;`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
    await db.exec(`select set_config('request.jwt.claims', '', false);`);
  }
}
