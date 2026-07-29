-- HOA Manager — Slice 1 schema (ledger + 1120-H)
-- Postgres / Supabase
-- Review critically before applying. This is a starting point, not gospel.

-- ============================================================
-- ENUMS
-- ============================================================

create type app_role as enum ('board_admin','board_member','accountant','owner');
create type fund_type as enum ('operating','reserve','other');
create type account_type as enum ('asset','liability','equity','income','expense');
create type charge_status as enum ('open','partial','paid','waived','written_off');
create type entity_type as enum ('individual','sole_prop','partnership','c_corp','s_corp','llc','other');
create type period_status as enum ('open','closed');

-- ============================================================
-- CORE: associations, units, ownership, membership
-- ============================================================

create table associations (
  id                  uuid primary key default gen_random_uuid(),
  legal_name          text not null,
  display_name        text not null,
  state_code          char(2) not null,
  county              text,
  city                text,
  ein                 text,
  incorporated_on     date,                       -- drives annual report deadline
  fiscal_year_end_month smallint not null default 12
                        check (fiscal_year_end_month between 1 and 12),
  unit_count          smallint not null check (unit_count > 0),
  created_at          timestamptz not null default now()
);

create table units (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  label               text not null,              -- 'Unit 2', 'Penthouse', 'C-1'
  sort_order          smallint not null default 0,
  unique (association_id, label)
);

-- Effective-dated so mid-year sales and percentage amendments are representable.
create table ownership_interests (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  unit_id             uuid not null references units(id) on delete cascade,
  percentage          numeric(9,6) not null check (percentage > 0 and percentage <= 100),
  effective_from      date not null,
  effective_to        date,
  check (effective_to is null or effective_to > effective_from)
);
-- NOTE: percentages must sum to exactly 100 per association per date.
-- Enforce with a deferred constraint trigger — see migrations.

create table owners (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  full_name           text not null,
  email               text,
  phone               text,
  mailing_address     text,
  auth_user_id        uuid,                        -- nullable: not every owner logs in
  created_at          timestamptz not null default now()
);

create table unit_owners (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  unit_id             uuid not null references units(id) on delete cascade,
  owner_id            uuid not null references owners(id) on delete cascade,
  effective_from      date not null,
  effective_to        date
);

create table memberships (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  auth_user_id        uuid not null,
  role                app_role not null,
  owner_id            uuid references owners(id),  -- required when role = 'owner'
  granted_on          date not null default current_date,
  expires_on          date,                        -- accountant grants expire
  unique (association_id, auth_user_id)
);

-- ============================================================
-- FISCAL PERIODS
-- ============================================================

create table fiscal_years (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  label               text not null,               -- '2026'
  starts_on           date not null,
  ends_on             date not null,
  status              period_status not null default 'open',
  closed_at           timestamptz,
  unique (association_id, label),
  check (ends_on > starts_on)
);

-- ============================================================
-- CHART OF ACCOUNTS + FUNDS
-- ============================================================

create table funds (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  name                text not null,
  kind                fund_type not null,
  is_restricted       boolean not null default false,
  unique (association_id, name)
);

create table accounts (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  code                text not null,
  name                text not null,
  type                account_type not null,
  is_active           boolean not null default true,

  -- 1120-H classification. Without these, the 60% and 90% tests cannot compute.
  is_exempt_function_income boolean,               -- income accounts only
  is_exempt_expenditure     boolean,               -- expense accounts only

  unique (association_id, code)
);

-- ============================================================
-- DOUBLE-ENTRY LEDGER
-- ============================================================

create table journal_entries (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  fiscal_year_id      uuid not null references fiscal_years(id),
  entry_date          date not null,
  memo                text,
  source              text not null default 'manual',   -- manual|assessment|payment|expense|import|reversal
  source_id           uuid,
  reverses_entry_id   uuid references journal_entries(id),
  is_posted           boolean not null default false,
  created_by          uuid,
  created_at          timestamptz not null default now()
);

create table journal_lines (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  journal_entry_id    uuid not null references journal_entries(id) on delete cascade,
  account_id          uuid not null references accounts(id),
  fund_id             uuid not null references funds(id),
  unit_id             uuid references units(id),        -- set for owner-attributable lines
  debit               numeric(14,2) not null default 0 check (debit >= 0),
  credit              numeric(14,2) not null default 0 check (credit >= 0),
  line_memo           text,
  check (not (debit > 0 and credit > 0)),
  check (debit > 0 or credit > 0)
);

-- Balance enforcement lives in a deferred constraint trigger:
-- sum(debit) must equal sum(credit) per journal_entry_id at commit.
-- Do NOT rely on application code for this.

-- ============================================================
-- ASSESSMENTS / RECEIVABLES
-- ============================================================

create table assessment_schedules (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  name                text not null,
  frequency           text not null,               -- monthly|quarterly|annual|one_time
  fund_id             uuid not null references funds(id),
  allocation_method   text not null default 'percentage',  -- percentage|equal|fixed_per_unit
  starts_on           date not null,
  ends_on             date,
  is_special          boolean not null default false,
  total_amount        numeric(14,2),               -- special assessments: total to allocate
  created_at          timestamptz not null default now()
);

create table assessment_charges (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  schedule_id         uuid references assessment_schedules(id),
  unit_id             uuid not null references units(id),
  period_start        date not null,
  due_on              date not null,
  amount              numeric(14,2) not null check (amount > 0),
  amount_applied      numeric(14,2) not null default 0 check (amount_applied >= 0),
  status              charge_status not null default 'open',
  journal_entry_id    uuid references journal_entries(id),
  created_at          timestamptz not null default now()
);

create table late_fee_rules (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  grace_days          smallint not null default 10,
  flat_amount         numeric(14,2),
  percent_rate        numeric(6,4),
  applies_monthly     boolean not null default true,
  effective_from      date not null,
  effective_to        date
);

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  unit_id             uuid references units(id),
  received_on         date not null,
  amount              numeric(14,2) not null check (amount > 0),
  method              text,                        -- check|ach|cash|other
  reference           text,
  fund_id             uuid not null references funds(id),
  journal_entry_id    uuid references journal_entries(id),
  created_at          timestamptz not null default now()
);

create table payment_allocations (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  payment_id          uuid not null references payments(id) on delete cascade,
  charge_id           uuid not null references assessment_charges(id),
  amount              numeric(14,2) not null check (amount > 0)
);

-- ============================================================
-- VENDORS / EXPENSES / 1099
-- ============================================================

create table vendors (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  name                text not null,
  entity_type         entity_type,
  tin_last4           text,                        -- store full TIN encrypted, out of band
  w9_on_file          boolean not null default false,
  w9_received_on      date,
  is_1099_exempt      boolean not null default false,  -- explicit flag, never inferred
  address             text,
  email               text,
  created_at          timestamptz not null default now()
);

create table expenses (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  vendor_id           uuid references vendors(id),
  account_id          uuid not null references accounts(id),
  fund_id             uuid not null references funds(id),
  paid_on             date not null,               -- modified cash: recorded when paid
  amount              numeric(14,2) not null check (amount > 0),
  is_services         boolean not null default true,   -- drives 1099-NEC inclusion
  memo                text,
  journal_entry_id    uuid references journal_entries(id),
  created_at          timestamptz not null default now()
);

-- ============================================================
-- BUDGETS
-- ============================================================

create table budgets (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  fiscal_year_id      uuid not null references fiscal_years(id),
  approved_on         date,
  unique (association_id, fiscal_year_id)
);

create table budget_lines (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  budget_id           uuid not null references budgets(id) on delete cascade,
  account_id          uuid not null references accounts(id),
  fund_id             uuid not null references funds(id),
  amount              numeric(14,2) not null,
  unique (budget_id, account_id, fund_id)
);

-- ============================================================
-- TAX
-- ============================================================

-- Never hardcode rates. Dated, sourced, and visibly stale-able.
create table tax_parameters (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null,               -- 'form_1120h_rate_condo', 'specific_deduction'
  numeric_value       numeric(14,6) not null,
  effective_from      date not null,
  effective_to        date,
  source_url          text,
  verified_on         date,
  notes               text
);

create table tax_filings (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references associations(id) on delete cascade,
  fiscal_year_id      uuid not null references fiscal_years(id),
  form                text not null,               -- '1120-H'
  exempt_income       numeric(14,2),
  nonexempt_income    numeric(14,2),
  exempt_expenditures numeric(14,2),
  total_expenditures  numeric(14,2),
  test_60_pct_passed  boolean,
  test_90_pct_passed  boolean,
  taxable_income      numeric(14,2),
  tax_due             numeric(14,2),
  computed_at         timestamptz,
  filed_on            date,
  unique (association_id, fiscal_year_id, form)
);

-- ============================================================
-- AUDIT
-- ============================================================

create table audit_log (
  id                  bigserial primary key,
  association_id      uuid not null,
  actor_user_id       uuid,
  table_name          text not null,
  record_id           uuid,
  action              text not null,               -- insert|update|delete
  before_data         jsonb,
  after_data          jsonb,
  occurred_at         timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index on journal_lines (association_id, account_id);
create index on journal_lines (journal_entry_id);
create index on journal_entries (association_id, entry_date);
create index on assessment_charges (association_id, unit_id, status);
create index on assessment_charges (association_id, due_on);
create index on expenses (association_id, vendor_id, paid_on);
create index on payments (association_id, unit_id, received_on);
create index on audit_log (association_id, occurred_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Enable on EVERY table. Sketch below; write real policies per table.

alter table associations        enable row level security;
alter table units               enable row level security;
alter table ownership_interests enable row level security;
alter table owners              enable row level security;
alter table unit_owners         enable row level security;
alter table memberships         enable row level security;
alter table fiscal_years        enable row level security;
alter table funds               enable row level security;
alter table accounts            enable row level security;
alter table journal_entries     enable row level security;
alter table journal_lines       enable row level security;
alter table assessment_schedules enable row level security;
alter table assessment_charges  enable row level security;
alter table late_fee_rules      enable row level security;
alter table payments            enable row level security;
alter table payment_allocations enable row level security;
alter table vendors             enable row level security;
alter table expenses            enable row level security;
alter table budgets             enable row level security;
alter table budget_lines        enable row level security;
alter table tax_filings         enable row level security;
alter table audit_log           enable row level security;

create or replace function current_association_ids()
returns setof uuid language sql stable security definer as $$
  select association_id from memberships
  where auth_user_id = auth.uid()
    and (expires_on is null or expires_on >= current_date);
$$;

create or replace function current_role_in(assoc uuid)
returns app_role language sql stable security definer as $$
  select role from memberships
  where auth_user_id = auth.uid() and association_id = assoc
    and (expires_on is null or expires_on >= current_date)
  limit 1;
$$;

-- Example: owners see only their own unit's charges.
create policy charges_select on assessment_charges for select using (
  association_id in (select current_association_ids())
  and (
    current_role_in(association_id) in ('board_admin','board_member','accountant')
    or unit_id in (
      select uo.unit_id from unit_owners uo
      join memberships m on m.owner_id = uo.owner_id
      where m.auth_user_id = auth.uid()
        and (uo.effective_to is null or uo.effective_to >= current_date)
    )
  )
);

-- ============================================================
-- SEED: default HOA chart of accounts
-- ============================================================
-- Applied per association at setup. 1120-H flags pre-set to sane defaults
-- but must remain editable — classification is a judgment call.
--
-- code | name                          | type      | exempt?
-- -----+-------------------------------+-----------+---------
-- 1000 | Operating Cash                | asset     |
-- 1010 | Reserve Cash                  | asset     |
-- 1200 | Assessments Receivable        | asset     |
-- 1250 | Late Fees Receivable          | asset     |
-- 2000 | Accounts Payable              | liability |
-- 2100 | Prepaid Assessments           | liability |
-- 3000 | Operating Fund Balance        | equity    |
-- 3100 | Reserve Fund Balance          | equity    |
-- 4000 | Regular Assessments           | income    | exempt
-- 4010 | Special Assessments           | income    | exempt
-- 4020 | Late Fees                     | income    | exempt
-- 4100 | Interest Income               | income    | NON-exempt
-- 4110 | Laundry Income                | income    | NON-exempt
-- 4120 | Common Area Rental            | income    | NON-exempt
-- 5000 | Insurance                     | expense   | exempt
-- 5010 | Utilities                     | expense   | exempt
-- 5020 | Repairs & Maintenance         | expense   | exempt
-- 5030 | Landscaping / Snow Removal    | expense   | exempt
-- 5040 | Janitorial                    | expense   | exempt
-- 5050 | Professional Fees (legal/acct) | expense  | exempt
-- 5060 | Bank & Merchant Fees          | expense   | exempt
-- 5070 | State Filing Fees             | expense   | exempt
-- 5080 | Capital Improvements          | expense   | exempt
-- 5900 | Income Tax Expense            | expense   | NON-exempt
