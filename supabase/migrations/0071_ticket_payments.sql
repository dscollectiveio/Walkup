-- A problem can be paid in more than one payment (a deposit and a balance, a
-- split invoice). ticket_expenses ties any number of payments in the books to
-- one problem. ticket_board_details.expense_id stays as "the first payment" so
-- the problem page, close-out and reports that read one keep working.
-- Board writes, board and accountant read, like the rest of ticket_board_details.

create table public.ticket_expenses (
  ticket_id      uuid not null references public.tickets(id) on delete cascade,
  expense_id     uuid not null references public.expenses(id) on delete restrict,
  association_id uuid not null references public.associations(id) on delete restrict,
  created_at     timestamptz not null default now(),
  primary key (ticket_id, expense_id)
);

create index ticket_expenses_expense_idx on public.ticket_expenses (expense_id);
create index ticket_expenses_assoc_idx   on public.ticket_expenses (association_id);

comment on table public.ticket_expenses is
  'Payments in the books tied to a problem, one row per payment, so a split payment can be linked in full. The first one is mirrored into ticket_board_details.expense_id by set_ticket_payments().';

alter table public.ticket_expenses enable row level security;

create policy ticket_expenses_select on public.ticket_expenses
  for select to authenticated using (public.can_read_financials(association_id));
create policy ticket_expenses_insert on public.ticket_expenses
  for insert to authenticated with check (public.is_board(association_id));
create policy ticket_expenses_delete on public.ticket_expenses
  for delete to authenticated using (public.is_board(association_id));

-- The ticket and the payment must both belong to the row's association.
create or replace function public.tg_ticket_expenses_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id
  ) then
    raise exception 'ticket belongs to a different association' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.expenses e where e.id = new.expense_id and e.association_id = new.association_id
  ) then
    raise exception 'expense belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_ticket_expenses_guard() from public, anon;
grant execute on function public.tg_ticket_expenses_guard() to authenticated;

create trigger ticket_expenses_guard
  before insert on public.ticket_expenses
  for each row execute function public.tg_ticket_expenses_guard();

-- What was already linked, one payment per problem, carries over.
insert into public.ticket_expenses (ticket_id, expense_id, association_id)
select d.ticket_id, d.expense_id, d.association_id
  from public.ticket_board_details d
 where d.expense_id is not null
on conflict do nothing;

-- Replaces the linked payments and the final cost in one step. SECURITY INVOKER:
-- the board's own RLS decides, and the guard triggers check the associations.
create or replace function public.set_ticket_payments(
  p_ticket_id   uuid,
  p_expense_ids uuid[],
  p_actual_cost numeric
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_assoc uuid;
  v_ids   uuid[] := coalesce(p_expense_ids, '{}');
begin
  select t.association_id into v_assoc from public.tickets t where t.id = p_ticket_id;
  if v_assoc is null then
    raise exception 'problem not found' using errcode = '22023';
  end if;
  if not public.is_board(v_assoc) then
    raise exception 'only the board can link payments' using errcode = '42501';
  end if;
  if p_actual_cost is not null and p_actual_cost < 0 then
    raise exception 'the final cost cannot be negative' using errcode = '22023';
  end if;

  delete from public.ticket_expenses where ticket_id = p_ticket_id;
  insert into public.ticket_expenses (ticket_id, expense_id, association_id)
  select p_ticket_id, x, v_assoc from (select distinct unnest(v_ids) as x) s;

  insert into public.ticket_board_details (ticket_id, association_id, actual_cost, expense_id)
  values (p_ticket_id, v_assoc, round(p_actual_cost, 2), v_ids[1])
  on conflict (ticket_id) do update
    set actual_cost = excluded.actual_cost,
        expense_id  = excluded.expense_id;
end $$;

revoke all on function public.set_ticket_payments(uuid, uuid[], numeric) from public, anon;
grant execute on function public.set_ticket_payments(uuid, uuid[], numeric) to authenticated;
