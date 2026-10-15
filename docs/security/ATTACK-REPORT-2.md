# Attack report 2 — RLS/PostgREST/RPC/Storage, round 2, `security-test` branch (0051–0060)

**Target:** Supabase branch `security-test`, ref `brwauxmdjgfrdqfbgezg`
(https://brwauxmdjgfrdqfbgezg.supabase.co), parented off production
(`oeqgtakyhtauldaebwcn`). Schema = production's 0001–0050 **plus** migrations
0051–0060 (Insurance/Repairs v2, owner portal, email/reminders, imports, the
0057/0059/0060 integrity and review-hardening fixes). Production itself is
still on 0001–0050 only, per `docs/DECISIONS.md` #35–#40.

**Method:** `scripts/security/attack-round2.mjs`, reusing
`scripts/security/lib.mjs` unchanged (raw `fetch`, real password sign-in,
a throwaway TOTP factor enrolled and verified per account to reach AAL2,
`node:crypto`, no `supabase-js`, no service role key). Six identities this
round: Admin A, Admin B, Owner A (round 1's accounts) plus three new
throwaway identities seeded directly on the branch via the Supabase MCP
`execute_sql` tool — **Board Member A** and **Accountant A** (both in
Staging Building A) and an **outsider Owner B** (owner, Staging Building B).
Every check runs as anon, AAL1 (password only), and AAL2, and prints
PASS/FAIL/SKIP with a reason; the harness exits non-zero on any FAIL.

The task asked for dynamic table/function enumeration via the PostgREST
OpenAPI root or `execute_sql`. On this Supabase instance `GET /rest/v1/` now
refuses the publishable/anon key outright:
```
$ curl -s https://brwauxmdjgfrdqfbgezg.supabase.co/rest/v1/ -H "apikey: <publishable key>"
{"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}
```
No service-role key is in scope for this suite (round 1's rule, unchanged),
so the table list baked into `attack-round2.mjs` was generated once, outside
the script, with the Supabase MCP `execute_sql` tool against this exact
branch's `information_schema`:

```sql
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema='public' and c.table_name=t.table_name and c.column_name='association_id') has_assoc
  from information_schema.tables t
 where table_schema='public' and table_type='BASE TABLE'
 order by table_name;
```
and function privileges with:
```sql
select p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) args,
       array_agg(distinct r2.rolname) exec_roles
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  left join aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a on a.privilege_type='EXECUTE'
  left join pg_roles r2 on r2.oid = a.grantee
 where n.nspname='public'
 group by p.proname, p.prosecdef, p.oid order by p.proname;
```
This is a generated snapshot (dated 2026-10-14), not a hand-maintained guess
— regenerate it the same way if the schema changes again.

**Result:** 527 checks: **511 PASS, 0 FAIL, 16 SKIP** (final clean run).
SKIPs are all "no row exists in this seed to target" (e.g. no
`dues_payment_reports`, no sent/delivered `email_outbox` row, no
`document_links` fixture to join cross-building) — a gap in the seed's
breadth, not a result either way. One check (`tax_line_classifications`
insert by an owner) is marked inconclusive rather than PASS/FAIL — see
Finding 6. **No new exploitable vulnerability was found in round 2.**

## Summary

| # | Category | Checks | Result |
|---|---|---|---|
| 1 | Escalation (board_member/accountant/owner/outsider → board_admin) | 17 | All refused |
| 2 | Cross-building + board-only sweep, every 0051–0060 table | ~380 | All refused/empty; see Finding 5 for scope notes |
| 3 | SECURITY DEFINER function privileges (anon/service-role boundaries) | 16 | All as documented |
| 4 | AI quota abuse (claim/finish/refund/cross-person) | 5 | Bounded; FX1 #2 residual confirmed unchanged (Finding 2) |
| 5 | Email/reminders (role gating, arbitrary address, suppression, tokens) | 11 | All refused/consistent; see Finding 1 (doc mismatch) |
| 6 | Imports (role gating, cross-building, cross-building vendor) | 7 | All refused; FX1 #10 re-confirmed fixed |
| 7 | Tickets/photos/storage (path abuse, board-only reads, triage planting) | 9 | All refused; FX1 #14 not reproducible via REST (Finding 4) |
| 8 | Owner portal (cross-building statements, announcement writes, reports) | 6 | All refused/empty |
| 9 | Tax views (cross-building reversal, double reversal, re-reversal) | 5 | All as designed; FX1/0060 guard confirmed |
| 10 | Documents (cross-building storage_path, document_links) | 2 | FX1 #11 re-confirmed fixed |

## Findings

None of the six items below is independently exploitable; each is included
because a human should see it, not because this suite could turn it into a
breach on its own. Ordered by what's worth looking at first.

### 1. Minor — `DECISIONS.md` #36 overstates a GRANT that pg_proc contradicts

**Where:** `docs/DECISIONS.md` #36 says the service-role entry points use
"six named functions (`email_run_rules`, `email_claim`, `email_mark_sent`,
`email_mark_failed`, `email_record_event`, `email_purge`) that are **granted
to `service_role` and nobody else**."

`pg_proc`/`aclexplode` on this branch shows `email_claim`, `email_mark_sent`
and `email_mark_failed` also hold `EXECUTE` for `authenticated` (confirmed
with the appendix query below); only `email_run_rules`, `email_purge`,
`email_record_event`, `flag_bank_item_for_attention`,
`deprovision_stale_access` and `import_expire_stale` are actually
service_role-only as described.

**Why it isn't independently exploitable:** all three functions gate
themselves internally (`email_claim`/`email_mark_sent`/`email_mark_failed`'s
own bodies check `email_is_service() or has_role_in(assoc, ['board_admin'])`
and `status`/`claim_token` match before doing anything) — this is by design:
a board_admin legitimately calls these through the review-and-send UI, not
only the cron. `attack-round2.mjs`'s `doc-mismatch:email_claim` check
confirms a board_admin still can't claim a batch belonging to a different
association, and can't finish/fail a message it didn't itself claim
(`email_mark_sent`/`email_mark_failed`'s `claim_token` check). **Confirmed
reproduction:** `escalation`-section checks already exercise this path; see
`attack-round2.mjs` section 3's `doc-mismatch:email_claim` check.

**Impact:** none found. The prose in #36 is simply inaccurate about which
three of the six are board_admin-reachable by design, not service-role-only.

**Fix:** reword #36 to say three of the six are also callable by an
authenticated board_admin (by design, for the UI's own send flow), or, if
the intent really was service_role-only, revoke `authenticated`'s `EXECUTE`
on those three and move the UI's send-now path to go through the cron/queue
instead. Either is a documentation or minor-hardening fix, not a release
blocker.

**Not live/not live:** both states exist only from migration 0055 onward
(unreleased).

### 2. Low, documented residual — AI quota refund via `not_started` (FX1 #2) confirmed unchanged

**Where:** `claim_ai_call`/`finish_ai_call`, migration 0051,
`docs/specs/progress/FX1-db-fixes.md` #2.

Reconfirmed with a fresh identity (the new outsider owner in Building B,
not round 1's accounts): the owner-personal `ticket_triage` cap stopped
claims at exactly the documented limit (10) in the run that had quota left
to spend; a `finish_ai_call(..., p_error_code: 'not_started')` refund did
not let the caller exceed that limit further in this run (quota was already
exhausted from an earlier run the same day — `ai_usage_counts` counts every
`main` row as an attempt regardless of `not_started`, exactly as FX1 #2
describes: the ceiling is `2 * limit` attempts, not unbounded, and the
*comment in the migration already says this is intentional, not a hole*.
**Reproduction:** `attack-round2.mjs` section 4, `ai-quota:not_started
refund...`. **Impact:** a caller can roughly double their effective daily
quota by refunding rather than finishing calls; bounded, not unbounded, and
already an accepted residual per FX1. **Fix:** none required beyond FX1's
own note; if tightened further, `ai_usage_counts`'s `v_attempts` could
exclude rows the caller themselves marked `not_started` within the same
second as the claim (to stop rapid claim/refund cycling) at the cost of
losing the "double-counts real failures too" safety margin FX1 chose
deliberately. **Not live:** objects are 0051-only.

### 3. Informational — `redeem_invite`'s controlled refusal surfaces as HTTP 500

**Where:** `redeem_invite`, every invalid/forged/expired token.

PostgREST maps most `RAISE EXCEPTION` codes to 4xx, but PL/pgSQL's
`no_data_found` (`P0002`, raised by `redeem_invite`'s "this invite link is
not valid"/"...has already been used"/"...has expired" branches) isn't in
PostgREST's default mapping and falls through to HTTP 500. The refusal
itself is correct and controlled — no data is returned, no side effect
occurs — but a 500 looks like a server crash to monitoring/alerting and to
anyone fuzzing the endpoint, which is worse ergonomics than it needs to be
and could mask a real crash in that same noise. **Reproduction:**
`attack-round2.mjs` section 1's `redeem_invite` checks (now written to treat
`P0002` as a recognized refusal, not a crash, after this was first caught
as a 500 the harness didn't understand). **Impact:** none security-wise.
**Fix:** either catch `no_data_found` in `redeem_invite` and re-raise with
an errcode PostgREST maps to 404/400 (e.g. `22023`/`PGRST116`-shaped), or
add a `response.status` override via PostgREST's error-to-status config.
**Not live:** function body is unchanged by 0051–0060 in this respect, but
the fix is a one-line code change wherever applied.

### 4. Informational — FX1 #14 (owners reading `ticket_events` actor columns) not reproducible via raw REST

**Where:** `docs/specs/progress/FX1-db-fixes.md` #14, "NOT FIXED: owners
can read board identities from `ticket_events`."

A direct `GET /rest/v1/ticket_events?select=actor_user_id,actor_person_id`
as Owner A returns `403` outright — the table's RLS (`can_see_ticket`-gated
select, confirmed via `pg_policies`) blocks the owner from the table
entirely at the row level. FX1 #14's concern was specifically about
*server-side* reads (`src/app/layout.tsx`,
`src/app/maintenance/[ticketId]/load.ts`,
`src/app/repairs/owner-problems-view.tsx`) that select those columns under
an `authenticated` session for both board and owners and then (per FX1)
surface them in the UI regardless of role — a server-code question this
REST-only harness cannot see, since it never reaches those Next.js routes.
**This round does not re-confirm or refute FX1 #14** either way; it only
shows the raw-table RLS vector it checked is closed. **Fix:** unchanged
from FX1 #14's own recommendation (move those three server reads behind a
definer function/view that omits the actor columns for non-board viewers).
A future round should attack this with a browser-driven or route-handler
check, not PostgREST alone.

### 5. Scope note — cross-building UPDATE/DELETE mutation checks ran on a curated 6-table subset, not all ~80

**Where:** `attack-round2.mjs` section 2.

The full read-only cross-building sweep (reads, and inserts with only
`association_id` set) ran across all ~80 tables with an `association_id`
column. The two higher-risk mutations — `UPDATE ... SET association_id =`
and `DELETE`, aimed at a specific *existing* row in the other building —
were deliberately narrowed to six representative tables
(`tickets`, `upkeep_tasks`, `vendors`, `documents`, `journal_entries`,
`assessment_charges`), each captured and verified by id (not a blind
`WHERE association_id = X LIMIT 1` scan) and reverted immediately if a
repoint somehow succeeded. This was a deliberate trade after an early draft
of this same script scanned-and-mutated an arbitrary matching row on every
table and nearly left a real fixture ticket permanently repointed into the
wrong building before the bug was caught in testing (never reached a
committed run) — repeating that pattern across ~80 tables risked corrupting
shared fixture data for a result this suite's read-only sweep (which covers
the full table list) already answers as safely: every cross-building read
and bare insert was refused or empty. **Not a finding.** A future round with
more time could extend the curated list or build fresh disposable rows
per-table instead of reusing seed rows, to cover the remaining ~74 tables'
UPDATE/DELETE paths specifically.

### 6. Inconclusive — `tax_line_classifications` INSERT by an owner can't be tested with this seed

**Where:** `tax_line_classifications_insert` policy (`is_board(association_id)`,
confirmed via `pg_policies` — correctly board-only on paper).

An owner's attempt to insert a bare `{association_id: A}` row returns `409`
(`23503`, "journal_line <NULL> does not exist"), not the `403` a blocked
`WITH CHECK` would produce. Tracing it: `journal_line_id` is `NOT NULL` with
a `FOREIGN KEY` to `journal_lines`, and this seed has **zero**
`journal_lines` rows in Building A (confirmed via `information_schema`);
`tg_line_classification_association` (a `BEFORE INSERT` trigger) runs
*before* Postgres evaluates either the `NOT NULL` constraint or the
`INSERT`'s RLS `WITH CHECK`, and raises its own `23503` first whenever
`journal_line_id` doesn't resolve — masking whatever the real RLS check
would have said. **This is not a confirmed finding** — building a
conclusive payload needs a real `journal_line_id` in Building A, which
needs a posted, balanced journal entry with a real line to reference; the
round-2 harness's own `ensurePostedEntry` fixture (section 9) posts one but
only after this check already ran. **Fix for a future round:** move the
`ensurePostedEntry` fixture earlier (before section 2) and re-run this one
check with a real `journal_line_id` from it.

## Re-confirmed fixed (not findings — stated for the record)

- **FX1 #1** (board_member/accountant → board_admin via `role_grants`
  self-insert/self-update, forged `board_admin` invites, repointing another
  person's `auth_user_id`, inserting a person with a login attached,
  `redeem_invite` with a forged token): refused for **both** new roles this
  round (board_member and accountant, not just owner), on top of round 1's
  re-check of owner. Every route round 1 and FX1 described is closed on
  this branch (0051–0060). **This is the one BLOCKER-severity finding from
  this program that is squarely production-live today** — see
  "Production impact" below; round 2 confirms the *fix* works, it does not
  (cannot, without touching production, which is out of scope) independently
  re-demonstrate the hole in production.
- **FX1 #10** (blank `payee_map` key reaching a foreign vendor id): a fresh
  cross-building `record_expense` call with Building B's vendor id as
  Building A's board_admin is refused ("contractor belongs to a different
  association") — `tg_expenses_same_association` (0060) holds.
- **FX1 #11** (`documents.storage_path` pointing at another association):
  refused ("a document's file must be stored under its own association's
  folder") — `tg_documents_path_in_association` (0060) holds.
- **0053(j)** (accountant fully walled off from Repairs, not just a
  financial-reader subset): confirmed across all seven Repairs tables
  tested (`tickets`, `ticket_comments`, `ticket_board_details`,
  `ticket_bids`, `ticket_events`, `contractor_notes`, `contractor_messages`,
  `contractor_reviews`) — accountant A got either an empty result set or a
  403 on every one.
- **0060's double-reversal guard**: reversing an already-reversed entry a
  second time is refused (`P0001`, "this entry has already been reversed");
  reversing a reversal itself (by design, DECISIONS #40) succeeds.
- **`ticket_photo_permission`/`storage_path_kind`'s path validation**: every
  photo-path abuse attempted (another building's id in the path, a
  mismatched ticket id, an object that was never uploaded, literal `../`
  traversal segments) was refused with a controlled `22023`, never a crash
  and never a successful attach.

## Production impact

Production (`oeqgtakyhtauldaebwcn`) runs migrations 0001–0050 only. Every
finding in this report concerns 0051–0060 objects (not live) **except**:

- **The "re-confirmed fixed" FX1 #1 BLOCKER is production-live today.**
  `invites_insert` (0027) and the pre-0060 `tg_persons_self_edit_guard` are
  both pre-0051 objects that exist in production unchanged; the fix for
  both ships only in 0060 (unreleased, per DECISIONS #35/#40, "built, not
  yet applied to production"). This suite did not re-attack production
  (out of scope) and so cannot independently reconfirm the hole is open
  there today — that determination rests on `REVIEW-1-migrations.md`'s
  original finding and `FX1-db-fixes.md` #1's own analysis, both already on
  file. What round 2 adds is: the *fix*, once deployed, closes every route
  tested (now re-tested with two different non-admin roles, not one).
- All other findings/observations above (1–6) concern functions, tables, or
  triggers introduced in 0051–0060 and have no production-live component.

## Seeding and cleanup

Three throwaway identities were seeded directly on the `security-test`
branch via the Supabase MCP `execute_sql` tool (never a migration, never
applied to dev or production): `sectest2-board-member-a@staging-walkup.example`
(board_member, Staging Building A), `sectest2-accountant-a@staging-walkup.example`
(accountant, Staging Building A), `sectest2-outsider-owner-b@staging-walkup.example`
(owner, Staging Building B) — `auth.users` + `auth.identities` (bcrypt via
`pgcrypto`'s `crypt()`, matching the existing seed's shape) + `persons` +
`role_grants`. Credentials were appended to
`.env.staging-credentials.local` (gitignored, never printed to chat).

Every row `attack-round2.mjs` itself creates is tagged `SECTEST2-` in a
human-visible text column (ticket titles, document filenames, announcement
titles, email `board_note`, import filenames, journal-entry memos, the one
vendor it creates when the seed has none) so `scripts/security/cleanup-round2.sql`
can find and remove them by inspection, independent of ids. That script
must run **as `postgres`** via the Supabase MCP `execute_sql` tool, not
through PostgREST: `role_grants` has no `DELETE` policy for any role (same
trap round 1's README documents for `role_grants`/`unit_owners`), and this
round found the **same shape of trap on two more tables**, `ticket_events`
and `ticket_board_details` — neither has a `DELETE` policy for any
application role either, confirmed via `pg_policies`. That means the
harness's own best-effort in-run cleanup (section "Best-effort in-run
cleanup" in `attack-round2.mjs`) can delete a `SECTEST2-` ticket's
`ticket_comments`/`ticket_bids`/`document_links` but **can never delete the
ticket itself**, because every ticket has a `ticket_events` row from its own
creation trigger and the parent delete fails on that FK with no app-level
way to clear it first. `cleanup-round2.sql` (run as `postgres`, which
bypasses RLS) is therefore not just the "authoritative" cleanup but the
*only* one that can fully succeed for tickets — this was caught mid-run
(two stray `SECTEST2-` tickets accumulated across early runs before the fix)
and is now stated plainly in both files so a future extension doesn't
rediscover it the hard way.

The two posted journal entries `attack-round2.mjs` creates when a building
has no posted entries at all (`SECTEST2-r2-fixture-A`/`-B`, section 9) are
**not deletable by design** — `journal_entries`/`journal_lines` are
immutable to everyone, including `postgres`, once posted (0003's
`tg_entry_immutable`/`tg_line_immutable`). The Building A fixture is
reversed and then its reversal is itself reversed as part of the
double-reversal check, netting to zero; the Building B fixture is left
posted and unreversed on purpose (so "admin A reverses Building B's entry"
has a real row to be refused against) and nets to a single $0.01
debit/credit pair with no further effect. `cleanup-round2.sql` documents
this and gives the one-line `reverse_journal_entry` call to clear it by
hand if the branch is ever kept past this test.

**Verified counts after cleanup** (via the Supabase MCP `execute_sql` tool):
`leftover_persons`, `leftover_users`, `leftover_grants`, `leftover_tickets`,
`leftover_documents`, `leftover_announcements`, `leftover_imports`,
`leftover_email`, `leftover_vendors` all **0**. The branch should still be
deleted after this test per `docs/security/STAGING.md`, which also clears
the two immutable fixture journal entries along with everything else.
