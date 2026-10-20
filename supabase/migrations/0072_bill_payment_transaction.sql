-- Marking a bill paid now ties the payment to a transaction in the books.
-- recurring_bill_payments gets expense_id (nullable: payments recorded before
-- this have none), mark_bill_paid takes it as a sixth argument, and a guard
-- checks the payment belongs to the bill's association. The old five-argument
-- function is dropped: leaving it beside a defaulted six-argument one would
-- make five-argument calls ambiguous.

alter table public.recurring_bill_payments
  add column expense_id uuid references public.expenses(id) on delete set null;

-- One transaction pays one bill payment: two board members can't tie the same one.
create unique index recurring_bill_payments_expense_key
  on public.recurring_bill_payments (expense_id) where expense_id is not null;

comment on column public.recurring_bill_payments.expense_id is
  'The payment in the books (expenses) this bill payment is tied to. Null on payments recorded before the link existed.';

create or replace function public.tg_recurring_bill_payments_expense_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expense_id is not null then
    if tg_op = 'INSERT' or new.expense_id is distinct from old.expense_id then
      if not exists (
        select 1 from public.expenses e where e.id = new.expense_id and e.association_id = new.association_id
      ) then
        raise exception 'expense belongs to a different association' using errcode = '22023';
      end if;
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_recurring_bill_payments_expense_guard() from public, anon;
grant execute on function public.tg_recurring_bill_payments_expense_guard() to authenticated;

create trigger recurring_bill_payments_30_expense_guard
  before insert or update on public.recurring_bill_payments
  for each row execute function public.tg_recurring_bill_payments_expense_guard();

drop function public.mark_bill_paid(uuid, date, date, numeric, text);

create or replace function public.mark_bill_paid(
  p_bill_id uuid, p_due_on date, p_paid_on date, p_amount numeric default null, p_note text default null,
  p_expense_id uuid default null)
returns table (payment_id uuid, bill_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_bill public.recurring_bills%rowtype;
  v_covers date;
  v_pay uuid;
  v_next date;
begin
  -- Locked: a second call for the same bill waits, then sees the advanced
  -- next_due_on and is refused (p_due_on no longer matches); the unique
  -- index is the backstop.
  select * into v_bill from public.recurring_bills b where b.id = p_bill_id for update;
  if not found or not public.is_board(v_bill.association_id) then
    raise exception 'only a board member can mark a bill paid' using errcode = '42501';
  end if;
  if not v_bill.is_active then
    raise exception 'this bill is archived; restore it first' using errcode = '22023';
  end if;
  if v_bill.paused_at is not null then
    raise exception 'this bill is paused; resume it first' using errcode = '22023';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'America/Chicago')::date + 1
     or p_paid_on < date '2000-01-01' then
    raise exception 'pick the date it was paid' using errcode = '22023';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'the amount can''t be negative' using errcode = '22023';
  end if;

  if v_bill.next_due_on is not null and p_due_on is distinct from v_bill.next_due_on then
    raise exception 'that due date is already marked paid' using errcode = '23505';
  end if;
  v_covers := coalesce(v_bill.next_due_on, p_paid_on);

  insert into public.recurring_bill_payments (association_id, bill_id, paid_on, due_on, amount, note, expense_id)
  values (v_bill.association_id, p_bill_id, p_paid_on, v_covers, round(p_amount, 2), nullif(btrim(p_note), ''), p_expense_id)
  returning id into v_pay;

  if v_bill.insurance_policy_id is not null then
    update public.recurring_bills
       set last_paid_on = greatest(coalesce(last_paid_on, p_paid_on), p_paid_on)
     where id = p_bill_id;
    v_next := public.insurance_premium_bill_advance(p_bill_id, v_covers);
  else
    update public.recurring_bills
       set last_paid_on = greatest(coalesce(last_paid_on, p_paid_on), p_paid_on),
           next_due_on  = public.bill_next_due(v_covers, frequency, due_day)
     where id = p_bill_id
    returning next_due_on into v_next;
  end if;

  return query select v_pay, v_next;
end $$;

revoke all on function public.mark_bill_paid(uuid, date, date, numeric, text, uuid) from public, anon;
grant execute on function public.mark_bill_paid(uuid, date, date, numeric, text, uuid) to authenticated;

