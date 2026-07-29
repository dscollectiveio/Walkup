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
