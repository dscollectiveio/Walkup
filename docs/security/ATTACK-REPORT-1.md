# Attack report 1 — RLS/PostgREST/RPC/Storage, `security-test` branch

**Target:** Supabase branch `security-test`, ref `brwauxmdjgfrdqfbgezg`
(https://brwauxmdjgfrdqfbgezg.supabase.co), parented off production
(`oeqgtakyhtauldaebwcn`). Schema = migrations 0001–0050, i.e. **the same
schema production runs today** (`docs/security/STAGING.md`). Seed: Staging
Building A (Admin A = `board_admin`, Owner A = `owner`), Staging Building B
(Admin B = `board_admin`), no real data.

**Method:** `scripts/security/attack-rls.mjs`, a reusable Node harness that
signs in each test account over the real Auth REST API, enrolls and verifies
a throwaway TOTP factor to reach AAL2 (computing the code itself,
RFC 6238/node:crypto — no human, no authenticator app), and then attacks
PostgREST, RPC, and Storage exactly like a hostile client, as anon, AAL1
(password-only), and AAL2, across every table in `public`. 135 checks, 130
`PASS`, 5 `FAIL` — all five are real findings below, not test flakiness. See
`scripts/security/README.md` for how to re-run it and a worked example of a
test-pollution trap (a cleanup step on a table with no DELETE policy) that
briefly produced false-positive leaks during this run before being caught
and fixed in the harness.

**Production impact — read this first.** Findings 1 and 2 are both
reproducible on the schema production runs **today** (0001–0050). Finding 1
in particular lets **any signed-in Walkup user, in any association,** read
every other association's shared-area maintenance tickets and all comments
on all tickets system-wide — no relationship to the victim association is
required. This is live on production right now, not just on staging.

## Summary

| # | Check | Result | Severity |
|---|---|---|---|
| 1 | Shared-area tickets readable cross-tenant by any signed-in user | **FAIL** (known finding, confirmed) | **High** |
| 2 | Ticket comments readable cross-tenant by any signed-in user, on *any* ticket (not just shared ones) | **FAIL** (known finding, confirmed — broader than reported) | **High** |
| 3 | A member of one building can insert a comment onto another building's ticket | **FAIL** (known finding, confirmed) | **High** |
| 4 | `role_grants` insert has no check that `person_id`'s own association matches the grant's association | **FAIL** (new finding) | Medium |
| 5 | `unit_owners` insert has no check that `unit_id`'s own association matches the row's association | **FAIL** (new finding) | Low–Medium |
| — | Anonymous / AAL1 (password-only) access to any financial table | PASS | — |
| — | AAL1 accepted gap: a user can read/edit their own contact info without MFA | PASS (DECISIONS #26, already accepted, not new) | — |
| — | Cross-building read, every `public.*` table with `association_id` (both directions) | PASS | — |
| — | Owner reads any board-only table (vendors, insurance, bank feed, audit_log, journal, documents, role_grants/persons of others) | PASS | — |
| — | Cross-building insert/update(`SET association_id=`)/delete on config and financial tables | PASS | — |
| — | `role_grants` self-promotion (owner and board_member → board_admin) | PASS | — |
| — | `board_member` delete where only `board_admin` may | PASS | — |
| — | `get_bank_access_token` / `reseal_bank_access_token` cross-tenant | PASS | — |
| — | `redact_person`, `record_access_review` cross-tenant | PASS | — |
| — | `create_association_and_owner` reuse by an account that already belongs to a building | PASS | — |
| — | Anonymous calling `has_role_in`/`is_board`/`can_read_financials`/`is_member` | PASS (rejected) | — |
| — | `join_state_waitlist` anon-callable | PASS (by design, DECISIONS #34) | — |
| — | `platform_admins` / `insurance_partners` / `tax_form_templates` writes by a non-platform-admin | PASS (rejected) | — |
| — | `platform_admins` readable through the API | PASS (table has no policies at all; always empty via PostgREST) | — |
| — | `auth`/`storage` schemas reachable via PostgREST `Accept-Profile` | PASS (rejected, 406) | — |
| — | Reporting views (`fund_cash_balances`, `insurance_year_over_year`, `budget_vs_actual`, etc.) leaking cross-tenant | PASS (all `security_invoker`, correctly scoped) | — |
| — | Storage `documents` bucket: cross-tenant download/list/sign/upload/delete, owner reading a board-only doc, anon | PASS | — |

## Findings

### 1. Any signed-in user can read every association's shared-area tickets — High

**Where:** `tickets_select` policy, migration `0013_operations.sql`:

```sql
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id is null
    or unit_id in (select public.owned_unit_ids(association_id))
  );
```

The second branch, `unit_id is null`, is unconditional — it has no
`is_member(association_id)` check at all. A ticket with no unit (a shared
common-area problem — "the roof leaking is everyone's business") is
readable by **any authenticated user in the system**, not just members of
that association.

**Reproduction:** as Owner A (a real member of Building A, with no role in
Building B), `GET /rest/v1/tickets?id=eq.<Building B's shared ticket id>`
with an AAL2 bearer token returns the row (status 200, 1 row). Confirmed in
`attack-rls.mjs` section 7; the harness seeds its own disposable shared
ticket in Building B through the legitimate `tickets_insert` path (as
Admin B) to avoid touching any real data.

**Impact:** ticket title, description, priority, status, estimated cost, and
(once assigned) which contractor is handling it leak across every
association using Walkup, to anyone with an account anywhere in the system.

**Fix:** already written, unreleased — migration `0053_repairs_v2.sql`
replaces this with `ticket_visible_to_caller(association_id, unit_id)`,
which requires `is_member(p_association_id)` for the shared-ticket branch:

```sql
select public.can_read_financials(p_association_id)
    or (p_unit_id is null and public.is_member(p_association_id))
    or (p_unit_id is not null and p_unit_id in (select public.owned_unit_ids(p_association_id)))
```

**Status: NOT fixed in the deployed schema (0001–0050, same as production
today). Fixed by unreleased `0053_repairs_v2.sql`.**

---

### 2. Ticket comments are readable cross-tenant on *any* ticket, not only shared ones — High

**Where:** `ticket_comments_select`, migration `0013_operations.sql`:

```sql
create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_id));
```

This has no predicate beyond "a ticket with this id exists" — not even
finding 1's `unit_id is null` condition. It is broader than the task's
description of this bug: it leaks comments on **unit-specific** tickets too
(an owner's private maintenance issue), not only shared-area ones.

**Reproduction:** Owner A reads `GET /rest/v1/ticket_comments?id=eq.<comment
on Building B's ticket>` and gets the row back. Confirmed in the same
harness run as finding 1, using the comment Admin B legitimately posted on
the seeded fixture ticket.

**Impact:** same as finding 1, extended to comment text, which in practice
carries more identifying/sensitive detail than the ticket row itself (who
said what, access notes, etc.).

**Fix:** `0053_repairs_v2.sql` replaces the policy with one that requires
either board membership or that the comment is non-internal **and** on a
ticket actually visible to the caller via `ticket_association_id(ticket_id)
= association_id` (which is non-null only when `ticket_visible_to_caller()`
is true) — closing finding 1 and this one together.

**Status: NOT fixed in the deployed schema. Fixed by unreleased
`0053_repairs_v2.sql`.**

---

### 3. A member of one building can insert a comment onto another building's ticket — High

**Where:** `ticket_comments_insert`, migration `0013_operations.sql`:

```sql
create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.is_member(association_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );
```

`association_id` here is whatever the client sends, checked against the
*caller's* membership — never against the actual association of the
referenced `ticket_id`. A member of Building A can insert a row with
`association_id = A` (passing `is_member(A)`) and `ticket_id` pointing at a
ticket that actually belongs to Building B.

**Reproduction:** Owner A inserts
`{ association_id: A, ticket_id: <Building B's ticket>, body: "..." }` into
`ticket_comments`; the insert succeeds (201). Admin B (Building B's real
board) can then see the injected row through the ordinary, correctly-scoped
`is_board()` branch of `ticket_comments_select` — confirmed in the harness.
Chained with findings 1–2, discovering a victim ticket id requires no
special access to begin with.

**Impact:** text attributed to an outsider can be planted into another
association's ticket thread, visible to that board, without authorization —
confusion, harassment, or social-engineering risk ("the contractor said
they'd come Tuesday" posted by a stranger).

**Fix:** `0053_repairs_v2.sql` requires
`public.ticket_association_id(ticket_id) = association_id` in the insert's
`with check`, which fails unless the comment's own association matches the
ticket's real one.

**Status: NOT fixed in the deployed schema. Fixed by unreleased
`0053_repairs_v2.sql`.**

---

### 4. `role_grants` insert has no check that the granted person belongs to the association being granted — Medium

**Where:** `role_grants_insert`, migration `0002_rls.sql`:

```sql
create policy role_grants_insert on public.role_grants
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
```

This checks only that the *caller* is `board_admin` of the association named
in the new row's `association_id` column. It never checks that `person_id`
(a foreign key into `persons`, which itself carries `association_id`)
actually belongs to that same association. `role_grants` also has no
DELETE policy for any role (grants are revoked via `revoked_at`, never
removed), and this harness's own cleanup step tripped over exactly that
during this engagement — see `scripts/security/README.md`'s "trap" section.

**Reproduction:** Admin A (board_admin of Building A) inserts
`{ association_id: A, person_id: <Admin B's person row, which lives in
Building B>, role: 'board_member' }` into `role_grants`. The insert succeeds
(201). From that moment, `has_role_in(A, …)` is true for Admin B's login —
confirmed directly at the database level (not just over HTTP) by setting
`request.jwt.claims` to Admin B's `sub` and `aal2` and calling
`public.is_member('<A>'::uuid)`, which returned `true`. Self-promotion by a
*lower-privileged* caller (owner, or a role granted `board_member` only) was
tested and correctly **rejected** — this finding requires the caller to
already be `board_admin` of some association; what's missing is a check
that the *target* belongs to it too.

**Impact:** a board_admin of Building A can unilaterally grant a role
scoped to Building A to **any other Walkup login in the system**, without
that person's consent, if they can learn the target's `person_id` (a UUID,
not normally exposed across associations — `persons_select` is correctly
scoped — which limits but doesn't eliminate exploitability; a `person_id`
can leak through other channels, e.g. being referenced in `audit_log` rows
the target's own board can see, or through finding 1–3's broader read
surface in the Repairs area before 0053). The practical blast radius today
is bounded by how a `person_id` would leak, but the missing invariant is
real and should not depend on that.

**Fix:** add a same-association guard, the same shape as `0041`'s
`tg_insurance_same_association()`:

```sql
create or replace function public.tg_role_grants_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select association_id from public.persons where id = new.person_id) <> new.association_id then
    raise exception 'role_grants.person_id must belong to the same association'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger role_grants_same_association
  before insert or update on public.role_grants
  for each row execute function public.tg_role_grants_same_association();
```

**Status: NOT addressed by 0051/0052/0053 (unrelated areas). This is a gap
in the deployed schema and in production today**, bounded by `person_id`
discoverability as noted above.

---

### 5. `unit_owners` insert has no check that `unit_id` belongs to the row's own association — Low–Medium

**Where:** `unit_owners_insert`, migration `0002_rls.sql`:

```sql
create policy unit_owners_insert on public.unit_owners
  for insert to authenticated
  with check (public.is_board(association_id));
```

Same shape as finding 4: `unit_id` is a foreign key into `units`, which
itself carries `association_id`, and nothing checks the two match.

**Reproduction:** Admin A inserts `{ association_id: A, unit_id: <a unit
that belongs to Building B>, person_id: <Owner A's person>, effective_from:
today }` into `unit_owners`. The insert succeeds (201).

**Impact investigated and found contained, not a direct leak today:**
every place `owned_unit_ids(assoc)` is consulted (`assessment_charges`,
`payments`, `tickets_select`, etc.) always calls it with the *row being
tested's own* `association_id`, and `owned_unit_ids(assoc)` itself filters
`unit_owners` rows by `uo.association_id = assoc`. A malicious row with
`association_id = A` and a foreign `unit_id` from B is therefore only ever
returned by `owned_unit_ids(A)`, which is never the function called when
evaluating a Building B row — so this specific injection did not produce a
cross-tenant read through any policy exercised in this suite. It remains a
genuine data-integrity bug (a dangling, inconsistent mapping) and the exact
shape DECISIONS #17 already warns about generally ("anywhere a join crosses
an RLS boundary... a false zero is worse than a blank") — a future feature
that joins `unit_owners.unit_id` to unit- or association-scoped data without
re-deriving the association from the FK could reopen this as a real leak.

**Fix:** the same guard-trigger pattern as finding 4, checking
`(select association_id from public.units where id = new.unit_id) =
new.association_id`.

**Status: NOT addressed by 0051/0052/0053. Present in production's schema
today; no confirmed exploitable read/write path found during this
engagement, but recommended as defense-in-depth before it is relied on
elsewhere.**

## Notes on things that are fine, verified rather than assumed

- **DECISIONS #26's accepted AAL1 gap** (a user may read/update their own
  `persons` row at AAL1, never financial data) is present exactly as
  documented — not a new finding, re-confirmed by this suite.
- **Storage (`documents` bucket):** cross-building download, list, signed
  URL minting, upload, and delete all correctly denied; an owner cannot
  download a `board_only` document even inside her own building; anonymous
  cannot download anything. (An earlier pass of this suite appeared to show
  a severe storage leak; it was test pollution from this harness's own
  finding-4 fixture not being cleaned up correctly — see the README. Once
  fixed, a clean re-run showed storage is sound.)
- **`platform_admins`, `insurance_partners`, `tax_form_templates`:** writes
  by a non-platform-admin board_admin correctly rejected;
  `platform_admins` itself is unreadable through the API for anyone (no
  policies at all, by design).
- **`get_bank_access_token`, `reseal_bank_access_token`, `redact_person`,
  `record_access_review`:** all correctly reject a cross-tenant caller.
- **`auth`/`storage` schemas** are not reachable via PostgREST's
  `Accept-Profile` header.
- **Reporting views** (`fund_cash_balances`, `insurance_year_over_year`,
  `budget_vs_actual`, `vendor_1099_totals`, etc.) are all
  `security_invoker = true` and correctly scoped — confirmed empty of
  Building B rows when queried as Admin A.

## Branch-provisioning note (not a security finding)

The `security-test` branch's database never ran Supabase's own
project-bootstrap `GRANT ... TO anon, authenticated` statements (applied
once per *project*, outside this repo's migrations — apparently not
re-applied when a branch is created). Every request initially failed with
`42501 permission denied for table X` before RLS was even evaluated, which
would have made every check in this suite pass for the wrong reason. Fixed
once, directly on the branch via the Supabase MCP `execute_sql` tool (never
applied to dev or production):

```sql
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
```

This restores a grant baseline production already has; it changes no RLS
policy. Documented here so a future re-run of this suite against a fresh
branch isn't surprised by the same thing.

## Cleanup

All fixture rows this engagement created on the branch (disposable funds,
vendors, documents, bank connection, tickets/comments, role_grants probes)
were removed — most through the same legitimate API paths used to create
them, the few with no DELETE policy (`tickets`, `ticket_comments`,
`bank_connections`) via direct SQL (`scripts/security/cleanup-fixtures.sql`
documents exactly what and why). Verified the branch's row counts for every
touched table match their pre-engagement state. No change was made to
`docs/security/STAGING.md`'s "no real data" guarantee.
