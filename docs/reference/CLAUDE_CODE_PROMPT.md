# Claude Code — Slice 1 Build Prompt

> Paste this as your first message in Claude Code, with `HOA_Manager_Spec.md`, `CLAUDE.md`, and `schema.sql` in the repo root.

---

## The prompt

I'm building **HOA Manager**, an accounting and compliance system for self-managed condominium associations of 2–6 units. Read `HOA_Manager_Spec.md` and `CLAUDE.md` in full before writing any code — they contain domain decisions that are already made and should not be re-litigated.

**Build Slice 1 only: the ledger and the 1120-H output.** Do not build the AI document intake, the owner portal, the compliance calendar, or the operations layer. They are specified for context so your data model doesn't have to be rewritten later, not for you to implement now.

### Stack

Next.js App Router + TypeScript, Supabase (Postgres, Auth, Storage), Tailwind + shadcn/ui, deployed on Vercel. `schema.sql` is the starting schema — review it critically before applying, and tell me where you disagree with it.

### Scope of Slice 1

**Foundation**
- Supabase project scaffolding, migrations, typed client
- Auth with the five roles in the spec (`board_admin`, `board_member`, `accountant`, `owner`, `vendor`)
- Row-level security on every table, scoped by `association_id`
- Association setup: units, ownership percentages (effective-dated), fiscal year configuration

**Ledger**
- Double-entry journal entries with balanced lines — reject unbalanced entries at the database level, not just the UI
- Chart of accounts, seeded with the HOA default set, editable per association
- Fund accounting: operating vs. reserve, with explicit inter-fund transfer entries
- Modified cash basis: assessments accrue as receivables, expenses record when paid

**Assessments and receivables**
- Recurring assessment schedules per unit
- Charge generation on schedule
- Payment recording and allocation against open charges
- Late fee rules and delinquency aging (30/60/90)
- Special assessments allocated by ownership percentage

**Expenses and vendors**
- Vendor records with W-9 fields, TIN, entity type, 1099-eligibility flag
- Expense entry linked to vendor and account
- Running per-vendor annual totals

**Reporting**
- Balance sheet by fund
- Income statement, budget vs. actual
- Owner ledger / statement per unit
- Delinquency report
- General ledger and trial balance

**Tax output**
- 1120-H worksheet: exempt vs. non-exempt income classification, 60% income test, 90% expenditure test, $100 specific deduction, 30% rate applied to non-exempt taxable income
- Tests must show their work — pass/fail with the underlying figures visible, not just a verdict
- 1099-NEC candidate report with missing-W-9 exceptions
- Tax rates and thresholds read from a dated `tax_parameters` table with source citations — never hardcoded

### Rules I want you to hold to

1. **Money is `NUMERIC(14,2)`.** Never a float. Anywhere.
2. **Unbalanced journal entries must be impossible** — enforce with a database constraint or trigger, not application logic alone.
3. **Closed periods are immutable.** Corrections are reversing entries. Never an in-place edit.
4. **Every financial mutation writes an audit row** — who, what, when, before/after.
5. **RLS is not optional.** Write an explicit test proving an `owner` cannot read another owner's balance. I want to see that test fail before the policy exists and pass after.
6. **No secrets in client code.** Anthropic and Supabase service keys stay server-side.
7. **Migrations, not manual dashboard edits.** Every schema change is a versioned file.

### How I want you to work

- Start by reading the spec and schema, then **tell me what's wrong with them** before you write code. I would rather fix the data model now than migrate it later.
- Propose a build order and wait for my confirmation before starting.
- Work in small, reviewable commits. Accounting correctness matters more than velocity here.
- Write tests for the accounting logic — balance enforcement, aging calculation, fund separation, the 60% and 90% tests — before the UI for those features.
- When domain judgment is required and the spec doesn't cover it, ask me. Do not guess at tax or accounting behavior.
- Flag anything where you think the spec is wrong about tax or accounting treatment. I am not a CPA, and the spec reflects my understanding, not verified professional advice.

### First response I want from you

1. Your read on the schema — specifically where the data model will hurt us at Slice 3 (owner portal) or Slice 5 (operations)
2. Any place the modified-cash-basis decision creates a problem you can foresee
3. A proposed build order for Slice 1, in commit-sized chunks
4. The questions you need answered before starting

Don't write application code yet.
