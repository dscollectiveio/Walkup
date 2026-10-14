# Decision log

Running record of decisions that are settled. Where this conflicts with
`HOA_Manager_Spec.md`, **this file wins** — the spec is preserved as written and
is not edited in place.

Each entry records who decided and when, because "the spec says so" is not
useful six months from now when the reasoning matters.

---

## 1. Tax accounting method: **cash**

**Decided:** Doug, 2026-07-28. **Status:** settled, pending CPA review.

The 1120-H is filed on the cash method. The books remain modified cash —
assessments accrue as receivables, expenses record when paid.

**These are not the same basis, and the difference is material.**

Book income includes assessments charged but not collected. Tax income does
not. Delinquency falls almost entirely on exempt function income, so an unpaid
owner *lowers* the exempt ratio on the tax basis while the books look healthy.
In a four-unit building one delinquent owner is 25% of assessment income, which
is enough to move the 60% test.

Consequences:

- The tax module reads cash movements, never the income statement (see #3).
- A **book-to-tax reconciliation report** is required. It is not in the
  original spec.
- **Prepayments are taxable income in the year received.** An owner paying next
  year up front creates a book liability (account 2100) and current-year tax
  income. This is a reconciling item.
- Timing affects the *ratio*, not the tax due — assessments are exempt function
  income and excluded from taxable income either way. But failing the 60% test
  forfeits the §528 election entirely, so the ratio is what matters.

**Top item for CPA review.** The entire tax module rests on this.

---

## 2. Capital expenditures: expensed if minor, capitalized otherwise

**Decided:** Doug, 2026-07-28. **Status:** settled; threshold is a default.

Threshold defaults to **$2,500**, stored per association and editable
(`associations.capitalization_threshold`). That figure is the IRS de minimis
safe harbor for taxpayers without an applicable financial statement,
Treas. Reg. §1.263(a)-1(f) — a defensible number rather than an invented one.

The 90% test counts expenditures for acquisition, construction, management,
maintenance and care of association property. **Capital expenditures count in
the numerator whether or not they were booked as an expense.** So the
capitalize/expense choice changes the balance sheet and the income statement
but must not change the 90% test.

The original seed chart of accounts put `5080 Capital Improvements` in as an
expense, which made the 90% test convenient and the income statement wrong — a
roof replacement would have shown as a catastrophic operating loss. Superseded
by this decision plus #3.

Depreciation is **not** being built. Under 1120-H it is only relevant if
allocable to non-exempt income production, which for a building this size is
almost certainly immaterial. On the CPA list, not decided here.

---

## 3. Both 1120-H tests read cash movements, not account balances

**Decided:** Claude, 2026-07-28, as a consequence of #1 and #2. **Status:** settled.

- **60% income test** — debits to cash accounts, classified by the credit leg
- **90% expenditure test** — credits to cash accounts, classified by the debit leg

Every cash receipt and disbursement, classified by whatever the other leg of
the entry hits. This handles assessments, reserve interest, laundry income,
ordinary repairs and capitalized roofs uniformly; it is correct whether an
outlay was expensed or capitalized; and it is correct on the cash basis by
construction.

Schema cost: one flag, `accounts.is_cash_account`. No new tables.

---

## 4. Vendor TINs: last four digits only

**Decided:** Claude, 2026-07-28. **Status:** settled unless challenged.

The original schema said "store full TIN encrypted, out of band" — right
instinct, no mechanism. For a sole proprietor the TIN *is* a Social Security
number.

Store `tin_last4` plus the W-9 PDF in Storage. 1099-NEC is filed once a year by
a human who can read the number off the W-9. Storing full TINs buys nothing
operationally and creates a serious breach liability for a product whose
customers are four people in a condo building.

---

## 5. All ledger writes go through a SECURITY DEFINER RPC

**Decided:** Claude, 2026-07-28. **Status:** settled — architectural.

Journal entry balance is enforced by a `DEFERRED` constraint trigger, which
fires at commit. **PostgREST runs every request in its own transaction**, so
inserting an entry and then its lines as two client calls fails every time: the
entry commits alone and unbalanced.

Therefore `post_journal_entry(header, lines[])` is the only write path into the
ledger. Nothing inserts into `journal_entries` or `journal_lines` directly.

This makes "no unbalanced entries" and "no business logic in the client" the
same decision, and it means the RPC is the foundation everything else sits on.
It is built before any screen exists.

---

## 6. Identity: `persons` + `role_grants`, not `owners` + `memberships`

**Decided:** Claude, 2026-07-28. **Status:** settled.

In a self-managed 2–6 unit building **every board member is also an owner** —
that is the premise of the product. The original schema's
`unique (association_id, auth_user_id)` on `memberships`, with a single `role`
column, made that unrepresentable.

It also kept `owners.auth_user_id` and `memberships.auth_user_id` as two
independent sources of truth for "which login is this person," with nothing
keeping them in sync.

One `persons` row per human per association. Roles are grants; a person may
hold several. RLS helpers therefore ask "does this person hold *any* role
permitting this," which is the correct shape regardless.

---

## 7. Ownership percentages are amendments, not effective-dated rows

**Decided:** Claude, 2026-07-28. **Status:** settled.

Storing one row per (unit, percentage, date range) makes "percentages sum to
exactly 100% per association per date" a constraint over every date in the
union of all interval boundaries — hard to write, worse to debug.

One amendment carries one effective date and a complete set of lines covering
every unit. The constraint becomes "lines sum to 100 within the amendment."
Slice 5's §22.1 resale packet gets the amendment history for free.

---

## 8. `ON DELETE RESTRICT`, and associations are soft-deleted

**Decided:** Claude, 2026-07-28. **Status:** settled.

The original schema cascaded from `associations` to everything. One DELETE
would have destroyed an entire ledger, contradicting the immutability and audit
invariants. Financial FKs are RESTRICT; associations carry `deleted_at`.

An accounting system should make destroying history difficult by construction.

---

## 9. Posted entries are immutable immediately, not at period close

**Decided:** Claude, 2026-07-28. **Status:** settled — stricter than the spec.

The spec required closed *periods* to be immutable. That leaves a months-long
window in which a posted entry can be edited and the audit log is the only
record it happened.

An entry is a draft until posted. Once posted it cannot be updated or deleted;
corrections are reversing entries. Closed-period enforcement remains, as a
second layer.

---

## 10. Pricing: flat annual, provisional

**Decided:** Doug (deferred), Claude default, 2026-07-28. **Status:** provisional.

No seat counting, no feature gating built. The only pricing model that would
change Slice 1 is a tax-season paywall, which needs gating woven in from day
one. Revisit before launch, not before Slice 2.

---

## 11. Multi-association in the data model, single-association UI

**Decided:** Claude, 2026-07-28. **Status:** settled for Slice 1.

The schema already supports one person across several associations. No
association-switcher UI in Slice 1. Adding one later is a UI change, not a
migration.

---

## 12. 2158 N. Damen is a test fixture

**Decided:** Doug, 2026-07-28. **Status:** settled.

No real financial data goes in during Slice 1. This unblocks sequencing but
does **not** move the RLS, audit or immutability work — those are cheap now and
the whole build order rests on them.

The fixture should be deliberately awkward, because that is what exercises the
tests:

- one delinquent owner
- reserve interest (non-exempt income inside a restricted fund)
- one capital item above the threshold
- a mid-year ownership change

---

## 13. Operating fund bears the tax on reserve interest

**Decided:** Doug, 2026-07-28. **Status:** settled.

Reserve interest is non-exempt income earned inside a restricted fund, but the
income tax on it is paid from operating.

That requires an **explicit inter-fund journal entry** — never an implicit
one — and it is the single most common real transaction that touches both funds
and the tax computation. It gets a test case.

Note `5900 Income Tax Expense` is a **non-exempt** expenditure. Paying the tax
therefore hurts the 90% ratio slightly. That is correct and unavoidable, but it
means an association with substantial reserve interest sees its 90% headroom
shrink as a direct consequence of earning that interest.

---

## 14. Bad debt is contra-income, not bad-debt expense

**Decided:** Doug, 2026-07-28. **Status:** settled.

Writing off an uncollectible assessment reverses the book receivable and the
book income. It does not create an expense.

**Under the cash method this has no tax effect at all.** The uncollected
assessment was never tax income (DECISIONS #1), so writing it off changes
nothing on the return — no income to reverse, no expenditure to add. It is
purely a book entry.

That is also why contra-income is the right choice: booking a bad-debt
*expense* would have added a non-exempt expenditure to the 90% denominator and
depressed the ratio for what is, on the tax basis, a non-event.

---

## 15. Local-first development. No cloud project, no domain.

**Decided:** Doug, 2026-07-28. **Status:** settled for now.

No Supabase cloud project, no Vercel project, no domain. Development runs
against **PGlite** — real Postgres compiled to WASM, in-process, driven from
Vitest (`tests/db/harness.ts`).

This machine has no Docker and no Homebrew, so `supabase start` is unavailable
without an admin install. PGlite needs neither.

**What this proves:** DDL, constraints, triggers, exclusion constraints, and
RLS policies. It is real Postgres with the real planner and the real RLS
engine, so a policy that passes here behaves the same in production.

**What it does not prove:**

- PostgREST behaviour, including the one-transaction-per-request property that
  forces DECISIONS #5. That has to be confirmed against a real project.
- Supabase Auth. `auth.users` and `auth.uid()` are stubs in the harness — good
  enough for policies to compile and run, nothing more.
- Storage, edge functions, connection pooling, extension availability parity.

Before any real data exists, the schema must also be applied to an actual
Supabase project and the RLS suite re-run there.

---

## Still open

| # | Question | Blocks |
|---|---|---|
| A | CPA review of the cash-method treatment and the 60%/90% computations | Filing anything, not building |
| D | Domain name | Deploy only; deferred by #15 |
| E | Additional launch states beyond Illinois | Slice 4 only |

---

## 16. The app runs against PGlite over a Postgres socket

**Decided:** Claude, 2026-07-29, extending #15. **Status:** settled for local work.

`npm run dev:db` serves PGlite on the Postgres wire protocol at
`127.0.0.1:5433`; the Next server connects with node-postgres. Every query runs
as `authenticated` with `request.jwt.claim.sub` set, so the 0002 policies apply
to the UI exactly as they will in production. There is no privileged path in
the app — a page that forgets to scope a query is still stopped by the
database.

Two constraints worth knowing:

- **The pool must be size 1.** PGlite serves one connection at a time; a larger
  pool resets the socket mid-query. `DATABASE_POOL_MAX` raises it for Supabase.
- **Identity is a cookie** (`src/lib/session.ts`). Not an auth system. It exists
  so the policies can be exercised through the UI and must not survive contact
  with a real deployment.

---

## 17. `units` is readable by all members and is NOT an access check

**Decided:** Claude, 2026-07-29, after a leak found by testing the UI. **Status:** settled.

The owner statement page originally gated on `select from units`. Because
`units` is a configuration table readable by every member — deliberately; an
owner knows their building has three units — navigating directly to a
neighbour's unit URL rendered a real statement shell, titled with that unit,
showing a confident `$0.00` balance.

The financial rows were correctly empty. The page still should not have
rendered.

**How to apply:** gate on `unit_owners`, which carries the correct policy —
board and accountant see every row, an owner sees only their own. An empty
result is then indistinguishable from "does not exist", which is the point:
leaking "this unit exists but is not yours" is still a leak.

The same class of bug produced a fabricated `$0.00` on the overview page.
Anywhere a `LEFT JOIN` crosses an RLS boundary, absence must render as
"not visible to you" and never as zero. **A false zero is worse than a blank.**

---

## 18. supabase-js replaces node-postgres; #15 and #16 are superseded

**Decided:** Doug, 2026-07-29. **Status:** settled.

The app talks to Supabase over PostgREST with the publishable key, using
`@supabase/ssr`. Real Supabase Auth; the dev-cookie identity from #16 is gone,
along with `src/lib/db.ts`, `src/lib/session.ts`, the `pg` dependency and the
PGlite socket server.

**There is no service-role client anywhere in this codebase, deliberately.** The
service role bypasses RLS entirely, and the policies in 0002 exist precisely so
authorization does not depend on application code remembering to scope a query.
Anything that genuinely needs to bypass RLS should be a `SECURITY DEFINER`
function with its own authorization check — the pattern `post_journal_entry`
already uses — not a privileged client.

Two consequences worth knowing:

- **PostgREST cannot express GROUP BY**, so every aggregate moved into views
  (0008). That is a better home for them anyway: versioned, reviewable, and
  identical for every caller.
- **A `SUM` over zero RLS-visible rows returns 0.** Every aggregate view that
  can be filtered therefore also exposes a `COUNT`, so the UI can distinguish
  "nothing owed" from "not yours to see" (DECISIONS #17).

Offline development against PGlite is no longer possible for the *app*. The
test suite still runs entirely offline against PGlite, so migrations, triggers
and policies remain testable with no network. That was the part worth keeping.

Verified over real HTTP with the anon key: every table returns `[]`,
`post_journal_entry` returns `42501 permission denied`, and `tg_audit` returns
404 — it is no longer part of the API surface at all.

**Still unverified:** the claim in #5 that PostgREST runs each request in its
own transaction, which is the entire justification for the RPC. Proving it needs
an authenticated post over HTTP.

---

## 19. Development sign-in: a real account, not an auth bypass

**Decided:** Doug, 2026-07-30. **Status:** temporary — remove before real data.

`/login` shows a one-click "Sign in as dev user" button in development. It
performs a real Supabase password sign-in as `walkup-dev@dscollective.io` and
receives an ordinary JWT, so `auth.uid()` is populated and every policy in 0002
applies exactly as it does to any other user.

**It is deliberately not a bypass.** Faking a session, or reading with the
service role, would make every page appear to work while testing nothing — RLS
is the only thing standing between one owner and a neighbour's balance, so a
development shortcut that skips it would hide the single class of bug that
matters most here.

Gated on two independent conditions, both required: `NODE_ENV !== "production"`
and both `DEV_AUTH_*` variables present. Neither holds on Vercel. The variables
are deliberately absent from `.env.local.example` so they cannot be copied into
a deployment by habit.

The account is separate from Doug's own login and holds `board_admin` plus
`owner` on Unit 3. **Delete it, and its person and role_grant rows, before any
real financial data exists.**

---

## 20. Money must cross the API boundary as text

**Decided:** Claude, 2026-07-30, after the tax page crashed. **Status:** settled — invariant.

**PostgREST serializes `NUMERIC` to a JSON number**, which is an IEEE 754
double. `node-postgres` returns `NUMERIC` as a string. So moving to supabase-js
silently routed every money value through a float — the exact failure mode
`NUMERIC(14,2)` exists to prevent.

It surfaced as a crash rather than a rounding error only because `toCents()`
refuses anything that is not a plain decimal string. Had that function been
more permissive, this would have been a quiet loss of precision inside a tax
computation, which is the worst place for one.

**How to apply:** any money column feeding arithmetic is cast `::text` in SQL
before it crosses the API boundary — see `form_1120h_figures` in 0011.
`toCents()` throws a specific error naming this cause if it ever receives a
number again, and a regression test asserts that.

Display-only money is still read as a JSON number and formatted with
`Intl.NumberFormat`, which is acceptable: nothing is computed from it. Anything
that feeds a total, a ratio or a tax figure is not.

---

## 21. PGlite does not model deferred-trigger privileges. Verify writes against Supabase.

**Decided:** Claude, 2026-07-30, after shipping a broken ledger. **Status:** settled — process rule.

Migration 0007 revoked `EXECUTE` on `check_entry_balanced` from `authenticated`,
on the reasoning that Postgres does not check `EXECUTE` when a trigger fires.
That is true of the *trigger function*. It is not true of a function the
trigger body then calls: that is an ordinary, privilege-checked call, made as
the current user, which at commit time is `authenticated`.

**Every ledger write by a signed-in user failed with `42501`. It reached the
live project.** The local suite stayed green — PGlite ran the identical post,
with the identical privileges, successfully.

**How to apply:**

- The test harness is trustworthy for DDL, constraints, RLS policies and
  trigger *logic*. It is **not** trustworthy for privilege resolution inside
  deferred triggers.
- Any migration that changes `GRANT`/`REVOKE` must be exercised against
  Supabase over HTTP with a real JWT before it is considered done. Green tests
  are not sufficient evidence for that class of change.
- Prefer a static assertion where possible: `migrations.test.ts` now asserts
  `has_function_privilege('authenticated', ...)` for every function the
  deferred triggers call. A static check survives the harness's runtime
  differences.

Fixed in 0012. DECISIONS #5 is now verified end to end over PostgREST: a
balanced post returns a uuid, an unbalanced post is rejected at commit with
`debits 10.00, credits 9.00, difference 1.00`, and nothing is left behind.

---

## 22. Operations layer: three deliberate limits

**Decided:** Doug asked for these; Claude narrowed three. 2026-07-30. **Status:** settled.

Maintenance tickets, contractor profiles, recurring bills, insurance tracking
and document storage are built (0013). Three of the requests were narrowed
rather than delivered as asked, and the schema comments say so at the point of
use:

**No payment initiation.** `recurring_bills` records what is due and whether
autopay is already arranged *at the utility or the bank*. Walkup does not store
banking credentials and never moves money. For a four-unit association that is
the safer arrangement — no software holding the association's credentials, and
no single point of failure if a volunteer's account is compromised. Real ACH
would need a provider, NACHA obligations, and a much larger trust surface than
this product has earned.

**No automatic sending.** `contractor_messages` holds drafts; a person approves
and sends each one, from their own mailbox via `mailto:`. The database refuses
a row marked `sent` without an approver. An association that accidentally
emails a contractor something reading like an authorisation to begin work has a
real problem, and the volunteer doing this at 10pm is exactly who would not
notice. Sending from the board's own mailbox also means the contractor's reply
reaches a human.

**No brokering.** `insurance_quotes` records what carriers offered so renewals
can be compared year on year, and flags when no alternative quotes were
obtained. Advising on or placing insurance is a licensed activity. The page
says so.

---

## 23. Anything computing an aggregate must be SECURITY DEFINER

**Decided:** Claude, 2026-07-30, after the third instance. **Status:** settled — invariant.

`tg_ticket_reference` computed `max(reference) + 1` as SECURITY INVOKER, so the
SELECT inside it ran under RLS. An owner sees shared-area tickets and their
own, not a neighbour's — so with tickets 1 (shared), 2 (Ada's) and 3 (Bo's),
Ada's view stopped at 2 and reporting a problem assigned her number 3, which
collided.

The failure mode is what makes it worth an entry: the more private data a
building accumulates, the more often an owner simply cannot report a problem,
failing on a unique constraint that says nothing about why.

This is the third instance of one shape — logic assuming it can see every row,
running under RLS that cannot (see #17 and #21).

**How to apply:** any function computing a maximum, count, sum or sequence
across a table must be `SECURITY DEFINER` with a pinned `search_path`, or it
silently means something different for each caller. Trigger functions that only
touch `NEW`/`OLD` are unaffected.

---

## 24. Bank feed (Plaid): read-only, extending #22

**Decided:** Doug, 2026-08-01. **Status:** settled.

Doug asked to link a BMO account so transactions show up in Walkup and bills
can autopay. The second half is declined — #22 already ruled out payment
initiation, and nothing about this request changes that reasoning. Autopay
means holding a live credential that can move the association's money, which
is exactly the single point of failure #22 was written to avoid for a
building this size.

The first half is a different risk profile and is built (0016): a Plaid
connection that can only read transactions, shown alongside the books on
their own page, never posted into the ledger. A board member still records
payments and bills the existing way. If auto-matching or draft-entry import
is wanted later, that is a new decision, not an extension of this one — it
changes what can silently enter a tax-relevant ledger, which #1 and #20 both
care about.

**How to apply:**

- The Plaid access token is a live credential, worse than a password since it
  doesn't expire on its own. It lives in `bank_connection_secrets`, RLS
  enabled with zero policies — not even board_admin can `SELECT` it through
  PostgREST. The only access path is `store_bank_connection()` and
  `get_bank_access_token()`, both `SECURITY DEFINER`, same shape as
  `post_journal_entry()` (#5).
- That table is deliberately **not** on `tg_audit()`'s list. The trigger
  serializes the whole row to JSONB into `audit_log`, which board_admin can
  read — auditing the secrets table would leak the token into a place it was
  just fenced out of.
- Plaid reports transaction amounts positive-out. Everything else in this app
  reads positive-in (Moss/good), so the sign is flipped once at the sync
  boundary (`bank_transactions.amount`) rather than leaving every future
  reader to remember Plaid's convention.
- Connecting, syncing and disconnecting are board_admin only — not
  board_member. Viewing the resulting feed follows the same audience as the
  ledger (`can_read_financials`).

---

## 25. Document text is redacted before the model, not after
*Decided: Claude, 2026-08-04, while building the document hub. Status: settled — invariant.*

The hub reads text out of uploaded files so they can be searched and filed
automatically. A W-9 is one of the documents a board is told to keep, and for
a sole proprietor the TIN on it **is** a Social Security number.

#4 keeps full TINs out of this database on purpose: `tin_last4` plus the W-9
itself in Storage, and nothing else. Reading text out of that W-9 would have
quietly undone it — the number would have landed in `documents.extracted_text`,
been copied into `audit_log` by the row trigger, sent to a third party in every
classification prompt, and become readable by board_admin forever. None of that
is a decision anyone would have made on purpose; it would have arrived as a
side effect of a search feature.

So redaction happens at the extraction boundary, before the text is used for
anything: before the prompt, before the database, before the search index. The
classifier does not need somebody's SSN to recognise a W-9.

**How to apply:**

- `redactTaxIds()` runs inside `extractDocumentText()`, not in its callers.
  There is no code path that returns un-redacted text, so no future caller can
  forget.
- It is deliberately over-inclusive: a bare nine-digit run is redacted even
  though it is sometimes a reference number. A slightly worse search index and
  one leaked SSN are not the same size of mistake.
- `documents` is audited by `tg_audit_document()` (0019), which strips
  `extracted_text` and `extraction` before writing to `audit_log` — belt as
  well as braces, and it also stops the log becoming a second copy of every
  document.
- The same reasoning applies to anything added later that reads file contents:
  export bundles, share links, email intake. Redaction belongs at the point the
  bytes become text, once.

---

## 26. MFA is required for every Walkup user, enforced at the database

*Decided: Doug, 2026-08-05, answering Plaid's production security
questionnaire. Status: settled.*

Plaid's review asks whether MFA is in place before a consumer can reach Plaid
Link. Walkup had none — password-only login via Supabase Auth, no second
factor anywhere. Rather than answer "no" or, worse, "yes" without it existing,
this makes it real: TOTP-based MFA (authenticator app), required for every
signed-in user, not only board_admin. Scope was Doug's call — the narrower
option (board_admin/accountant only, since only they reach Plaid Link) was
available and rejected in favor of a single enforcement point with no
role-based branching to get wrong.

A UI redirect alone would not have been a security control, only a
suggestion — anyone with a password-only (AAL1) session could still call
PostgREST directly and skip it. So enforcement is in two places doing two
different jobs:

- `src/proxy.ts` / `src/lib/supabase/proxy.ts` — routes a signed-in user to
  `/account/mfa` (no verified factor yet) or `/login/mfa-challenge` (factor
  exists, this session hasn't cleared it) before they reach anything else.
  This is the UX: it is what makes "before Plaid Link is surfaced" true.
- Migration `0025_mfa_enforcement.sql` — the real authorization. One new
  helper, `session_is_aal2()`, reading the `aal` claim off `auth.jwt()`
  exactly the way `auth.uid()` already was. It is wired into the three
  functions nearly every policy already calls — `has_role_in`,
  `owned_unit_ids`, `current_person_id` — rather than edited into every
  policy individually, so it automatically covers `post_journal_entry()` and
  `store_bank_connection()`/`get_bank_access_token()` (0016) along with every
  `can_read_financials`/`is_board`/`is_member` read policy.

**How to apply:**

- New users (and Doug's own account, and the `walkup-dev@dscollective.io`
  dev account) are forced through `/account/mfa` on first sign-in after this
  ships — there is no grace period, per the "everyone" scope decision above.
- **Known, accepted gap:** `persons_select` and `persons_update` (0002) also
  allow `auth_user_id = auth.uid()` directly, for a person reading/editing
  their own contact details. That path does not run through
  `has_role_in`/`owned_unit_ids`/`current_person_id`, so it is reachable at
  AAL1. It exposes only a person's own name/contact info, never financial
  data — judged not worth the added complexity of gating right now, but
  tracked here and in `docs/SECURITY_POLICY.md` rather than left silent.
- `tests/db/harness.ts`'s `asUser()` defaults every test to `aal: "aal2"` so
  existing tests keep asserting role-based access, not MFA state.
  `tests/db/mfa-enforcement.test.ts` tests the gate itself at `aal1`.
- If a future integration needs its own narrower MFA requirement (e.g.
  step-up auth just before a destructive action), that is a new decision —
  this one intentionally does not distinguish "MFA for Plaid" from "MFA for
  everything," on purpose, to keep one enforcement point.

---

## 27. Plaid production readiness: fail-closed environment, real disconnect

*Decided: Doug, 2026-09-08, moving the bank feed from Plaid Sandbox to Plaid
Production ahead of the first live deployment. Status: settled for the code
changes below; the deployment itself (Vercel project, production Supabase
project, Plaid dashboard registration) is tracked outside this file as
operational setup, not a design decision.*

Three problems specific to going live, none of which sandbox ever exercises:

**`PLAID_ENV` had a silent default.** `plaidClient()` fell back to `"sandbox"`
when the variable was unset. A missing env var in a deploy would not fail —
it would quietly connect to sandbox in what everyone believed was production,
which is a worse failure than a crash: Link opens, a token comes back, and
nothing ever touches a real bank. Fixed to throw unconditionally when unset,
in every environment including local dev. Deliberately **not** conditioned on
`NODE_ENV`: `NODE_ENV` is `"production"` for `next build` run locally and for
every Vercel Preview deployment, not only the one that matters, so branching
on it would reintroduce the same class of bug one level up. One rule, no
exceptions, is the only version of this that can't be gotten wrong.

**Disconnecting a bank never told Plaid.** `disconnectBank()` called only
`revoke_bank_connection()`, which deletes the locally-stored access token.
Invisible in sandbox. Against a real account, this would mean the token
needed to remove the Item at Plaid is destroyed *before* Plaid ever hears
about it — `itemRemove()` requires an access token, and this would have just
deleted the only copy. The Item stays live and billable at Plaid forever with
no way left to retire it through the API.

Fixed order: fetch the token, call `itemRemove()`, **then** revoke locally —
revoking always runs regardless of whether Plaid could be reached. This is
deliberately fail-open on the Plaid-side call: a live access token still
sitting in Walkup's own database after a board admin explicitly asked to
disconnect is worse than an Item that's merely still live at Plaid, because
`bank_connections.plaid_item_id` survives forever (rows are never
hard-deleted, per the note in `0016_bank_feed.sql`) and can be removed by
hand in the Plaid dashboard if the API call ever fails. Migration `0026` adds
`plaid_item_removed_at` as the durable, queryable record of which disconnects
still need that manual cleanup — `plaid_item_removed_at is null and status =
'disconnected'` is the whole query.

**OAuth institutions can't complete without changes.** Most large US banks
require an OAuth redirect in production; Plaid Link sends the browser away
and expects to be reopened with the *same* link token plus
`receivedRedirectUri` on return. The connect button minted a fresh token on
every mount, which is the wrong token for that reopen. Fixed with a
dedicated `/bank-feed/oauth` landing route and the link token stashed in
`localStorage` before `open()` — not derived from a fresh `createLinkToken()`
call, and not read from a `?oauth_state_id` query param on `/bank-feed`
itself, so the registered redirect URI can stay query-free the way Plaid
requires.

**`redirect_uri` comes from one explicit env var, never `VERCEL_URL` or a
request header.** Plaid requires exact pre-registration of every redirect
URI. A per-deployment preview URL changes on every push and can never be
registered, so deriving it dynamically would always be wrong for Preview
deployments — better to omit the field there (non-OAuth institutions and
local dev keep working; OAuth institutions fail loudly and specifically at
the bank) than to send a URI that will never match.

**How to apply:**

- `src/lib/plaid.ts` throws naming exactly which variable is missing
  (`PLAID_ENV`, `PLAID_CLIENT_ID`, or `PLAID_SECRET`) rather than sending
  `undefined` into a header and surfacing a confusing error from inside the
  Plaid SDK.
- `disconnectBank()`'s three Plaid outcomes: token already gone (idempotent
  re-click, no Plaid call needed), `itemRemove()` succeeds or the item was
  already removed at Plaid's end (`ITEM_NOT_FOUND` / `INVALID_ACCESS_TOKEN`),
  or an unknown failure — only the last one returns a `warning` alongside
  `ok: true`, never blocking the local disconnect.
- Known, accepted gaps carried forward, not fixed here: no webhook and no
  `ITEM_LOGIN_REQUIRED` re-auth path (a stale connection surfaces only as a
  sync error, not a proactive notice), and `syncBankTransactions()`'s
  unbounded `while (hasMore)` loop could exceed a serverless function's
  timeout against a real account's transaction history.
- `client_user_id` on `linkTokenCreate` is still the association, not a
  person — every board member of a building shares one Plaid-side identity.
  Not addressed here; flagged so it isn't mistaken for an oversight later.

---

## 28. One narrow, explicit exception to "no service-role client anywhere" — the daily bank sync cron

*Decided: Doug, 2026-09-09, adding an unattended daily sync (`src/app/api/cron/sync-bank-feeds/route.ts`)
on top of the manual "Sync now" button. Doug chose this over the alternative
(a Postgres-side job via `pg_cron`/`pg_net`, keeping the service-role key out
of the app entirely) explicitly, after being shown the tradeoff.*

Invariant #18 says no service-role client anywhere in the app, and until now
that has held with zero exceptions — every write goes through RLS or a
SECURITY DEFINER RPC that checks `auth.uid()`. A daily unattended sync breaks
that premise at the root: there is no signed-in board member at noon for
`auth.uid()` to resolve to, so every existing Plaid code path (which reads
the access token via `get_bank_access_token()`, itself gated on
`is_board(auth.uid())`) would simply refuse to run.

The fix is not to weaken that gate — it's to accept that exactly one code
path needs to bypass it, and keep that bypass as small and visible as
possible:

- `SUPABASE_SERVICE_ROLE_KEY` lives in Vercel's env vars again, scoped to
  Production only, and is read by exactly one file:
  `src/app/api/cron/sync-bank-feeds/route.ts`. It is not exported, not
  re-used by any helper another route could import, and the route's own
  header comment says explicitly that nothing else should touch it.
- That route trusts nothing but a shared secret: Vercel Cron sends
  `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is
  set (`vercel.json`'s `crons` entry, `0 18 * * *` — see below for what that
  schedule actually means), and the route 401s on anything else, 500s if
  `CRON_SECRET` isn't configured at all rather than silently accepting
  every request.
- The actual Plaid-calling logic (the `transactionsSync` cursor loop, the
  `bank_transactions` upsert) was extracted into `src/lib/plaid/sync.ts`'s
  `syncOneConnection()` so the cron route and `syncBankTransactions()` (the
  manual button, still running as the real signed-in user) share one tested
  implementation — the cron route differs only in *how* it resolves the
  access token (a direct `bank_connection_secrets` read, since
  `bank_connection_secrets` has zero RLS policies by design and the RPC's
  `is_board()` check would fail under a service-role session anyway) and
  *who* it iterates over (every association's active connections, not one).

**Known caveat, not fixed here:** `vercel.json`'s cron schedule
(`0 18 * * *`) is a fixed UTC time — Vercel Cron does not shift for daylight
saving. 18:00 UTC is genuinely noon Central only during Standard Time
(roughly early Nov–early Mar); for the other ~8 months of the year, while
Central is on Daylight Time, this actually fires at 1pm local, not noon.
Fixing that for real means either updating the cron expression twice a year
or computing the offset at request time and using it to decide whether to
run — neither is implemented; the schedule was set to match "noon CST"
literally, as asked, with this drift called out rather than silently
accepted.

## 29. The bank feed is how entries reach the ledger (supersedes the "never posted" half of #24)

*Decided: Doug, 2026-09-17. Asked directly whether the new Financial
Statements should read the hand-kept ledger or the bank feed, and shown the
difference — the ledger is what a board member types in; the feed is what the
bank says happened — Doug chose: "the transactions from the bank should feed
the ledger. That should be the source of truth. Once the bank is linked, the
transactions should be saved even if the bank is disconnected … and if it is
reconnected, then the transactions should not be double counted."*

#24 built the feed as a read-only cache "shown alongside the books, never
posted into the ledger", and said that if draft-entry import were wanted
later "that is a new decision, not an extension of this one." This is that
decision. What it does NOT change: #1 (the 1120-H is computed from cash
movements), #5 (only SECURITY DEFINER functions write the ledger), #18/#28
(no service-role writes except the one cron read path), the token handling
in #24's own "how to apply" bullets, and the immutability of posted entries.

How a bank transaction becomes a ledger entry (0035 schema, 0036 functions):

- **A row is categorized, then posted, as two separate steps.** The board
  sets `posting_kind` (`expense` / `income` / `dues` / `transfer` /
  `excluded`) plus its target on the `bank_transactions` row itself — a real,
  queryable "ready but not yet in the books" state. `post_bank_transaction()`
  then writes the entry and sets `journal_entry_id` exactly once. A row with
  a `journal_entry_id` cannot be posted again; that column is the whole
  double-posting guard.
- **Posting goes through the existing RPCs wherever a subsidiary table
  exists.** Expenses through `record_expense()` (so `expenses` — which
  `/budget`'s monthly actuals, the dashboard, and the 1099 view read — stays
  correct); dues through `record_payment()` when the unit has an open
  charge (FIFO by due date, so unit balances and delinquency clear). A
  journal-only expense would balance perfectly and still be invisible to the
  budget page. Only non-dues income and cash-to-cash transfers go straight
  to `post_journal_entry()`, because they have no subsidiary table.
- **Dues are cash-basis unless there is something to apply them to.** No
  open charge ⇒ debit cash / credit 4000 Regular Assessments on the day the
  deposit landed, `unit_id` on both lines. This matches #1: the 1120-H reads
  cash movements, and a deposit into a cash account classified by an
  exempt-income credit leg is exactly what the 60% test counts.
- **Transfers stay off the P&L.** A move between the association's own
  accounts posts cash-to-cash with `source = 'transfer'`. That needs the
  other account to exist in the chart as cash; `create_cash_account()`
  (asset, `is_cash_account = true`, 10xx code) exists for "Chase Checking"
  and the like. Every connection carries `cash_account_id` + `fund_id` —
  which ledger account the bank account *is* — defaulting to 1000 Operating
  Cash / Operating fund at connect time.
- **Undo is a reversal, never a deletion.** `unpost_bank_transaction()` posts
  a mirror entry (`source = 'reversal'`, `reverses_entry_id`, same date and
  fiscal year so the pair nets to zero in the period of the mistake), deletes
  the subsidiary `expenses`/`payments` row so budget and balances reflect the
  correction, and clears `journal_entry_id` so the row can be re-categorized.
  The journal keeps both halves forever.
- **Pending never posts.** Plaid replaces a pending transaction with a
  settled one under a new ID; posting the pending one would double-post.
- **Plaid retractions never delete a posted row.** `sync.ts` sets
  `removed_at` instead; a retracted-but-posted row is flagged for the board
  to undo by hand if the bank was right. (Un-posted pending rows being
  replaced by their settled twin are also just marked — nothing is hard
  deleted from `bank_transactions` any more.)
- **Reconnecting adopts, it does not duplicate.** Plaid transaction IDs are
  scoped to an Item; a disconnect/reconnect gives every transaction a new
  ID, and on 2026-09-16 that put all 12 prior BMO transactions into
  production twice. `src/lib/plaid/dedupe.ts` fingerprints on
  `(posted_on, amount, description)`: an incoming row that matches an
  unclaimed row from a *prior* connection re-points that row's
  `plaid_transaction_id` and `bank_connection_id` instead of inserting, so
  its categorization and `journal_entry_id` survive the reconnect. Identical
  same-day transactions pair one-to-one.
- **Rules pre-fill; a person posts.** `bank_categorization_rules`
  ("description contains X ⇒ this kind/target", saved from the row's
  "Remember this" checkbox) are applied at sync time by both the manual path
  and the cron. `auto_post = true` rows are posted only during a board
  member's own manual sync or "Post all ready" click. The cron always passes
  `autoPost: false`: an unattended process with no human behind it fetches
  and pre-categorizes, but does not write to a tax-relevant ledger. This
  keeps #5's "every ledger write has an `auth.uid()`" literally true.
- **`bank_transactions` UPDATEs are now audited** (`tg_audit`, update only —
  inserts are still the sync writing external data). Categorization carries
  accounting weight now; #24's "closer to a cache than a record" no longer
  describes it.
- **Financial Statements (0034) did not change.** It reads
  `income_statement_lines` over the real ledger; the feed simply became how
  that ledger gets written. The page shows how many bank transactions in
  the period are not yet posted, so the reader knows what the figures leave
  out. Manual `record_payment`/`record_expense` remain for anything that
  never touches the connected bank.

**Known limits, called out rather than papered over:**

- One connection = one ledger cash account. A Plaid Item with checking +
  savings maps both to the same cash account today; `plaid_account_id` is
  persisted on every row so a per-sub-account mapping can be added without
  a re-sync.
- Fingerprint collisions across a reconnect (two genuinely identical
  transactions on one day, where the prior connection had only one) fall
  back to inserting the surplus — the safe direction.
- There is no automatic detection of "this bank transaction is the same
  event as an expense someone already recorded by hand." Posting both
  double-counts. The bank feed is the intended entry point now; the manual
  forms are for what the bank never sees.

**Speed (0046), added 2026-10-10.** Two things changed for a treasurer who
opens this tab for ten minutes a month, neither of which changes what can
reach the ledger. `bank_payee_history` is a *derived* table — one row per
payee (`bank_payee_key()`, the SQL twin of `normalizeDescription()`),
direction, and choice, with a count, a cents total and a last-seen date —
maintained only by a SECURITY DEFINER trigger on `bank_transactions` and
backfilled once in the migration. It is read-only to every role (select for
`can_read_financials`, no write policies, no audit trigger because it is a
tally of rows that are already audited) and exists so the "Recommended" chip
reads a few dozen rows instead of re-tallying every categorized transaction
on each page load. `post_bank_transactions(uuid[])` and
`unpost_bank_transactions(uuid[])` are batch wrappers that loop over the
per-row RPCs above in a sub-transaction each, returning `(id, ok, error)` per
row — "Post all ready" is one round trip instead of one per row, a failing
row is reported rather than fatal, and nothing is bypassed: every id still
goes through `post_bank_transaction()` / `unpost_bank_transaction()` with
their own authorization and accounting. `bank_transactions.rule_id` records
which saved rule pre-filled a row during sync (the column only; the sync
writes it in a later slice).

**Fewer clicks (slice B), added 2026-10-10.** Six behaviours, none of which
changes who can write the ledger. (1) Filing a row as a transfer or "Not for
the books" saves a rule for that exact description on its own — those are
never judgement calls twice — with `auto_post` false; the "Remember this"
checkbox is gone. (2) After an expense/income/dues choice the action returns
`ruleSuggestion` when `bank_payee_history` shows this is at least the second
time the payee was filed that way and no rule matches, so the client can
ask "Always file X as Y?" and call `saveCategorizationRule()`; the sync now
writes `rule_id` and auto-posts through the batch RPC. (3) The page counts
each status with head-count queries and loads one status at a time, 200
rows by default (`?limit=` up to 2,000, fetched as limit+1 so it knows
whether to offer "Load earlier"); it no longer silently truncates at 500.
(4) When a board admin opens the page and an active bank last synced more
than 12 hours ago, a sync runs *after the response* (`after()` from
`next/server`) with `autoPost: false` — a page load is not a click, so
nothing reaches the ledger from it. Home nudges when no bank has synced in
over three days. (5) A deposit whose amount matches a check/cash/other
payment recorded by hand on Dues for the recommended unit within ±10 days
is recommended as "Not for the books" with `source: 'duplicate'`, so the
same dues are not posted twice. (6) Reconnect: `isLoginRequired()` names
Plaid's sign-in-again errors; the sync marks the connection `status =
'error'` (the existing value the Home tile already reads as "needs
reconnecting", so no migration) and clears it on the next successful sync;
`createUpdateLinkToken()` opens Link in update mode and `reconnectBank()`
sets it active and syncs. The Item, its ID and its history survive, so
nothing is re-imported.

**Categorizing (slice C), added 2026-10-10.** Client-side only; the server
actions and RPCs above are unchanged. (1) Clicking a recommendation chip now
files *and posts* a settled row (`applyCategorizations` with `postNow`), with
"Save for later" beside it to file without posting; a pending row's chip
only files, and says it posts once the bank settles it. This is still a
person's click per row or per batch — nothing posts on its own. (2) "Accept
all N" posts the settled recommendations the board's own history backs;
keyword guesses are a separate, quieter "also the N guesses" link, and
pending rows are left out. (3) One searchable category picker (a combobox
grouped Expenses / Other income / Dues per unit / Transfers per cash account
/ Not for the books) replaces the three dropdowns; a pick sets kind, account
and unit together, and vendor is a second line only for an expense. (4) The
chip shows how sure it is: filled for history, outlined for a keyword guess
("a guess from the description"), warning-tinted "Already recorded · not for
the books" for a likely duplicate. (5) Posting more than ten rows at once
(Accept all, the bulk bar, Post all ready) shows a preview first: count,
money out and in, and up to three flags computed from what the page already
has — first-time payees and amounts over three times the payee's usual
(`typicalAmountCents`, which leaves an already-filed row's own amount out of
the mean). A nudge, never a block. (6) Search and range apply as you type
(`router.replace` of the same query params the page reads) with removable
chips; the Filter button is gone. (7) j/k, Enter, c, x and Escape work the
backlog from the keyboard. (8) A row filed by a rule shows a "rule" tag with
"Remove rule"; after a save, the toast asks "Always file X as Y?" when the
action returned `ruleSuggestion`. (9) Undo in the toast works for all of the
above, through `revertCategorizations` → `unpost_bank_transactions`, a
reversing entry as always.

**Layout (slice D), added 2026-10-10.** Presentation only; no action, RPC
or table changed. (1) The Transactions card header is two rows: status
pills with, at the right, "N to go" (the true head count, not the rows
loaded), a 120px progress bar and "Post N saved"; then filter & search with
"Rules · N" at its right, which opens the rules list inline — the separate
Rules card is gone. (2) Pills are All / Needs category / Ready to post /
Posted; "Ready to post" is brass-tinted while anything is saved for later;
Excluded and Retracted sit behind "More ▾", Retracted only when it has rows.
(3) "In $X · Out $Y this month" moved under the big bank total (it follows
the range when one is chosen), summed in TypeScript from the rows RLS
returns for that bounded period. (4) A board member can click anywhere on
an editable row to open or close its form; below the sm breakpoint each row
is a card made from the same `<tr>`/`<td>` elements with flex ordering, so
there is one row to maintain. (5) "Showing the latest N of M · Load earlier"
is a centered line under the table. (6) A bank that wants a fresh sign-in
has that one sentence and the Reconnect button in place of its button row,
and the same sentence tops the Transactions card as a bad-status Answer.

**Review fixes, added 2026-10-10.** Corrections to the four slices above,
each the simpler of the options on the table. (1) *No rule is saved without
a yes.* Slice B's "transfers and Not for the books are remembered on their
own" is withdrawn: it turned the duplicate guard (a one-deposit fact) and the
`x` key into permanent substring rules, and Undo could not take them back.
Instead the "Always file X as Y?" question now covers every kind, asked only
from the form after the second filing of a payee; chips, `x` and
"Post all recommended" never create a rule. (2) Rules are stored and matched
on the payee key (`normalizeDescription`, the same key as
`bank_payee_history`), so a rule made from "COMED 8841 10/03" fires on next
month's "COMED 8841 11/03"; a pattern that normalizes to under three letters
never matches. (3) A duplicate chip files that row alone, never its
same-payee siblings. (4) A hand categorization clears `excluded_at` (when
leaving Not for the books) and `rule_id`; undo restores both. (5) "Post N
saved", its preview gate and `postAllReady()` all use the same unfiltered set.
(6) The auto-sync runs only on the landing render (no search, filter, sort or
limit params) and not again within ten minutes per server instance; the bank
card says to reload to see the result. Plaid balances are remembered per
connection for ten minutes per instance, forgotten by Sync now and Reconnect.
(7) `applyCategorizations` groups rows by choice into one UPDATE each.
(8) `MAX_LIMIT` is 1,000 (hosted Supabase's max_rows) and "more rows exist"
comes from the head count, not an extra row. (9) One reconnect notice (the
bank card's), worded for a non-admin as "needs a board admin to sign in
again". (10) Words: the state is "Not for the books" everywhere (pill, filter,
buttons "Keep out of the books"); the bulk button is "Post all N recommended";
toasts count what was actually posted ("2 posted · 1 couldn't be posted
yet"); after yes to a rule the toast says only that, with no Undo. (11) A row
click opens its form but never closes it, so a second tap on a phone cannot
discard a half-made pick. (12) 0047 drops the redundant
`bank_payee_history_lookup_idx`.

## 30. Access reviews, automated deprovisioning, and personal-data redaction — including the one path that edits the audit log

*Decided: Doug, 2026-09-26. Plaid's security review (submitted the same
day) came back with eight attestations due 2027-03-27. Doug asked for
everything buildable to be built rather than attested to on paper.*

Three mechanisms, all in migration 0037:

- **Access reviews are recorded, not asserted.** `record_access_review()`
  writes an append-only `access_reviews` row (no insert/update/delete
  policy for any role) holding a snapshot of every active grant. The home
  page raises "Access review" for board admins 90 calendar days after the
  last one — calendar days specifically, because 90×24h drifts across a DST
  change and displayed the wrong date in the first version.
- **Deprovisioning is automatic where the facts are unambiguous.**
  `deprovision_stale_access()` revokes an `owner` grant once that person's
  last ownership record has ended, and records the revocation of grants
  past `expires_on`. It deliberately does **not** revoke owners who have
  never had an ownership record — an invite redeemed before the board
  records the sale is pending access, and guessing wrong there locks a real
  owner out. It runs daily from the cron route (extending #28's single
  service-role path to one more narrow task; `role_grants` is not the
  ledger, so #29's "the cron never writes the books" still holds) and at
  the start of every access review. System revocations leave `revoked_by`
  null.
- **Personal data can actually be removed.** `redact_person()` clears a
  former member's name, email, phone, mailing address, and login link,
  keeping the row (ownership and payment history reference it) as "Former
  member". Refused while the person holds any active grant or current
  ownership, and on the caller's own record.

**The exception to `CLAUDE.md` invariant #7 (append-only audit log).** `redact_person()` also
scrubs those same fields out of `audit_log.before_data`/`after_data` for
that person's `persons` rows and for `invites` rows carrying their email.
Without that, a "deletion" leaves the deleted data in the one table
designed to keep everything forever. The exception is as narrow as it can
be: one SECURITY DEFINER function, board_admin only, touching only named
personal-data keys, on rows about that one person. The events survive —
who changed what and when — and so does the redaction itself (the
`persons` update it performs is audited, with the removed values scrubbed).
Every other role and path still has no way to modify the audit log.

**How to apply:**

- Anything new that stores a person's personal data must either reference
  `persons` (and so be covered here) or be added to `redact_person()`.
- A new audited table that copies personal fields into its rows needs its
  audit rows added to the scrub, or the deletion is incomplete.
- Financial records are never redacted or deleted while an association is
  active; retention is in `docs/SECURITY_POLICY.md` §9.

---

## 31. A platform-admin role for records shared by every association

**Decided 2026-09-30 by Doug**, while building Insurance "Get quotes" and the
Taxes form templates (docs/reference/build-prompt-budget-contractors-insurance-taxes.md).

Some records belong to no association: the insurance brokers quote
requests go to, and (Part 4) the official IRS/Illinois form templates and
their field maps. No `board_admin` should be able to edit what every other
association relies on, so there is one role above it:

- `platform_admins(user_id)` plus `is_platform_admin()` (SECURITY DEFINER,
  pinned search_path). The table has RLS on and **no policies** — nobody
  reads or writes it through the API; it's consulted only by the function.
- Global tables (`insurance_partners`, later `tax_form_templates`) are
  readable as needed by boards and writable only when `is_platform_admin()`.
  They're listed as deliberate exceptions in the association-scoping lint
  (`tests/db/migrations.test.ts`) and are not on `tg_audit()`, whose log is
  per association.
- **Ships with no rows.** The migration hardcodes nobody: Doug's account has
  a different email in each environment (`doug.smart6@gmail.com` on
  dev/staging, `doug@dscollective.io` on production). Each environment's row
  is added by hand:

  ```sql
  insert into public.platform_admins (user_id, note)
  select id, 'Doug' from auth.users where email = '<that environment''s email>';
  ```

**Related choices made in the same build:**

- **Quote requests are mailto drafts**, not sent by Walkup — same as
  contractor emails. Walkup still has no email-sending service. A request is
  a `draft` until the board opens it in their email app and marks it sent;
  the database refuses `sent` without a `sent_at`.
- **Google Places** ("Find a contractor") sends Google the building's street
  address and the trade searched, server-side only. Hidden entirely until
  `GOOGLE_PLACES_KEY` is set. Listed in the privacy policy.
- **Contractor reviews are board-only.** Owners still can't read `vendors`
  (W-9 and tax-ID data live there).

**How to apply:**

- A new table with no `association_id` needs a reason to be global, a
  platform-admin-only write policy, and an entry in the scoping lint.
- Never grant `platform_admins` rows from app code or a migration.

---

## 32. Taxes: determination, official forms, and income classification

**Decided 2026-09-30** (Doug chose the classification approach; the rest follows
the Taxes prompt adapted in docs/reference/build-prompt-budget-contractors-insurance-taxes.md).

- **Income classification is pre-filled, confirmed once.** The seed chart
  (0005) sets `is_exempt_function_income` per account — which is classifying
  by name, and the prompt forbids relying on that. The flags and their CHECK
  constraints keep their meaning; each income account with activity now needs
  a board member to confirm it once (`accounts.tax_classification_confirmed_at`,
  via `confirm_income_classification()` only). Until every one is confirmed,
  1120-H is `ask_cpa`: "Some income isn't classified yet."
- **Thresholds stay in `tax_parameters`**, cited by source URL and shown as
  unverified until someone sets `verified_on`. The one hardcoded `600`
  fallback on the tax page is gone; a missing threshold now says "ask your CPA".
- **1099-NEC is calendar-year** (`vendor_1099_calendar_totals`). January and
  February look at the year just ended.
- **Due dates come from rule strings on verified templates** (`lib/tax/due-rules`,
  e.g. `FY_END + 4 MONTHS, DAY 15`), each with a citation. Home's "Coming up"
  keeps its built-in estimates, labeled unverified, until a verified template
  replaces them.
- **Illinois:** IL-1120 is always `ask_cpa`; the SOS annual report is `ask_cpa`
  until a verified template records its due rule.
- **Official PDFs only, verified by a person.** `tax_form_templates` is global
  (DECISIONS #31), ships empty, accepts only https irs.gov / tax.illinois.gov /
  ilsos.gov sources, and can't be active until verified. Every mapped field
  cites its instructions line; unmapped fields print blank. Recipient TINs are
  never filled (last four only, #4). Templates live in the private
  `tax-templates` bucket, not the per-association Document Hub; filled packets
  go in each association's hub, linked to the form.
- **No scheduled re-fetch job.** The prompt's January job would need the
  service role, and #28 keeps that exception to one file. Instead the admin
  page prompts each January and "Check active forms for updates" re-downloads
  and checksums them as the admin; a changed file becomes a new inactive
  template, never an automatic switch.
- **No filing, no advice.** Exports are a signable packet (cover sheet +
  flattened official form) and a CPA packet (editable PDF + provenance
  worksheet). "Mark as filed" records a date and optional proof, and locks the
  1120-H figures (0022).

---

## 33. Taxes: links registry, suggested templates, accountant handoff, deadlines

**Decided 2026-10-11** — Doug set the direction (the four goals in
docs/reference/build-prompt-tax-center-v2.md §0: show the official links the
building needs, auto-fill the forms, draft the email to the accountant, remind
the board when things are due); Claude settled the details below from a pass
over the code and the official IRS and Illinois pages, all retrieved that same
day. Amends #32; where this entry and that spec disagree, this entry wins.

The problem #32 left: dev and production both still had **zero**
`tax_form_templates`, so a board opening the Taxes tab saw no official link,
no due date and no way to hand figures to a CPA — the template gate, which
exists for anything Walkup *fills*, was also gating things that never needed
it. Every piece below keeps that gate exactly where it was (a person verifies
and activates; nothing in this build sets `active`, `verified_at` or
`verified_on` from code) and gives the board something honest on day one
without it. The honesty rule is the same one `tax_parameters` has lived under
since 0005: a link, a date or a threshold Walkup *retrieved* is shown as
"retrieved 2026-10-11 · not yet checked by a person" until a person checks
it, and anything Walkup can't source reads "ask your CPA" — never a guess,
and never "verified by Walkup".

- **Official links are a registry, retrieved and dated.** `tax_form_links`
  (global, #31: any signed-in user reads, only `is_platform_admin()` writes,
  not on `tg_audit()`, listed in the scoping lint) ships seeded with the 19
  URLs research opened on 2026-10-11 — IRS "About Form …" pages,
  instructions, the W-9, IRIS, the paper-form order page, the Illinois DOR
  pages and the ILSOS annual-report portal and statute — every row
  `retrieved_on '2026-10-11'`, `verified_at null`. A platform admin's "I
  opened this and it's current" sets `verified_at`; "Check all links" only
  records `'200'`, `'blocked'` or `'error: …'` and is never a verification
  (ilsos.gov refuses non-browser clients, so its rows stay "couldn't be
  checked automatically" until a person opens them). A link checked more
  than 12 months ago reads "last checked over a year ago". Board-facing
  "latest" links are the About pages, which stay current; pinned PDFs exist
  only for the fill template. A verified active template's `source_url` /
  `instructions_url` outranks the registry for that form and year. Only
  https URLs on irs.gov, illinois.gov, ilsos.gov or ilga.gov (any subdomain)
  are accepted, by CHECK and by `isOfficialLinkUrl()`.
- **Day-one autofill comes from a suggested registry in code, still gated by
  a person.** `src/lib/tax/suggested/` carries cited field maps authored
  against the real 2025 Form 1120-H (49 entries, the full calculated chain
  8 → 16 → 17 → 19 → 20 → 22 → 23g → 24/25) and the Rev. December 2026
  1099-NEC (13 Copy B entries), plus three link-only entries. The admin's
  one-click `applySuggestedTemplate()` fetches the pinned PDF through the
  existing `fetchOfficialPdf` → `storeTemplate` path and **refuses** to
  apply the map unless the file's sha256 equals `authoredAgainstSha256` and
  its title equals `expectedTitle` (otherwise the template is stored
  inactive with a note and no map); the map is validated exactly as
  `saveFieldMap` validates a hand-entered one. `tax_form_templates` still
  ships with zero rows, and the admin still opens the labeled preview and
  clicks "Verify and activate". The IRS PDFs carry no field tooltips, so
  the name → line mapping was corroborated by widget geometry on the
  labeled render, not printed captions — the preview *is* the human check.
  Citations follow the official headings rather than the spec's shorthand:
  the 1099-NEC due rule cites "Reminders — Filing dates" (IRC 6071(c)) plus
  General Instructions Part C (i1099mec has no "When To File" heading); its
  filing citation adds Part E (where "Copy A printed from the IRS website
  can't be filed" actually lives; Part O is penalties); the IL-1120 note
  records the extension as 7 months (8 for June-30 year ends) per the DOR
  due-date page and says "Ask your CPA what to attach" because the DOR
  answer page does not mention attaching the 1120-H. Each entry's `notes`
  lists the boxes left blank on purpose, for the admin page.
- **Link-only templates** (`kind = 'link_only'`, no PDF; CHECK
  `tax_form_templates_pdf_has_file` ties `storage_path`/`sha256` to the
  kind) carry a cited due rule, filing instructions and notes for the forms
  Walkup never fills: the Illinois SOS annual report, IL-1120 and Form 1096.
  Same verify/activate gate. `tax_forms.template_id` points at a link-only
  template too — rules without fields — so "no PDF template" in code is
  `template.kind !== 'pdf'`, not a null id.
- **No template is never a dead end.** The worksheet always carries the
  figures from the records (`figuresPack`: association, the five 1120-H
  figures with transaction counts, non-exempt income by account, the two
  tests, the provisional estimate, and the contractor for a 1099 — no TIN;
  the EIN appears in the worksheet file and never in an email body), the
  official link is one click away, "Send to your accountant" works, and a
  form with nothing to confirm in Walkup can be **marked filed by hand**.
- **1120-H is an election, not "Required".** When both tests pass the
  determination is the new value `eligible`: "You qualify — elect it by
  filing. Ask your CPA whether 1120-H or Form 1120 is better this year."
  `likely_required` stays for Form 1120 when a test fails; the
  `determination` CHECK widens accordingly.
- **Form 1096 turns on a stored answer**, never "optional":
  `associations.information_returns_filing` — `paper` → required,
  `electronic` → not_required, null → ask_cpa ("Tell Walkup how you file
  1099s with the IRS, or ask your CPA") — and it appears only when at
  least one 1099 is determined. Beside the chooser: Copy A and Form 1096
  printed from the IRS website can't be filed.
- **1099-NEC exports are recipient copies only.** `include_pages [4, 5, 6]`
  (Copy B, the recipient instructions, Copy 2); Copy 2 is filled by
  mirroring Copy B at export (`mirror_json`); Copy A and Form 1096 are
  never produced; the cover says to file through IRIS or on official
  forms; the contractor's TIN prints blank by design (#4) and the map has
  no field for it.
- **Thresholds and rates resolve as of the period, half-open.** The $600
  `form_1099_nec_threshold` row now ends `2026-01-01` and a **$2,000** row
  starts there — `verified_on null`, cited to the Rev. December 2026
  instructions and P.L. 119-21 §70433, with a note that the amount is
  inflation-indexed from 2027 (add a new row when the IRS publishes it;
  never edit this one). Readers resolve the 1099 threshold **as of Dec 31
  of the payment year** and the 1120-H parameters **as of the fiscal year
  end**, with `effective_from <= date and (effective_to is null or
  effective_to > date)` — the closed interval the old code used matched
  both rows on exactly 2026-01-01. In code that is `parametersAsOf()` /
  `resolveParameters()` in src/app/tax/data.ts (keys starting `form_1099`
  by payment year, everything else by fiscal year end; determine.ts gets
  the resolved list and does no date filtering). In SQL,
  `compute_and_save_tax_filing()` is re-created with the same figures,
  provenance rows and arithmetic as 0022/0024 but `v_as_of =
  fiscal_years.ends_on`; each `parameters_snapshot` element now carries
  `"as_of"` (filings saved before 0048 lack it — treat it as optional),
  and the fiscal-year lookup is scoped to the association and raises
  `P0002` 'fiscal year not found for this association' instead of saving a
  filing against another building's year. `verify_tax_parameter(uuid)`
  (platform admin) is the only way `verified_on` gets set.
- **The accountant is a `persons` row** — `associations.accountant_person_id`
  plus `accountant_firm`, set through `set_accountant(assoc, person, firm)`,
  which any board member may call (it is a contact, not an access grant; a
  null person clears both columns). A BEFORE trigger refuses a person from
  another association (42501), and `redact_person()` refuses while the
  person is the accountant ("choose another accountant first"). This is
  independent of the expiring `accountant` role grant; "Give them read
  access to the books" stays a separate link.
- **The handoff is a mailto draft plus a recorded "sent".** Three drafts
  (`1120h`, `1099`, `heads_up`), each under 1,800 characters so the URL
  opens in every mail client, every figure named with its checked /
  not-yet-checked state, the due date as verified-with-citation /
  "estimated — please confirm" / "not on file — can you confirm it?", and
  no EIN, TIN or account number anywhere (`scrubIdentifiers()` runs over
  the whole body and subject). A draft cannot carry attachments, so the
  panel orders the downloads first and the body names the files. "Mark as
  sent" writes `sent_to_accountant_at`, `sent_to_accountant_by` (the CHECK
  needs both in one write) and `sent_snapshot_json`: subject, attachment
  filenames, the figures in cents, the as-of dates and the accountant's
  **person id** — and the body with its greeting and sign-off lines
  replaced by "[greeting removed]" / "[sender removed]", so no person's
  name is stored outside `persons` (#30: `tax_forms` is audited and
  `redact_person()` does not scrub this column, so the column must never
  hold a name).
- **Reminders come from one pure module**, `src/lib/tax/deadlines.ts`,
  read by the Taxes tab, Home's "Coming up", the Next-filing tile, the
  urgent items and the `.ics` download, so they can't disagree. A date
  comes from exactly one of three places and says which: a verified active
  template's cited rule (`verified`), the built-in estimate (`estimated`,
  always with "Estimated — not yet checked against this year's
  instructions."), or nothing (`none`, "ask your CPA"). The estimates:
  1120-H and IL-1120 = the 15th of the 4th month after the fiscal year end,
  and **none** for a June-30 year end (the IRS carves that case out — 3rd
  month — so Walkup doesn't guess); 1099-NEC and 1096 = Jan 31 after the
  payment year; the Illinois annual report = the **last day of the month
  before the anniversary month** (805 ILCS 105/114.10 says within the 60
  days before that month; the earlier month-end replaces the old
  anniversary-date estimate because it is the safer one; a January
  anniversary means Dec 31 of the prior year; no incorporation date → none,
  "add it in Building Info"); Form 1120 = none, since no rule is sourced.
  The due-rule grammar gains `INCORPORATION_ANNIVERSARY_MONTH - 1 MONTHS,
  DAY LAST` for the verified version of that rule. An overdue deadline
  stays for 120 days, then its next instance replaces it; milestones are
  "send to your accountant" at due − 60 days while an accountant is set
  and nothing has been sent, else "start" at due − 45 days. Home builds a
  light outcome list from its own queries and never calls
  `loadTaxContext`. Delivery is in-app, an RFC 5545 `.ics` with alarms
  (−30/−7 days, plus −60 for the returns; estimated dates are `TENTATIVE`
  and say "(estimated)"), and mailto drafts ("Send the dates to the board"
  goes to the other current board members). No cron, no service role (#28).
- **The filing year is the one whose return is next to file.**
  `filingYearFor()`: the newest fiscal year that has ended within the last
  12 months and whose 1120-H is neither filed nor locked; else the year
  containing today; else the newest. `?fy=` overrides on the tab. Autofill
  and the exports always load the context for the **form's own** fiscal
  year or payment year, so last year's form never fills from this year's
  books.
- **One "filed".** `markFormFiled` on the form page is allowed when the
  form is `ready_to_sign` **or** when there is no PDF template and no
  lines (nothing to confirm in Walkup — filed by hand or by the
  accountant). For the 1120-H it saves the year's figures
  (`compute_and_save_tax_filing`) when no `tax_filings` row exists and
  locks them (`lock_tax_filing`) in the same step. The tab's FilingStatus
  keeps "Save this year's figures" only; `markTaxFilingFiled` is gone.
- **The editable PDF for a CPA opens with a one-page draft cover** —
  "Draft from Walkup — figures not yet confirmed by the board. Not the
  official filing." — while the form is `draft`/`in_review`. It is
  prepended *inside* the form's own document (`prependCover`), because
  copying pages into a new document drops the AcroForm and the "editable"
  packet would have no fields. The signable packet is unchanged (cover +
  flattened form).
- **`is_platform_admin()` now also requires `session_is_aal2()`.** A
  password-only session must not be able to change what every
  association's tax pages read from. The admin page already runs behind
  the MFA proxy; this closes the database side.
- **Autofill details that changed with the maps.** A `calculated` line
  reads a manual operand from what the person has `entered` (a line they
  chose to leave blank counts as 0 — a blank money line on a tax form
  means zero), is stored auto-confirmed (derived figures need no click),
  and always takes the fresh value on refresh. Map entries may carry
  `kind`, `review` (confidence capped), `zeroOk` ("Enter 0") and `hint`;
  the settings vocabulary gains the US-formatted incorporation date, the
  three non-calendar fiscal-year header boxes and the form's tax year.

**Related choices made in the same build:**

- `set_tax_filing_settings(assoc, method, file_number)` writes **both**
  settings on every call (null method = "not yet answered"; the file
  number is trimmed, empty → null). The two controls on the tab submit
  separately, so `setFilingSettings` reads the untouched column's current
  value and passes it through. Known to be a slightly fragile shape; if it
  bites, a 0049 can split it into one RPC per setting.
- Form 1096 produces a deadline only when the answer is `paper`; an
  unanswered question is "ask your CPA" on the card, not a date on the
  calendar.
- Non-Illinois buildings (production has one in NH) get an honest "Walkup
  only knows Illinois' state filings so far — ask your CPA which {state}
  filings apply", and the federal forms still show. IL-1120 stays
  `ask_cpa` as a determination; it now also carries a date and a note once
  a template records them.
- `revision_title` (the PDF's own title) is captured at fetch; the
  January "Check active forms for updates" compares titles and says
  "probably next year's form — set its tax year by hand" rather than
  guessing. `storeTemplate` no longer upserts.
- `tax_forms` is linkable from the Document Hub (`LINKABLE_TABLES`).
- 1099 "Ask for a W-9" is a mailto to the contractor with the registry's
  W-9 link. The W-9 itself is still never a template.

**Still open — a CPA has reviewed none of this (open question A).** Every
number, date and link above is what the official pages said on 2026-10-11,
labeled "not yet checked" in-app; the $2,000 threshold, the 19 links, every
due rule and every line of both field maps are owed a person's check (the
admin page) and a CPA's review before anyone files. Smaller items, recorded
so they aren't lost: the tax year for a non-calendar fiscal year is taken
from the year the fiscal year *ends* in, while IRS form years follow the
year a tax year *begins* in — the header boxes fill correctly either way,
but template lookup by `tax_year` should be checked with a CPA before a
July–June building relies on it; line 19 prints 0 when line 17 is below the
$100 deduction (`max0`), which a CPA should confirm; the 1099-NEC "For
calendar year" box takes the four-digit year — confirm against the labeled
preview at Verify and activate; whether IL-1120 must have the 1120-H
attached could not be sourced from tax.illinois.gov; 805 ILCS 105/114.10
could not be re-fetched (ilga.gov TLS error) and stands as recorded; a
verified SOS template date can never read as overdue, because `dueDate()`
returns the next occurrence; after 120 days an unfiled form's deadline rolls
to the next tax year, so a stale year's card finds no deadline by key and
reads "Due date not on file — ask your CPA"; and migration 0048 was written
and tested against PGlite but not yet applied to any Supabase project.

**How to apply:**

- Nothing in code sets `tax_form_templates.active` / `verified_at`,
  `tax_form_links.verified_at` or `tax_parameters.verified_on`. A person
  clicks; the RPCs that record the click require a platform admin at AAL2.
- Every tax date, threshold and link a view shows carries its source and
  its checked / not-yet-checked state, in words a board member reads.
  Unsourced means "ask your CPA" — don't add an estimate without a cited
  rule (the June-30 year end is the standing example). Never "verified by
  Walkup".
- Resolve `tax_parameters` as of the period with the half-open range —
  `parametersAsOf()` in TS, `effective_to > v_as_of` in SQL — never "as of
  today", and never pass every row to something that picks the first by
  key. A changed amount is a new row with a new `effective_from`; the old
  row gets an `effective_to`.
- Anything that needs a due date reads `deadlines.ts`; don't compute dates
  anywhere else. Dates stay ISO strings end to end — no `Date` arithmetic,
  no UTC/local mixing (`todayIso` from lib/dates, not `toISOString()`).
- Anything that stores email text or a draft strips the names, runs
  `scrubIdentifiers()`, and references people by `persons` id (#30).
  Nothing is ever sent by Walkup: every email is a mailto draft the
  person opens, and the UI says so under the button.
- Recipient TINs are never stored, filled or mirrored (#4). A new 1099 map
  entry is refused by the tests if it names `f2_11` or any Copy A / Copy 1
  field.
- Applying 0048: dev/staging now, production on "General Kenobi". No
  backfill. Afterwards the admin runs "Set up from Walkup's suggestions"
  for 1120-H 2025 and 1099-NEC 2026, opens each labeled preview, verifies
  and activates; opens and confirms the links; and marks the rules checked
  only once confirmed against the instructions — both threshold rows
  reading "not yet checked" after the migration is correct, not a bug.
- Adding a suggested map for a new revision: author it against the pinned
  PDF, record its sha256 and title, cite the printed line and the
  instructions heading (only headings that exist — none invented), list
  the deliberately blank boxes in `notes`, and let `applySuggestedTemplate`
  refuse any file that doesn't match byte for byte.

---

## 34. The landing page: a signed-out waitlist, and one place for site facts

**Decided 2026-10-14 by Doug** (approving Claude's recommendations on the landing-page pass).

- **Other-states waitlist (0049).** Visitors outside Illinois can leave an
  email and their state. `state_waitlist` is global (no association), RLS on
  with no policies. The only way in is `join_state_waitlist()`, the single
  SECURITY DEFINER function callable by `anon`: it validates, ignores repeats
  of the same email + state (so it can't reveal who signed up), and caps
  sign-ups at 5 an hour per hashed IP and 200 an hour in total. The IP is
  never stored, only SHA-256(IP + date). Both lint tests in
  `tests/db/migrations.test.ts` list it as their one exception.
- **Why not stricter.** There is no service role outside the cron (#28), so
  a signed-out write has to go through a function `anon` can call, and anyone
  holding the public key can call it directly with any hash. The per-IP cap
  only slows the site's own form; the hourly total is the real ceiling.
  Per-visitor limits that can't be bypassed belong in a Vercel Firewall rule.
- **Site facts live in `src/lib/site-config.ts`**: contact email, booking
  link, legal entity, founder photo, testimonial, plan prices, the FAQ (which
  also feeds the FAQPage structured data), and `DUES_PAYMENTS_ENABLED`
  (false: Walkup never touches money, #22/#24).
- **Canonical host is `https://www.walkuphoa.com`**, matching Vercel's 308
  from the bare domain.
- **No testimonials or founder photo until real ones exist**; placeholders
  never render (`TODO(doug)` in the config).

**How to apply:**

- A new signed-out write needs the same shape (one narrow function, a hard
  hourly ceiling, a lint exception with a reason, a privacy-policy line) and a
  new decision.
- Reading the waitlist is by SQL as a platform admin; removal on request is a
  hand delete.
