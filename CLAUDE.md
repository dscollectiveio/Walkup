@AGENTS.md

# Walkup

Accounting and compliance software for self-managed condominium associations of
2–6 units.

The user is a board officer with no accounting training who does this unpaid in
the evenings. Every interface decision should assume that person, not a
bookkeeper.

The product's annual output is a defensible tax filing (Form 1120-H) and a clean
handoff to the next board.

## Read before acting

1. `docs/DECISIONS.md` — settled decisions. **Wins over the spec on conflict.**
2. `HOA_Manager_Spec.md` — full parameters, preserved as originally written.
3. `AGENTS.md` — this is Next 16; its APIs differ from model training data.
   Read `node_modules/next/dist/docs/` before writing app code.

Raise objections to settled decisions; do not silently deviate.

## Current slice

**Slice 1: ledger + 1120-H output.** Nothing else is in scope.

Later slices exist in the spec so the data model doesn't need rewriting, not for
implementation now:
2. AI document intake + vault → 3. Owner portal + accountant access →
4. Compliance calendar + state rules → 5. Operations layer

## Stack

Next.js 16 App Router · TypeScript · Supabase (Postgres, Auth, Storage) ·
Postgres RLS for authorization · Tailwind · Vercel · Anthropic API
(server-side, later slices) · Vitest + Playwright

## Invariants — do not violate

1. **Money is `NUMERIC(14,2)`.** Never `float`, never `double precision`.
2. **Ownership percentages are `NUMERIC(9,6)`** and sum to exactly 100% per
   amendment.
3. **Journal entries must balance**, enforced by a deferred constraint trigger.
   Application validation alone is insufficient.
4. **All ledger writes go through `post_journal_entry()`.** Nothing inserts
   into `journal_entries` or `journal_lines` directly — the deferred trigger
   cannot be satisfied across separate PostgREST requests. See DECISIONS #5.
5. **Every table has `association_id`** and an RLS policy scoped to it.
6. **Posted entries are immutable**, immediately — not merely at period close.
   Corrections are reversing entries. Closed periods are immutable too.
7. **Every financial mutation writes to `audit_log`**, which is append-only for
   every role including `board_admin`.
8. **Tax rates and thresholds are never hardcoded** — `tax_parameters`, with
   `effective_from`, `source_url`, `verified_on`.
9. **No secrets client-side.** Service role and Anthropic keys are server-only.
10. **Schema changes are migrations**, never dashboard edits.
11. **`SECURITY DEFINER` functions pin `search_path`** and schema-qualify every
    reference. An unpinned one is a privilege escalation vector.

## Accounting model

- **Books:** modified cash. Assessments accrue as receivables; expenses record
  when paid.
- **Tax:** cash method. **These differ, materially** — see DECISIONS #1. A
  book-to-tax reconciliation is required.
- **Method:** double-entry.
- **Funds:** operating and reserve separately reportable. Inter-fund transfers
  are explicit journal entries, never implicit.

## Tax model (1120-H)

Both tests read **cash movements**, never the income statement:

- **60% income test** — debits to cash accounts, classified by the credit leg
- **90% expenditure test** — credits to cash accounts, classified by the debit leg

Capital expenditures count toward the 90% numerator whether expensed or
capitalized. Threshold is `associations.capitalization_threshold`, default
$2,500.

Both tests display their underlying figures, not just pass/fail. 30% rate on
non-exempt taxable income, $100 specific deduction, both read from
`tax_parameters`.

Non-exempt income typically includes: interest on reserves, laundry, common-area
rental, vending, non-member fees.

## Roles

Roles are **grants**, not a column — one person commonly holds several. In a
self-managed building every board member is also an owner.

| Role | Access |
|---|---|
| `board_admin` | Full read/write |
| `board_member` | Full read, limited write, no deletes |
| `accountant` | Financials + linked docs, time-boxed grant with expiry |
| `owner` | Read-only: budgets, summaries, own unit ledger only |
| vendor | No account — tokenized single-work-order link (Slice 5) |

An owner must never be able to read another owner's balance. **Write that test
before the policy, and watch it fail.**

## Working preferences

- Read DECISIONS and the spec before writing code
- Propose a plan and wait for confirmation before large changes
- Small, reviewable commits
- Tests for accounting logic before the UI for that logic
- **Ask rather than guess** on tax or accounting behaviour
- Flag spec errors — the spec reflects the owner's understanding, not verified
  CPA advice

## Known risks

- **Tax logic has not been reviewed by a CPA.** Every tax computation is
  provisional and must say so in the UI.
- The cash-method decision (DECISIONS #1) is the assumption the entire tax
  module rests on. It is Doug's call, not a CPA's, so far.
- **State compliance data rots.** Anything unverified is labelled unverified,
  never presented as authoritative.
- Nothing in the feature set has been deprioritized — resist scope expansion
  into later slices.
