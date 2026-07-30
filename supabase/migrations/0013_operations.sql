-- ============================================================================
-- Walkup — migration 0013: operations layer
--
-- Maintenance tickets, contractor profiles, recurring bills, insurance
-- tracking, and document storage. This is Slice 5 in the original spec,
-- brought forward deliberately.
--
-- Three deliberate limits, recorded here because the schema is where they will
-- be forgotten first:
--
-- 1. NO PAYMENT INITIATION. recurring_bills records what is due and whether
--    autopay is already arranged *at the utility or the bank*. Walkup does not
--    store bank credentials and does not move money. A four-unit association
--    should arrange autopay with the provider directly; software that holds
--    the association's banking credentials is a liability far exceeding the
--    convenience.
--
-- 2. NO AUTOMATIC SENDING. contractor_messages holds drafts. A human approves
--    each one. An association that accidentally emails a contractor an
--    authorisation it did not intend has a real problem, and the board member
--    doing this unpaid in the evenings is exactly who would not notice.
--
-- 3. NO BROKERING. insurance_quotes tracks what carriers have offered so the
--    board can compare year on year. Advising on or placing insurance is a
--    licensed activity; this records decisions, it does not make them.
-- ============================================================================

create type ticket_status   as enum ('open','in_progress','waiting_on_contractor','resolved','closed');
create type ticket_priority as enum ('low','normal','urgent');
create type bill_frequency  as enum ('monthly','quarterly','semiannual','annual');
create type coverage_type   as enum ('property','general_liability','umbrella','directors_officers','flood','workers_comp','other');
create type message_status  as enum ('draft','approved','sent','cancelled');

-- ============================================================================
-- CONTRACTOR PROFILES
-- ============================================================================
-- Extends `vendors` rather than creating a parallel table. A contractor IS a
-- vendor — the plumber you call is the plumber you 1099 — and splitting them
-- would mean maintaining the same W-9 status in two places.

alter table public.vendors
  add column trade          text,
  add column phone          text,
  add column contact_name   text,
  add column notes          text,
  add column is_preferred   boolean not null default false,
  add column last_used_on   date,
  add column insured_until  date,
  add column license_number text;

comment on column public.vendors.insured_until is
  'Contractor''s liability insurance expiry. Surfaced as a warning before work is assigned — an uninsured contractor on association property is the association''s problem.';

-- ============================================================================
-- MAINTENANCE TICKETS
-- ============================================================================

create table tickets (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  reference      integer not null,
  title          text not null,
  description    text,
  status         ticket_status not null default 'open',
  priority       ticket_priority not null default 'normal',

  -- Null means common area: the roof, the boiler, the hallway.
  unit_id        uuid references units(id) on delete restrict,

  reported_by    uuid references persons(id) on delete restrict,
  assigned_vendor_id uuid references vendors(id) on delete restrict,

  -- What it actually cost, once known. Linked to the expense so the ticket and
  -- the ledger cannot tell different stories.
  expense_id     uuid references expenses(id) on delete restrict,
  estimated_cost numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),

  opened_on      date not null default current_date,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),

  unique (association_id, reference),
  check ((status in ('resolved','closed')) = (resolved_at is not null))
);

create index on tickets (association_id, status, priority);
create index on tickets (association_id, unit_id);

-- Per-association ticket numbering, so a board member can say "ticket 14"
-- rather than reading out a uuid.
create or replace function public.tg_ticket_reference()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.reference is null then
    select coalesce(max(reference), 0) + 1 into new.reference
      from public.tickets where association_id = new.association_id;
  end if;
  return new;
end $$;

create trigger tickets_reference
  before insert on public.tickets
  for each row execute function public.tg_ticket_reference();

create table ticket_comments (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  ticket_id      uuid not null references tickets(id) on delete cascade,
  person_id      uuid references persons(id) on delete restrict,
  body           text not null,
  created_at     timestamptz not null default now()
);

create index on ticket_comments (ticket_id, created_at);

-- ============================================================================
-- CONTRACTOR MESSAGES — drafts, never auto-sent
-- ============================================================================

create table contractor_messages (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  vendor_id      uuid not null references vendors(id) on delete restrict,
  ticket_id      uuid references tickets(id) on delete restrict,
  subject        text not null,
  body           text not null,
  status         message_status not null default 'draft',
  to_email       text,
  created_by     uuid references auth.users(id),
  approved_by    uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,

  -- A message cannot be marked sent without an approver. The database refuses
  -- to record an unreviewed send even if application code asks it to.
  check ((status = 'sent') = (sent_at is not null)),
  check (status <> 'sent' or approved_by is not null)
);

create index on contractor_messages (association_id, status);

-- ============================================================================
-- RECURRING BILLS — tracking and reminders, NOT payment
-- ============================================================================

create table recurring_bills (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  name           text not null,
  vendor_id      uuid references vendors(id) on delete restrict,
  account_id     uuid not null references accounts(id) on delete restrict,
  fund_id        uuid not null references funds(id) on delete restrict,

  frequency      bill_frequency not null default 'monthly',
  typical_amount numeric(14,2) check (typical_amount is null or typical_amount >= 0),
  due_day        smallint check (due_day between 1 and 31),
  next_due_on    date,

  -- Records that autopay exists AT THE PROVIDER. Walkup never holds banking
  -- credentials and never initiates a payment. This column is a note to the
  -- next board about what is already arranged, so nobody double-pays or
  -- assumes a bill is handled when it is not.
  autopay_arranged boolean not null default false,
  autopay_note     text,

  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

comment on table public.recurring_bills is
  'Bill tracking and reminders. Walkup does not store payment credentials and does not initiate payments — autopay_arranged records that the board set autopay up with the utility or bank directly.';

create index on recurring_bills (association_id, next_due_on) where is_active;

-- ============================================================================
-- INSURANCE
-- ============================================================================

create table insurance_policies (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  coverage       coverage_type not null,
  carrier_name   text not null,
  broker_name    text,
  broker_email   text,
  policy_number  text,
  effective_from date not null,
  effective_to   date not null,
  annual_premium numeric(14,2) not null check (annual_premium >= 0),
  deductible     numeric(14,2) check (deductible is null or deductible >= 0),
  coverage_limit numeric(14,2) check (coverage_limit is null or coverage_limit >= 0),
  notes          text,
  created_at     timestamptz not null default now(),
  check (effective_to > effective_from)
);

create index on insurance_policies (association_id, coverage, effective_from desc);

-- What carriers offered, so next year's decision can be compared against this
-- year's. Recording offers is not advising on them.
create table insurance_quotes (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references associations(id) on delete restrict,
  coverage       coverage_type not null,
  carrier_name   text not null,
  broker_name    text,
  quoted_on      date not null,
  covers_from    date,
  annual_premium numeric(14,2) not null check (annual_premium >= 0),
  deductible     numeric(14,2) check (deductible is null or deductible >= 0),
  coverage_limit numeric(14,2) check (coverage_limit is null or coverage_limit >= 0),
  valid_until    date,
  was_selected   boolean not null default false,
  declined_reason text,
  notes          text,
  created_at     timestamptz not null default now()
);

create index on insurance_quotes (association_id, coverage, quoted_on desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table tickets             enable row level security;
alter table ticket_comments     enable row level security;
alter table contractor_messages enable row level security;
alter table recurring_bills     enable row level security;
alter table insurance_policies  enable row level security;
alter table insurance_quotes    enable row level security;

-- Owners may report a problem and follow their own, plus anything in the
-- common areas — the roof leaking is everyone's business. They may not see a
-- ticket raised about a neighbour's unit.
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    public.can_read_financials(association_id)
    or unit_id is null
    or unit_id in (select public.owned_unit_ids(association_id))
  );

create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (
    public.is_member(association_id)
    and (
      public.is_board(association_id)
      or unit_id is null
      or unit_id in (select public.owned_unit_ids(association_id))
    )
  );

create policy tickets_update on public.tickets
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (
    exists (select 1 from public.tickets t where t.id = ticket_id)
  );

create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.is_member(association_id)
    and exists (select 1 from public.tickets t where t.id = ticket_id)
  );

-- Board only. Contractor correspondence, bills, and insurance are association
-- business, not owner-facing.
do $$
declare
  t text;
  board_only text[] := array[
    'contractor_messages', 'recurring_bills', 'insurance_policies', 'insurance_quotes'
  ];
begin
  foreach t in array board_only loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.can_read_financials(association_id))', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_board(association_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_board(association_id))
         with check (public.is_board(association_id))', t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))',
      t || '_delete', t);
  end loop;
end $$;

-- ============================================================================
-- AUDIT
-- ============================================================================

do $$
declare
  t text;
  audited text[] := array[
    'tickets', 'ticket_comments', 'contractor_messages',
    'recurring_bills', 'insurance_policies', 'insurance_quotes'
  ];
begin
  foreach t in array audited loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.tg_audit()',
      'audit_' || t, t);
  end loop;
end $$;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Year-over-year premium comparison. The board's actual question at renewal is
-- "is this more than last year, and did we look around?" — so the view answers
-- both: the change, and whether any alternative quotes exist.
create view public.insurance_year_over_year
with (security_invoker = true) as
select
  p.association_id,
  p.coverage,
  p.id                                as policy_id,
  p.carrier_name,
  p.effective_from,
  p.effective_to,
  p.annual_premium::numeric(14,2)     as annual_premium,
  lag(p.annual_premium) over w        as previous_premium,
  lag(p.carrier_name)   over w        as previous_carrier,
  (p.annual_premium - lag(p.annual_premium) over w)::numeric(14,2) as change_amount,
  case
    when lag(p.annual_premium) over w is null or lag(p.annual_premium) over w = 0 then null
    else round(
      (p.annual_premium - lag(p.annual_premium) over w)
        / lag(p.annual_premium) over w * 100, 1)
  end                                 as change_percent,
  (select count(*) from public.insurance_quotes q
    where q.association_id = p.association_id
      and q.coverage = p.coverage
      and q.quoted_on between p.effective_from - interval '120 days' and p.effective_from
  )::int                              as quotes_obtained
from public.insurance_policies p
window w as (partition by p.association_id, p.coverage order by p.effective_from);

-- Bills due soon, with whether autopay is already arranged elsewhere.
create view public.upcoming_bills
with (security_invoker = true) as
select
  b.id, b.association_id, b.name, b.frequency,
  b.typical_amount::numeric(14,2) as typical_amount,
  b.next_due_on,
  b.autopay_arranged,
  b.autopay_note,
  v.name as vendor_name,
  case
    when b.next_due_on is null then null
    else (b.next_due_on - current_date)
  end as days_until_due
from public.recurring_bills b
left join public.vendors v on v.id = b.vendor_id
where b.is_active;

grant select on public.insurance_year_over_year, public.upcoming_bills to authenticated;
