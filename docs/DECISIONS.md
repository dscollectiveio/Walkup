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
