-- ============================================================================
-- Walkup — migration 0017: home dashboard
--
-- Four additions for the redesigned home page, none of which change how any
-- existing number is computed:
--
-- 1. associations.reserve_target — the board's own savings goal for the
--    reserve fund, so the home page can show progress against it. Nullable:
--    no target means no meter, never a fabricated one. Set through the
--    ordinary associations UPDATE policy (board_admin), no RPC needed —
--    it is configuration, not a financial mutation.
--
-- 2. board_tasks — the manually-added half of the home checklist. The other
--    half (bank connected, insurance recorded, W-9s collected, declaration
--    uploaded) is DERIVED from the record and deliberately has no table:
--    a derived task cannot drift out of sync with reality, a stored one can.
--
-- 3-5. Three reporting views for the charts. Aggregates live in views
--    because PostgREST cannot express GROUP BY (DECISIONS #18), and the
--    money columns cross the API as text because these figures feed
--    arithmetic in the app — running balances, variances — and PostgREST
--    would otherwise serialize NUMERIC through an IEEE double
--    (DECISIONS #20). Each view exposes a count so the UI can tell
--    "no activity" from "not yours to see" (DECISIONS #17).
-- ============================================================================

alter table public.associations
  add column reserve_target numeric(14,2)
    check (reserve_target is null or reserve_target >= 0);

-- ----------------------------------------------------------------------------
-- BOARD TASKS
-- ----------------------------------------------------------------------------

create table public.board_tasks (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  title           text not null check (length(btrim(title)) > 0),
  detail          text,
  -- Who is on the hook. A person, not an auth user: board members without
  -- logins exist, and persons is already the identity table (DECISIONS #6).
  owner_person_id uuid references public.persons(id) on delete restrict,
  completed_at    timestamptz,
  completed_by    uuid,
  created_at      timestamptz not null default now(),
  created_by      uuid not null default auth.uid()
);

alter table public.board_tasks enable row level security;

-- Same audience as the rest of the association's working records: board and
-- accountant read, board writes, only board_admin deletes.
create policy board_tasks_select on public.board_tasks
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy board_tasks_insert on public.board_tasks
  for insert to authenticated
  with check (public.is_board(association_id));

create policy board_tasks_update on public.board_tasks
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy board_tasks_delete on public.board_tasks
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create trigger audit_board_tasks
  after insert or update or delete on public.board_tasks
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- REPORTING VIEWS
-- ----------------------------------------------------------------------------

-- Cash in and out per month per fund kind, from posted entries on cash
-- accounts — the same movements both 1120-H tests read (DECISIONS #3), just
-- bucketed by month instead of classified by the other leg.
create view public.monthly_cash_activity
with (security_invoker = true) as
select
  l.association_id,
  date_trunc('month', e.entry_date)::date        as month,
  f.kind                                         as fund_kind,
  count(*)::int                                  as visible_lines,
  coalesce(sum(l.debit), 0)::numeric(14,2)::text as inflow,
  coalesce(sum(l.credit), 0)::numeric(14,2)::text as outflow
from public.journal_lines l
join public.journal_entries e on e.id = l.journal_entry_id and e.is_posted
join public.accounts a        on a.id = l.account_id and a.is_cash_account
join public.funds f           on f.id = l.fund_id
group by l.association_id, date_trunc('month', e.entry_date), f.kind;

-- Dues charged vs collected, bucketed by the month the charge was DUE — so a
-- February payment against January's assessment counts toward January's
-- collection, which is what "did January's dues come in" actually asks.
-- A payment counts as on time when it arrived on or before the due date.
create view public.monthly_dues_collection
with (security_invoker = true) as
with charged as (
  select
    association_id,
    date_trunc('month', due_on)::date as month,
    count(*)::int                     as charge_count,
    sum(amount)                       as charged
  from public.assessment_charges
  group by association_id, date_trunc('month', due_on)
),
collected as (
  select
    pa.association_id,
    date_trunc('month', c.due_on)::date as month,
    sum(pa.amount)                      as collected,
    coalesce(sum(pa.amount) filter (where p.received_on <= c.due_on), 0)
                                        as collected_on_time
  from public.payment_allocations pa
  join public.payments p            on p.id = pa.payment_id
  join public.assessment_charges c  on c.id = pa.charge_id
  group by pa.association_id, date_trunc('month', c.due_on)
)
select
  coalesce(ch.association_id, co.association_id)          as association_id,
  coalesce(ch.month, co.month)                            as month,
  coalesce(ch.charge_count, 0)                            as charge_count,
  coalesce(ch.charged, 0)::numeric(14,2)::text            as charged,
  coalesce(co.collected, 0)::numeric(14,2)::text          as collected,
  coalesce(co.collected_on_time, 0)::numeric(14,2)::text  as collected_on_time
from charged ch
full outer join collected co
  on co.association_id = ch.association_id and co.month = ch.month;

-- Spending by expense account per month. The account name IS the category —
-- inventing a separate category taxonomy would mean maintaining two.
create view public.monthly_spending_by_account
with (security_invoker = true) as
select
  e.association_id,
  date_trunc('month', e.paid_on)::date           as month,
  a.name                                         as account_name,
  count(*)::int                                  as expense_count,
  coalesce(sum(e.amount), 0)::numeric(14,2)::text as total
from public.expenses e
join public.accounts a on a.id = e.account_id
group by e.association_id, date_trunc('month', e.paid_on), a.name;

grant select on
  public.monthly_cash_activity,
  public.monthly_dues_collection,
  public.monthly_spending_by_account
to authenticated;
