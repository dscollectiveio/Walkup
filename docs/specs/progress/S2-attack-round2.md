# S2: attack round 2 (0051–0060)

Source: task brief (authorized round-2 attack on the `security-test` Supabase branch, ref
`brwauxmdjgfrdqfbgezg`, now carrying migrations 0051–0060 on top of production's 0001–0050).
Full findings: `docs/security/ATTACK-REPORT-2.md`. Script: `scripts/security/attack-round2.mjs`
(reuses `scripts/security/lib.mjs` unchanged, additively — no changes to `lib.mjs` were needed).
Cleanup: `scripts/security/cleanup-round2.sql`.

## What was built

- `scripts/security/attack-round2.mjs` — 527 checks across the ten categories in the brief:
  escalation (board_member/accountant/owner/outsider → board_admin), a cross-building + board-only
  sweep over every 0051–0060 table, SECURITY DEFINER function privilege checks (anon-callable and
  service-role-only sets), AI quota abuse, email/reminders, imports, tickets/photos/storage, owner
  portal, tax-view reversal forging, and documents/`document_links`. PASS/FAIL/SKIP per check,
  non-zero exit on any FAIL, same conventions as round 1's `attack-rls.mjs`.
- Three throwaway identities seeded directly on the branch via the Supabase MCP `execute_sql` tool
  (never a migration): board_member and accountant in Staging Building A, an outsider owner in
  Staging Building B. Credentials appended to `.env.staging-credentials.local` (gitignored).
- `scripts/security/cleanup-round2.sql` — removes everything the seeding step and the attack script
  create, run as `postgres` via `execute_sql` (several tables, `role_grants` plus two more found
  this round — `ticket_events`, `ticket_board_details` — have no DELETE policy for any application
  role, so the app-level harness can never fully clean itself; this script is the only thing that
  can). Verified all leftover counts at 0 after running it.

## Table/function enumeration

The brief asked for dynamic enumeration (PostgREST OpenAPI root or `execute_sql`), not a hardcoded
list. `GET /rest/v1/` on this instance now refuses the publishable/anon key ("Secret API key
required"), and no service-role key is in scope, so the table list baked into the script is a
snapshot generated once via `execute_sql` against `information_schema` (query in
`ATTACK-REPORT-2.md`'s Method section) — regenerate it the same way for a future round rather than
hand-editing.

## Result

511 PASS, 0 FAIL, 16 SKIP (SKIPs are all "no row in this seed to target" — a seed-breadth gap, not
a result). **No new exploitable vulnerability found.** Six items worth a human's attention are in
`ATTACK-REPORT-2.md`'s Findings section, none independently exploitable (a documentation/GRANT
mismatch, a confirmed-unchanged documented residual, an HTTP-status cosmetic issue, a finding that
couldn't be reproduced via raw REST so is neither confirmed nor refuted, a deliberate test-scope
narrowing explained for a future round, and one inconclusive check blocked by the seed's own
shape). FX1 #1 (the BLOCKER board_member→board_admin escalation), FX1 #10 (cross-building vendor
id into `record_expense`), FX1 #11 (`documents.storage_path` cross-building), and 0053(j) (accountant
walled off from Repairs) were all re-confirmed fixed, this time with the board_member and accountant
roles directly rather than reasoning about them from the owner/admin accounts round 1 used.

**Production impact:** production runs 0001–0050 only. The one production-live item is FX1 #1
itself — pre-0060 production still has the vulnerable `invites_insert` policy and
`tg_persons_self_edit_guard` body; round 2 reconfirms the *fix* (0060, unreleased) works, it does
not re-attack production (out of scope) to independently reconfirm the hole is open there today.
Every other finding concerns 0051–0060-only objects.

## Lesson for a future round

`ticket_events` and `ticket_board_details` join `role_grants`/`unit_owners` as tables with no
DELETE policy for anyone. A ticket's own creation trigger writes a `ticket_events` row
unconditionally, so **no fixture ticket created through the app can ever be deleted through the
app** — only `postgres` via `execute_sql` can. This cost two stray `SECTEST2-` tickets accumulating
across early runs before it was caught (both documents' header comments now state it explicitly so
it isn't rediscovered the hard way).
