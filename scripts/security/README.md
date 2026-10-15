# Walkup RLS attack harness

Authorized, defensive RLS/PostgREST/RPC/Storage attack suite for a throwaway
Supabase branch. Plain Node ESM (`fetch`, `node:crypto`), no new dependencies.

**Scope:** only ever point this at a disposable Supabase branch with seed data,
never at `oeqgtakyhtauldaebwcn` (production) or `xhrivmdkrcfkhjyhkhye` (dev).
See `docs/security/STAGING.md`.

## Files

- `lib.mjs` — auth (password sign-in, TOTP enrollment/verification to step a
  session up to AAL2), PostgREST/RPC/Storage request helpers, a tiny
  PASS/FAIL reporter. Credentials are read from a file at runtime; nothing is
  hardcoded.
- `attack-rls.mjs` — the checks themselves. Prints `PASS`/`FAIL` with a
  one-line reason per check, exits non-zero if any check `FAIL`s.
- `cleanup-fixtures.sql` — removes the handful of `SECURITY-TEST`-prefixed
  fixture rows that have no DELETE policy on any role (tickets, ticket
  comments, bank connections), run via the Supabase MCP `execute_sql` tool or
  the SQL editor after a run.

## Running it

```sh
# Defaults already point at the security-test branch
# (https://brwauxmdjgfrdqfbgezg.supabase.co) and its publishable key, and at
# .env.staging-credentials.local next to the repo root. Override for a
# different branch later:
export SUPABASE_URL="https://<branch-ref>.supabase.co"
export SUPABASE_ANON_KEY="<branch publishable/anon key>"
export STAGING_CREDENTIALS_PATH="/path/to/.env.staging-credentials.local"

node scripts/security/attack-rls.mjs
```

The credentials file is simple `KEY=VALUE` lines, gitignored:

```
ADMIN_A_EMAIL=...
ADMIN_A_PASSWORD=...
ADMIN_B_EMAIL=...
ADMIN_B_PASSWORD=...
OWNER_A_EMAIL=...
OWNER_A_PASSWORD=...
```

Admin A and Owner A belong to "Staging Building A"; Admin B belongs to
"Staging Building B". The two association ids are *learned* at runtime from
each account's own session (`associations` RLS limits each to their own
building) — nothing building-specific is hardcoded except that assumption
about the seed shape.

## What it does on each run

1. Signs in each account with a password (AAL1).
2. Enrolls a brand-new TOTP factor over `/auth/v1/factors`, computes the
   6-digit code itself (RFC 6238, SHA-1, 30s step — `node:crypto`, no
   authenticator app needed), and verifies it to step the session up to AAL2.
3. Runs every check as anon (no session), AAL1 (password only), and AAL2
   (post-MFA), exactly as a hostile client would — raw `fetch` calls to
   `/auth/v1`, `/rest/v1/<table>`, `/rest/v1/rpc/<fn>`, and
   `/storage/v1/object/...`. No `supabase-js`, no service role key.
4. Deletes the TOTP factor it created for each account when done, so re-runs
   don't pile up factors on the throwaway accounts.

## A branch-provisioning fix this harness needed, once

The `security-test` branch's preview database never ran Supabase's own
project-bootstrap `GRANT ... TO anon, authenticated` statements on every
table (that happens once per *project*, outside this repo's migrations, and
apparently isn't re-run for a branch). Without it, every PostgREST request
got `42501 permission denied for table X` *before* RLS was even evaluated —
which would make every check in this suite trivially pass for the wrong
reason. One-time fix applied directly to the branch via the Supabase MCP
`execute_sql` tool (not a migration, not applied to any other project):

```sql
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
```

RLS policies are unchanged by this — it only restores the table-level grant
baseline production already has, so RLS is what actually gets exercised. If
you rebuild this branch from scratch, re-apply this once before running the
suite, or every check will show a false PASS.

## A trap this harness's own author fell into — read before extending it

Two tables that this suite deliberately attacks (`role_grants`,
`unit_owners`) have **no DELETE policy for any role, by design** — grants are
revoked via `revoked_at`, not removed (0002, 0030 added delete back for
`unit_owners` only). `tickets`/`ticket_comments`/`bank_connections` are the
same story. A cleanup step that calls `.delete(...)` on one of these silently
affects zero rows and returns `204` as if it worked. The first full run of
this suite left a live `role_grants` row granting Admin B's login
`board_member` on Building A, which then made *every* subsequent check in
that run — and several follow-up manual queries — look like Building A's
data was broadly leaking to Building B, when the real cause was this one
stale fixture row from the suite's own section 5, not a schema bug. Lesson
encoded in the script now: revoke via `UPDATE ... SET revoked_at = now()`
(the board_admin UPDATE policy allows it) and **verify the revoke actually
took effect** (re-query as the other side) before trusting anything that
runs afterward. Run `cleanup-fixtures.sql` after a run to remove what still
can't be deleted through the API.

## Extending this for a future branch

Once 0051/0052/0053 (or later) land on a branch, add that schema's new
tables/functions to the relevant lists in `attack-rls.mjs` (the generic
cross-building sweep's table list, the board-only list, the SECURITY DEFINER
function list). The two findings this suite currently expects to `FAIL`
(`finding(a)`/`finding(b)`, the shared-area ticket visibility bugs) should
start `PASS`ing once 0053 is applied — if they don't, that's a regression in
the fix, not a new bug.
