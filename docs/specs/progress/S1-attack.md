# S1: authorized RLS attack on the `security-test` branch (2026-10-14)

Scope: Supabase branch `security-test`, ref `brwauxmdjgfrdqfbgezg`, parented
off production, schema 0001–0050 (no real data). Never touched production
(`oeqgtakyhtauldaebwcn`) or dev (`xhrivmdkrcfkhjyhkhye`).

- `scripts/security/lib.mjs`, `attack-rls.mjs`, `cleanup-fixtures.sql`,
  `README.md` — reusable Node ESM harness. Signs in as each throwaway
  account over the real Auth REST API, enrolls and verifies a TOTP factor
  itself (RFC 6238 via `node:crypto`, no app) to reach AAL2, then attacks
  PostgREST/RPC/Storage directly as anon/AAL1/AAL2, exactly like a hostile
  client. 135 checks, 130 pass.
- One-time branch fix (not a migration, not touched on dev/prod): the branch
  never got Supabase's own project-bootstrap `GRANT ... TO anon,
  authenticated` on every table, so every request 403'd before RLS even ran.
  Restored via the Supabase MCP `execute_sql` tool. Documented in the
  README so a future branch isn't a surprise.
- Hit a real trap in the harness itself: `role_grants` and `unit_owners`
  have no DELETE policy for some/all roles — a cleanup `.delete()` silently
  affects 0 rows. One uncleaned fixture row briefly made Admin B a real
  `board_member` of Building A for the rest of a run, which looked like a
  severe storage/table leak until traced to that row. Fixed by revoking via
  `UPDATE ... SET revoked_at = now()` (the real app's own revoke path) and
  verifying the revoke took effect before trusting later checks.
- 5 findings, all written up in `docs/security/ATTACK-REPORT-1.md`:
  1. `tickets_select`'s `unit_id is null` branch has no membership check —
     any signed-in user, any association, reads every shared-area ticket.
     **High. Live on production today.**
  2. `ticket_comments_select` has no predicate at all beyond "the ticket
     exists" — broader than reported, leaks comments on unit-specific
     tickets too. **High. Live on production today.**
  3. `ticket_comments_insert` checks the caller's own association, never
     the ticket's real one — cross-tenant comment injection. **High. Live
     on production today.**
  4. `role_grants` insert never checks that `person_id`'s own association
     matches the grant — new finding, not in the original two. **Medium.**
  5. `unit_owners` insert never checks that `unit_id`'s own association
     matches the row — new finding. Investigated and found contained (no
     confirmed read leak through any current query path) but a real
     integrity gap. **Low–Medium.**
  Findings 1–3 are fixed by the unreleased `0053_repairs_v2.sql` (confirmed
  by reading it, not running it). Findings 4–5 are not addressed by
  0051/0052/0053 and need follow-up migrations of their own.
- Cleanup verified: every fixture row this run created is gone; the
  branch's row counts match pre-engagement state for every table touched.
