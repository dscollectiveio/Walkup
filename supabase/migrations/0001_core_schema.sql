-- ============================================================================
-- Walkup — migration 0001: core schema
--
-- Scope: extensions, enums, tables, structural constraints, indexes.
--
-- Deliberately NOT in this migration (see the DEFERRED manifest at the bottom
-- of this file): the balance trigger, period/posting immutability, the
-- ownership sum-to-100 constraint, the audit trigger, RLS policies, and the
-- post_journal_entry RPC. Each of those lands in a later migration together
-- with the test that proves it works. Applying 0001 alone gives you tables
-- with no enforcement — do not put data in it.
--
-- Derived from docs/reference/original-schema.sql. Where this diverges, the
-- reason is recorded in docs/DECISIONS.md.
-- ============================================================================

create extension if not exists btree_gist with schema extensions;

-- ============================================================================
-- ENUMS
-- ============================================================================

-- 'vendor' is intentionally absent: vendors never hold an account. They get a
-- tokenized single-work-order link (Slice 5).
create type app_role      as enum ('board_admin','board_member','accountant','owner');
create type fund_type     as enum ('operating','reserve','other');
create type account_type  as enum ('asset','liability','equity','income','expense');
create type charge_type   as enum ('assessment','special_assessment','late_fee','other');
create type charge_status as enum ('open','partial','paid','waived','written_off');
create type entity_type   as enum ('individual','sole_prop','partnership','c_corp','s_corp','llc','other');
create type period_status as enum ('open','closed');

-- ============================================================================
-- CORE: associations, units, people, roles
-- ============================================================================

create table associations (
  id                      uuid primary key default gen_random_uuid(),
  legal_name              text not null,
  display_name            text not null,
  state_code              text not null check (state_code ~ '^[A-Z]{2}$'),
  county                  text,
  city                    text,
  ein                     text,
  incorporated_on         date,  -- drives the annual report deadline (Slice 4)
  fiscal_year_end_month   smallint not null default 12
                            check (fiscal_year_end_month between 1 and 12),

  -- Capital expenditures at or above this amount are capitalized; below it,
  -- expensed. Default is the IRS de minimis safe harbor for taxpayers without
  -- an applicable financial statement (Treas. Reg. 1.263(a)-1(f)).
  -- Either way the outlay counts toward the 1120-H 90% expenditure test —
  -- see docs/DECISIONS.md #2.
  capitalization_threshold        numeric(14,2) not null default 2500.00
                                    check (capitalization_threshold >= 0),
  capitalization_threshold_source text
    default 'Treas. Reg. 1.263(a)-1(f) de minimis safe harbor, non-AFS taxpayer',

  -- Soft delete. Associations are never hard-deleted: every financial FK below
  -- is ON DELETE RESTRICT so that destroying a ledger requires deliberate,
  -- auditable effort rather than one cascading DELETE.
  deleted_at              timestamptz,

  created_at              timestamptz not null default now()
);

-- NOTE: unit_count from the original schema is dropped. It duplicated
-- count(units) and would drift. Compute it.

create table units (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  label           text not null,   -- 'Unit 2', 'Garden', 'C-1'
  sort_order      smallint not null default 0,
  unique (association_id, label)
);

-- One human. May hold several roles, may own several units, may be an owner
-- with no login at all (auth_user_id null).
--
-- This replaces the original schema's split between `owners` and
-- `memberships.auth_user_id`, which were two independent sources of truth for
-- "which login is this person" with nothing keeping them in sync.
create table persons (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  full_name       text not null,
  email           text,
  phone           text,
  mailing_address text,
  auth_user_id    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- A given login is at most one person within an association. The same login
  -- may be a different person row in a different association.
  unique (association_id, auth_user_id)
);

create index on persons (auth_user_id) where auth_user_id is not null;
create unique index persons_association_email_key
  on persons (association_id, lower(email)) where email is not null;

-- Roles are grants, not a column on the person.
--
-- In a self-managed 2-6 unit building every board member is also an owner.
-- The original schema's `unique (association_id, auth_user_id)` on memberships
-- made that unrepresentable — it forced each person to pick one hat.
create table role_grants (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  person_id       uuid not null references persons(id) on delete restrict,
  role            app_role not null,
  granted_on      date not null default current_date,
  granted_by      uuid references auth.users(id),
  expires_on      date,           -- accountant grants expire; default 90d set in app
  revoked_at      timestamptz,
  revoked_by      uuid references auth.users(id),
  unique (association_id, person_id, role),
  check (expires_on is null or expires_on >= granted_on)
);

create index on role_grants (association_id, person_id)
  where revoked_at is null;

-- ============================================================================
-- OWNERSHIP
-- ============================================================================

-- Ownership percentages are modelled as amendments, not as free-floating
-- effective-dated rows.
--
-- The original schema stored one row per (unit, percentage, date range), which
-- made "percentages sum to exactly 100% per association per date" a constraint
-- over every date in the union of all interval boundaries — hard to write,
-- worse to debug, and impossible to enforce cheaply.
--
-- Here, one amendment carries one effective date and a complete set of lines
-- covering every unit. The constraint becomes "lines sum to 100 within the
-- amendment", which is a simple per-header check. It also gives Slice 5's
-- Section 22.1 resale packet the amendment history it needs, for free.
create table ownership_amendments (
  id                    uuid primary key default gen_random_uuid(),
  association_id        uuid not null references associations(id) on delete restrict,
  effective_from        date not null,
  reason                text,   -- 'initial declaration', 'unit 3 sale', 'amendment recorded 2024-06-01'
  recorded_document_ref text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  unique (association_id, effective_from)
);

create table ownership_amendment_lines (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  amendment_id   uuid not null references ownership_amendments(id) on delete cascade,
  unit_id        uuid not null references units(id) on delete restrict,
  percentage     numeric(9,6) not null check (percentage > 0 and percentage <= 100),
  unique (amendment_id, unit_id)
);

-- Who occupies/owns a unit, over time. Separate from percentage: joint owners
-- share one unit's percentage, and one person may own two units.
create table unit_owners (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  unit_id        uuid not null references units(id) on delete restrict,
  person_id      uuid not null references persons(id) on delete restrict,
  effective_from date not null,
  effective_to   date,
  check (effective_to is null or effective_to > effective_from)
);

create index on unit_owners (association_id, person_id);
create index on unit_owners (association_id, unit_id);

-- ============================================================================
-- FISCAL PERIODS
-- ============================================================================

create table fiscal_years (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  label          text not null,   -- '2026'
  starts_on      date not null,
  ends_on        date not null,
  status         period_status not null default 'open',
  closed_at      timestamptz,
  closed_by      uuid references auth.users(id),
  unique (association_id, label),
  check (ends_on > starts_on),
  check ((status = 'closed') = (closed_at is not null))
);

-- A fiscal year may not overlap another for the same association.
alter table fiscal_years add constraint fiscal_years_no_overlap
  exclude using gist (
    association_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  );

-- ============================================================================
-- FUNDS + CHART OF ACCOUNTS
-- ============================================================================

create table funds (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  name           text not null,
  kind           fund_type not null,
  is_restricted  boolean not null default false,
  unique (association_id, name)
);

create table accounts (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  code           text not null,
  name           text not null,
  type           account_type not null,
  is_active      boolean not null default true,

  -- Marks the accounts that represent actual cash (operating cash, reserve
  -- cash). Both 1120-H tests are computed from movements across these
  -- accounts, because the return is filed on the CASH method while the books
  -- accrue assessments — see docs/DECISIONS.md #1.
  --
  --   60% income test      = debits to cash accounts, classified by the credit leg
  --   90% expenditure test = credits to cash accounts, classified by the debit leg
  --
  -- Neither test can read the income statement.
  is_cash_account boolean not null default false,

  -- 1120-H classification.
  is_exempt_function_income boolean,
  is_exempt_expenditure     boolean,

  unique (association_id, code),

  -- Income accounts must be classified. There is no defensible default and a
  -- null here silently breaks the 60% test.
  check (type <> 'income' or is_exempt_function_income is not null),
  check (type =  'income' or is_exempt_function_income is null),

  -- Expense accounts must be classified. Asset accounts MAY be, because a
  -- capitalized improvement is an asset on the books but still counts in the
  -- 90% numerator. Everything else must not be.
  check (type <> 'expense' or is_exempt_expenditure is not null),
  check (type in ('expense','asset') or is_exempt_expenditure is null),

  check (not is_cash_account or type = 'asset')
);

-- ============================================================================
-- DOCUMENTS
-- ============================================================================
-- Added in Slice 1 although nothing in Slice 1 uploads a file. Insurance
-- certificates, minutes, W-9s, reserve studies and Section 22.1 packets all
-- attach to different parents, and Slice 2 requires every extracted
-- transaction to link permanently to its source document. Retrofitting this
-- later means backfilling links across live financial data.

create table documents (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  storage_path   text not null,
  filename       text not null,
  mime_type      text,
  byte_size      bigint,
  uploaded_by    uuid references auth.users(id),
  uploaded_at    timestamptz not null default now(),
  unique (association_id, storage_path)
);

create table document_links (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  document_id    uuid not null references documents(id) on delete restrict,
  target_table   text not null,
  target_id      uuid not null,
  relation       text,   -- 'source', 'w9', 'invoice', 'receipt'
  unique (document_id, target_table, target_id, relation)
);

create index on document_links (association_id, target_table, target_id);

-- ============================================================================
-- DOUBLE-ENTRY LEDGER
-- ============================================================================

create table journal_entries (
  id                 uuid primary key default gen_random_uuid(),
  association_id     uuid not null references associations(id) on delete restrict,
  fiscal_year_id     uuid not null references fiscal_years(id) on delete restrict,
  entry_date         date not null,
  memo               text,
  source             text not null default 'manual'
                       check (source in ('manual','assessment','payment','expense','import','reversal','transfer')),
  source_id          uuid,
  source_document_id uuid references documents(id) on delete restrict,
  reverses_entry_id  uuid references journal_entries(id) on delete restrict,

  -- An entry is a draft until posted. Once posted it is immutable — not merely
  -- immutable at period close. Corrections are reversing entries. There is no
  -- legitimate reason to edit a posted entry in a four-unit building, and
  -- "immutable at close" leaves a months-long window in which the audit log is
  -- the only record that anything changed.
  is_posted          boolean not null default false,
  posted_at          timestamptz,
  posted_by          uuid references auth.users(id),

  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),

  check ((is_posted) = (posted_at is not null))
);

create table journal_lines (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references associations(id) on delete restrict,
  journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id       uuid not null references accounts(id) on delete restrict,
  fund_id          uuid not null references funds(id) on delete restrict,
  unit_id          uuid references units(id) on delete restrict,
  debit            numeric(14,2) not null default 0 check (debit  >= 0),
  credit           numeric(14,2) not null default 0 check (credit >= 0),
  line_memo        text,
  check (not (debit > 0 and credit > 0)),
  check (debit > 0 or credit > 0)
);

-- ============================================================================
-- ASSESSMENTS / RECEIVABLES
-- ============================================================================

create table assessment_schedules (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references associations(id) on delete restrict,
  name              text not null,
  frequency         text not null
                      check (frequency in ('monthly','quarterly','annual','one_time')),
  fund_id           uuid not null references funds(id) on delete restrict,
  allocation_method text not null default 'percentage'
                      check (allocation_method in ('percentage','equal','fixed_per_unit')),
  starts_on         date not null,
  ends_on           date,
  is_special        boolean not null default false,
  total_amount      numeric(14,2) check (total_amount is null or total_amount > 0),
  created_at        timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (not is_special or total_amount is not null)
);

create table assessment_charges (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references associations(id) on delete restrict,
  schedule_id      uuid references assessment_schedules(id) on delete restrict,
  unit_id          uuid not null references units(id) on delete restrict,

  -- Explicit. Late fees are not anonymous rows with a null schedule_id: the
  -- owner statement, the delinquency report, and any state that caps fee
  -- accrual all need principal separated from fees.
  charge_type      charge_type not null default 'assessment',

  period_start     date not null,
  due_on           date not null,
  amount           numeric(14,2) not null check (amount > 0),

  -- NOTE: amount_applied and status from the original schema are dropped.
  -- They were denormalized caches of payment_allocations and would drift. At
  -- 80-150 transactions a year there is no performance argument for the cache.
  -- Both are computed in a view (migration 0003).
  waived_at        timestamptz,
  written_off_at   timestamptz,

  journal_entry_id uuid references journal_entries(id) on delete restrict,
  created_at       timestamptz not null default now(),
  check (due_on >= period_start),
  check (waived_at is null or written_off_at is null)
);

create table late_fee_rules (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  grace_days      smallint not null default 10 check (grace_days >= 0),
  flat_amount     numeric(14,2) check (flat_amount is null or flat_amount >= 0),
  percent_rate    numeric(6,4)  check (percent_rate is null or percent_rate >= 0),
  max_total_fee   numeric(14,2),  -- reasonableness cap; several states require one
  applies_monthly boolean not null default true,
  effective_from  date not null,
  effective_to    date,
  check (effective_to is null or effective_to > effective_from),
  check (flat_amount is not null or percent_rate is not null)
);

create table payments (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references associations(id) on delete restrict,
  unit_id          uuid references units(id) on delete restrict,
  received_on      date not null,
  amount           numeric(14,2) not null check (amount > 0),
  method           text check (method in ('check','ach','cash','card','other')),
  reference        text,
  fund_id          uuid not null references funds(id) on delete restrict,

  -- NOT NULL, unlike the original schema. A payment with no ledger entry is a
  -- subsidiary record that can silently diverge from the general ledger, which
  -- is the classic source of "the trial balance doesn't tie and nobody knows
  -- why". Payment and entry are written together in one RPC (migration 0003).
  journal_entry_id uuid not null references journal_entries(id) on delete restrict,

  created_at       timestamptz not null default now()
);

-- A payment need not be fully allocated. The unallocated remainder is prepaid
-- assessment (a book liability, account 2100) and — because the return is on
-- the cash method — is taxable income in the year received. That book/tax
-- difference is a line on the reconciliation report.
create table payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  payment_id     uuid not null references payments(id) on delete cascade,
  charge_id      uuid not null references assessment_charges(id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  unique (payment_id, charge_id)
);

-- ============================================================================
-- VENDORS / EXPENSES / 1099
-- ============================================================================

create table vendors (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  name            text not null,
  entity_type     entity_type,

  -- Deliberately last-4 only. For a sole proprietor the TIN is a Social
  -- Security number, and 1099-NEC is filed once a year by a human who can read
  -- the number off the W-9 in storage. Storing full TINs buys nothing and
  -- creates a serious breach liability for a product whose customers are four
  -- people in a condo building. See docs/DECISIONS.md #4.
  tin_last4       text check (tin_last4 is null or tin_last4 ~ '^[0-9]{4}$'),

  w9_on_file      boolean not null default false,
  w9_received_on  date,
  is_1099_exempt  boolean not null default false,  -- explicit; never inferred from entity_type
  address         text,
  email           text,
  created_at      timestamptz not null default now(),
  unique (association_id, name)
);

create table expenses (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references associations(id) on delete restrict,
  vendor_id        uuid references vendors(id) on delete restrict,

  -- Points at an expense account when the outlay is below the association's
  -- capitalization threshold, and at an asset account when it is at or above.
  -- Either way the cash leg is what the 90% test reads.
  account_id       uuid not null references accounts(id) on delete restrict,
  is_capitalized   boolean not null default false,

  fund_id          uuid not null references funds(id) on delete restrict,
  paid_on          date not null,   -- modified cash: recorded when paid
  amount           numeric(14,2) not null check (amount > 0),
  is_services      boolean not null default true,   -- drives 1099-NEC inclusion
  memo             text,

  journal_entry_id uuid not null references journal_entries(id) on delete restrict,
  created_at       timestamptz not null default now()
);

-- ============================================================================
-- BUDGETS
-- ============================================================================

create table budgets (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  fiscal_year_id uuid not null references fiscal_years(id) on delete restrict,
  approved_on    date,
  unique (association_id, fiscal_year_id)
);

create table budget_lines (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  budget_id      uuid not null references budgets(id) on delete cascade,
  account_id     uuid not null references accounts(id) on delete restrict,
  fund_id        uuid not null references funds(id) on delete restrict,
  amount         numeric(14,2) not null,
  unique (budget_id, account_id, fund_id)
);

-- ============================================================================
-- TAX
-- ============================================================================

-- Global reference data, not association-scoped. RLS still applies (readable
-- by any authenticated user, writable only by the service role) — a public
-- schema table without RLS is world-writable through PostgREST, which for a
-- table of tax rates is not acceptable.
create table tax_parameters (
  id             uuid primary key default gen_random_uuid(),
  key            text not null,   -- 'form_1120h_rate_condo', 'specific_deduction', 'test_60_pct', ...
  numeric_value  numeric(14,6) not null,
  effective_from date not null,
  effective_to   date,
  source_url     text,
  verified_on    date,
  notes          text,
  check (effective_to is null or effective_to > effective_from)
);

-- One value per key at any point in time; ambiguity here means the wrong rate
-- silently applies.
alter table tax_parameters add constraint tax_parameters_no_overlap
  exclude using gist (
    key with =,
    daterange(effective_from, effective_to, '[)') with &&
  );

create table tax_filings (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  fiscal_year_id uuid not null references fiscal_years(id) on delete restrict,
  form           text not null,   -- '1120-H'

  -- Cash-basis figures. The books accrue assessments; the return does not.
  exempt_income_cash        numeric(14,2),
  nonexempt_income_cash     numeric(14,2),
  gross_income_cash         numeric(14,2),
  exempt_expenditures_cash  numeric(14,2),
  total_expenditures_cash   numeric(14,2),

  -- Both tests must show their work, so the ratios are stored alongside the
  -- verdicts rather than recomputed for display.
  test_60_pct_ratio  numeric(9,6),
  test_60_pct_passed boolean,
  test_90_pct_ratio  numeric(9,6),
  test_90_pct_passed boolean,

  taxable_income     numeric(14,2),
  tax_due            numeric(14,2),

  -- The tax_parameters rows actually used, frozen at computation time.
  -- Without this, editing a rate silently changes an already-filed return.
  parameters_snapshot jsonb,
  book_to_tax_notes   text,

  computed_at timestamptz,
  filed_on    date,
  locked_at   timestamptz,   -- set on filing; blocks recomputation (migration 0003)

  unique (association_id, fiscal_year_id, form)
);

-- ============================================================================
-- AUDIT
-- ============================================================================

-- Append-only. No UPDATE or DELETE policy is ever written for this table, for
-- any role including board_admin. Rows are inserted by a SECURITY DEFINER
-- trigger (migration 0003) so that RLS on the audited tables does not block
-- the write. association_id deliberately carries no FK: the log must outlive
-- whatever it describes.
create table audit_log (
  id             bigserial primary key,
  association_id uuid not null,
  actor_user_id  uuid,
  table_name     text not null,
  record_id      uuid,
  action         text not null check (action in ('insert','update','delete')),
  before_data    jsonb,
  after_data     jsonb,
  occurred_at    timestamptz not null default now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

create index on journal_lines      (association_id, account_id);
create index on journal_lines      (journal_entry_id);
create index on journal_lines      (association_id, unit_id) where unit_id is not null;
create index on journal_entries    (association_id, entry_date);
create index on journal_entries    (association_id, fiscal_year_id);
create index on assessment_charges (association_id, unit_id, due_on);
create index on assessment_charges (association_id, due_on);
create index on payment_allocations(charge_id);
create index on expenses           (association_id, vendor_id, paid_on);
create index on payments           (association_id, unit_id, received_on);
create index on audit_log          (association_id, occurred_at desc);
create index on ownership_amendments      (association_id, effective_from desc);
create index on ownership_amendment_lines (amendment_id);

-- ============================================================================
-- DEFERRED — the enforcement this schema does not yet have
-- ============================================================================
-- Applying 0001 alone gives you tables with no invariants. Every item below is
-- a later migration paired with the test that proves it. Nothing real goes in
-- this database until all of them are green.
--
-- 0002_rls.sql — DONE. RLS enabled on every table, policies written, helper
--   functions SECURITY DEFINER with search_path pinned. The isolation suite in
--   tests/db/rls.test.ts was written first and observed to fail (an owner read
--   a neighbour's delinquency) before these policies existed.
--
-- 0003_ledger.sql
--   - journal entry balance: sum(debit) = sum(credit) per entry, as a DEFERRED
--     constraint trigger. NOTE: this cannot be satisfied by separate PostgREST
--     inserts, because each REST request is its own transaction — the entry
--     would commit alone and unbalanced. All ledger writes therefore go
--     through post_journal_entry(), a SECURITY DEFINER function taking the
--     header and a lines array in one call. See docs/DECISIONS.md #5.
--   - posted entries immutable (UPDATE/DELETE blocked on entries and lines)
--   - closed fiscal years immutable (INSERT/UPDATE/DELETE blocked)
--   - tax_filings frozen once locked_at is set
--   - ownership_amendment_lines sum to exactly 100.000000 per amendment
--     (deferred constraint trigger)
--   - unit_owners: no overlapping ranges per (unit, person)
--   - payment_allocations: sum per payment <= payments.amount
--   - views: charge_balances, payment_unapplied, trial_balance
--
-- 0004_audit.sql
--   - SECURITY DEFINER audit trigger on every financial table
--   - audit_log INSERT policy only; no UPDATE, no DELETE, ever
--
-- 0005_seed.sql
--   - chart of accounts with is_cash_account and the 1120-H flags
--   - tax_parameters with source_url and verified_on populated
-- ============================================================================
