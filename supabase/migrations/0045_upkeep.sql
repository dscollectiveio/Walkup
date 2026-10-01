-- ============================================================================
-- Walkup — migration 0045: upkeep schedule
--
-- The Building section consolidates into one tab (Repairs & Upkeep) with
-- three views: problems (tickets, 0013), upkeep (this), contractors (0040).
-- Upkeep is the recurring care a building needs whether or not anything is
-- broken — boiler service every September, gutters in November, the
-- backflow test the city wants each year. A task carries an interval and an
-- optional preferred month; marking it done writes a log line and rolls the
-- next due date forward. Nothing here spends money or sends anything; a
-- task can point at a contractor and at the ticket it turned into.
-- ============================================================================

create table public.upkeep_tasks (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  name            text not null,
  description     text,
  interval_months smallint not null check (interval_months between 1 and 120),
  -- Preferred month for seasonal work (1–12); null means any time.
  due_month       smallint check (due_month is null or due_month between 1 and 12),
  last_done_on    date,
  next_due_on     date not null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  estimated_cost  numeric(14,2) check (estimated_cost is null or estimated_cost >= 0),
  is_active       boolean not null default true,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  check (last_done_on is null or last_done_on <= current_date + 1)
);

create index on public.upkeep_tasks (association_id, next_due_on) where is_active;

create table public.upkeep_log (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  task_id        uuid not null references public.upkeep_tasks(id) on delete cascade,
  done_on        date not null,
  vendor_id      uuid references public.vendors(id) on delete set null,
  cost           numeric(14,2) check (cost is null or cost >= 0),
  note           text,
  ticket_id      uuid references public.tickets(id) on delete set null,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now()
);

create index on public.upkeep_log (task_id, done_on desc);

comment on table public.upkeep_tasks is
  'Recurring building care on a calendar: what, how often, preferred month, who usually does it. Informational; nothing is scheduled with a contractor or paid from here.';
comment on table public.upkeep_log is
  'Each time an upkeep task was done — date, who, what it cost, and the ticket if it became one.';

alter table public.upkeep_tasks enable row level security;
alter table public.upkeep_log   enable row level security;

-- Every member can see the building's care calendar; the board maintains it.
create policy upkeep_tasks_select on public.upkeep_tasks
  for select to authenticated using (public.is_member(association_id));
create policy upkeep_tasks_insert on public.upkeep_tasks
  for insert to authenticated with check (public.is_board(association_id));
create policy upkeep_tasks_update on public.upkeep_tasks
  for update to authenticated using (public.is_board(association_id)) with check (public.is_board(association_id));
create policy upkeep_tasks_delete on public.upkeep_tasks
  for delete to authenticated using (public.is_board(association_id));

create policy upkeep_log_select on public.upkeep_log
  for select to authenticated using (public.is_member(association_id));
create policy upkeep_log_insert on public.upkeep_log
  for insert to authenticated with check (public.is_board(association_id));
create policy upkeep_log_delete on public.upkeep_log
  for delete to authenticated using (public.is_board(association_id));

-- Same-association guard for the optional links (vendor, ticket, task).
create or replace function public.tg_upkeep_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vendor_id is not null and not exists (
    select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id
  ) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  if tg_table_name = 'upkeep_log' then
    if not exists (
      select 1 from public.upkeep_tasks t where t.id = new.task_id and t.association_id = new.association_id
    ) then
      raise exception 'task belongs to a different association' using errcode = '42501';
    end if;
    if new.ticket_id is not null and not exists (
      select 1 from public.tickets k where k.id = new.ticket_id and k.association_id = new.association_id
    ) then
      raise exception 'ticket belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_upkeep_same_association() from public, anon;
grant execute on function public.tg_upkeep_same_association() to authenticated;

create trigger upkeep_tasks_same_association
  before insert or update on public.upkeep_tasks
  for each row execute function public.tg_upkeep_same_association();
create trigger upkeep_log_same_association
  before insert or update on public.upkeep_log
  for each row execute function public.tg_upkeep_same_association();

create trigger audit_upkeep_tasks after insert or update or delete on public.upkeep_tasks
  for each row execute function public.tg_audit();
create trigger audit_upkeep_log after insert or update or delete on public.upkeep_log
  for each row execute function public.tg_audit();
