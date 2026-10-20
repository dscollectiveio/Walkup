-- 0076: access plan steps 3 and 4 (docs/specs/access-audit-2026-10-20.md).
--   Officer positions (president, vice president, secretary, treasurer, director) with terms, the duties
--   the Treasurer and Secretary carry, and a one-step "change of board".
--
-- Permissions stay role based (board admin or board member). A position adds a few duties on top:
--   Treasurer ('books'):   categorize, post and un-post bank transactions, categorization rules, which
--                          fund a bank account feeds, and adding budget categories. NOT connecting or
--                          disconnecting the bank, roles, billing or email approval.
--   Secretary ('records'): approving announcement emails.
-- A board admin has every duty.

create table public.board_positions (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  person_id      uuid not null references public.persons(id) on delete restrict,
  position       text not null check (position in ('president', 'vice_president', 'secretary', 'treasurer', 'director')),
  term_start     date not null default current_date,
  term_end       date,
  ended_at       date,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  check (term_end is null or term_end >= term_start),
  check (ended_at is null or ended_at >= term_start)
);

-- One current holder of each officer position; a person holds a position once at a time.
create unique index board_positions_one_officer
  on public.board_positions (association_id, position)
  where ended_at is null and position <> 'director';
create unique index board_positions_one_person
  on public.board_positions (association_id, person_id, position)
  where ended_at is null;
create index board_positions_person_idx on public.board_positions (person_id) where ended_at is null;

create or replace function public.tg_board_position_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id) then
    raise exception 'person belongs to a different association' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from public.role_grants g
     where g.person_id = new.person_id and g.association_id = new.association_id
       and g.role in ('board_admin', 'board_member') and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)
  ) then
    raise exception 'only a board member or board admin can hold a position' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.tg_board_position_guard() from public, anon, authenticated;
create trigger board_positions_guard before insert or update on public.board_positions
  for each row execute function public.tg_board_position_guard();
create trigger audit_board_positions after insert or update or delete on public.board_positions
  for each row execute function public.tg_audit();

alter table public.board_positions enable row level security;
create policy board_positions_select on public.board_positions
  for select to authenticated using (public.can_read_financials(association_id) or public.is_board(association_id));
create policy board_positions_insert on public.board_positions
  for insert to authenticated with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
create policy board_positions_update on public.board_positions
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));
create policy board_positions_delete on public.board_positions
  for delete to authenticated using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- ----------------------------------------------------------------------------
-- Duties
-- ----------------------------------------------------------------------------

-- Is the caller a current holder of this position (and still on the board)?
create or replace function public.has_position(p_association_id uuid, p_position text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_board(p_association_id)
     and exists (
       select 1 from public.board_positions bp
        where bp.association_id = p_association_id
          and bp.person_id = public.current_person_id(p_association_id)
          and bp.position = p_position
          and bp.ended_at is null
          and (bp.term_end is null or bp.term_end >= current_date)
     )
$$;

-- A duty: a board admin has them all; 'books' also belongs to the Treasurer, 'records' to the Secretary.
create or replace function public.has_duty(p_association_id uuid, p_duty text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_role_in(p_association_id, array['board_admin']::public.app_role[])
      or (p_duty = 'books' and public.has_position(p_association_id, 'treasurer'))
      or (p_duty = 'records' and public.has_position(p_association_id, 'secretary'))
$$;

revoke all on function public.has_position(uuid, text) from public, anon;
revoke all on function public.has_duty(uuid, text) from public, anon;
grant execute on function public.has_position(uuid, text) to authenticated;
grant execute on function public.has_duty(uuid, text) to authenticated;

-- The bank feed's writing paths, from board admin only to the 'books' duty.

drop policy if exists bank_transactions_insert on public.bank_transactions;
create policy bank_transactions_insert on public.bank_transactions
  for insert to authenticated
  with check (public.has_duty(association_id, 'books'));

drop policy if exists bank_transactions_update on public.bank_transactions;
create policy bank_transactions_update on public.bank_transactions
  for update to authenticated
  using (public.has_duty(association_id, 'books'))
  with check (public.has_duty(association_id, 'books'));

drop policy if exists bank_categorization_rules_insert on public.bank_categorization_rules;
create policy bank_categorization_rules_insert on public.bank_categorization_rules
  for insert to authenticated
  with check (public.has_duty(association_id, 'books'));

drop policy if exists bank_categorization_rules_update on public.bank_categorization_rules;
create policy bank_categorization_rules_update on public.bank_categorization_rules
  for update to authenticated
  using (public.has_duty(association_id, 'books'))
  with check (public.has_duty(association_id, 'books'));

drop policy if exists bank_categorization_rules_delete on public.bank_categorization_rules;
create policy bank_categorization_rules_delete on public.bank_categorization_rules
  for delete to authenticated
  using (public.has_duty(association_id, 'books'));

drop policy if exists bank_account_funds_write on public.bank_account_funds;
create policy bank_account_funds_write on public.bank_account_funds
  for all to authenticated
  using (public.has_duty(association_id, 'books'))
  with check (public.has_duty(association_id, 'books'));

create or replace function public.post_bank_transaction(p_transaction_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t             public.bank_transactions%rowtype;
  c             public.bank_connections%rowtype;
  v_target      public.accounts%rowtype;
  v_fy          uuid;
  v_amount      numeric(14,2);
  v_entry       uuid;
  v_sub_id      uuid;
  v_ar          uuid;
  v_income      uuid;
  v_target_fund uuid;
  v_allocs      jsonb := '[]'::jsonb;
  v_remaining   numeric(14,2);
  v_apply       numeric(14,2);
  v_open        record;
begin
  select * into t from public.bank_transactions where id = p_transaction_id;
  if not found then
    raise exception 'bank transaction not found';
  end if;

  if not public.has_duty(t.association_id, 'books') then
    raise exception 'not authorized to post bank transactions for this association'
      using errcode = '42501';
  end if;

  if t.journal_entry_id is not null then
    raise exception 'this transaction is already in the books';
  end if;
  if t.pending then
    raise exception 'a pending transaction can''t be posted until the bank settles it';
  end if;
  if t.removed_at is not null then
    raise exception 'the bank retracted this transaction, so it can''t be posted';
  end if;
  if t.posting_kind is null then
    raise exception 'categorize this transaction before posting it';
  end if;

  if t.posting_kind = 'excluded' then
    update public.bank_transactions
       set excluded_at = coalesce(excluded_at, now())
     where id = t.id;
    return null;
  end if;

  select * into c from public.bank_connections where id = t.bank_connection_id;
  if c.cash_account_id is null or c.fund_id is null then
    raise exception 'this bank connection isn''t linked to a ledger cash account yet';
  end if;

  v_fy := public.ensure_fiscal_year(t.association_id, t.posted_on);
  v_amount := abs(t.amount);
  if v_amount = 0 then
    raise exception 'a zero-amount transaction has nothing to post';
  end if;

  if t.posting_kind = 'expense' then
    if t.amount >= 0 then
      raise exception 'money coming in can''t be posted as an expense';
    end if;
    select * into v_target from public.accounts where id = t.account_id;
    if v_target.type <> 'expense' then
      raise exception 'an expense posting needs an expense account';
    end if;
    v_sub_id := public.record_expense(
      t.association_id, v_fy, t.posted_on, v_amount, c.fund_id,
      c.cash_account_id, t.account_id, t.vendor_id, true, false, t.description);
    select journal_entry_id into v_entry from public.expenses where id = v_sub_id;

  elsif t.posting_kind = 'income' then
    if t.amount <= 0 then
      raise exception 'money going out can''t be posted as income';
    end if;
    select * into v_target from public.accounts where id = t.account_id;
    if v_target.type <> 'income' then
      raise exception 'an income posting needs an income account';
    end if;
    v_entry := public.post_journal_entry(
      t.association_id, v_fy, t.posted_on, t.description, 'import',
      jsonb_build_array(
        jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id, 'debit',  v_amount),
        jsonb_build_object('account_id', t.account_id,      'fund_id', c.fund_id, 'credit', v_amount)),
      t.id);

  elsif t.posting_kind = 'dues' then
    if t.amount <= 0 then
      raise exception 'money going out can''t be posted as dues';
    end if;

    v_remaining := v_amount;
    for v_open in
      select cb.id, cb.balance
        from public.charge_balances cb
       where cb.unit_id = t.matched_unit_id
         and cb.status in ('open', 'partial')
       order by cb.due_on, cb.id
    loop
      exit when v_remaining <= 0;
      v_apply := least(v_open.balance, v_remaining);
      v_allocs := v_allocs || jsonb_build_object('charge_id', v_open.id, 'amount', v_apply);
      v_remaining := v_remaining - v_apply;
    end loop;

    if jsonb_array_length(v_allocs) > 0 then
      select id into v_ar from public.accounts
       where association_id = t.association_id and code = '1200' and is_active
       limit 1;
      if v_ar is null then
        raise exception 'no Assessments Receivable (1200) account on file';
      end if;
      v_sub_id := public.record_payment(
        t.association_id, t.matched_unit_id, v_fy, t.posted_on, v_amount, c.fund_id,
        c.cash_account_id, v_ar, 'ach', t.plaid_transaction_id, v_allocs);
      select journal_entry_id into v_entry from public.payments where id = v_sub_id;
    else
      select id into v_income from public.accounts
       where association_id = t.association_id and code = '4000' and is_active
       limit 1;
      if v_income is null then
        raise exception 'no Regular Assessments (4000) account on file';
      end if;
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'import',
        jsonb_build_array(
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,
                             'unit_id', t.matched_unit_id, 'debit',  v_amount),
          jsonb_build_object('account_id', v_income,          'fund_id', c.fund_id,
                             'unit_id', t.matched_unit_id, 'credit', v_amount)),
        t.id);
    end if;

  elsif t.posting_kind = 'transfer' then
    select * into v_target from public.accounts where id = t.account_id;
    if not v_target.is_cash_account then
      raise exception 'a transfer needs a cash account on the other side';
    end if;
    if v_target.id = c.cash_account_id then
      raise exception 'a transfer can''t go to the same account it came from';
    end if;

    -- The other side's fund: the fund of whichever connection that cash
    -- account is linked to, else Reserve for an account named as such,
    -- else Operating.
    select fund_id into v_target_fund
      from public.bank_connections
     where cash_account_id = v_target.id and fund_id is not null
     order by created_at desc
     limit 1;
    if v_target_fund is null then
      select id into v_target_fund
        from public.funds
       where association_id = t.association_id
         and kind = (case when v_target.name ilike '%reserve%' then 'reserve' else 'operating' end)::public.fund_type
       limit 1;
    end if;
    if v_target_fund is null then
      raise exception 'no fund found for the other side of this transfer';
    end if;

    if t.amount < 0 then
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'transfer',
        jsonb_build_array(
          jsonb_build_object('account_id', v_target.id,       'fund_id', v_target_fund, 'debit',  v_amount),
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,     'credit', v_amount)),
        t.id);
    else
      v_entry := public.post_journal_entry(
        t.association_id, v_fy, t.posted_on, t.description, 'transfer',
        jsonb_build_array(
          jsonb_build_object('account_id', c.cash_account_id, 'fund_id', c.fund_id,     'debit',  v_amount),
          jsonb_build_object('account_id', v_target.id,       'fund_id', v_target_fund, 'credit', v_amount)),
        t.id);
    end if;
  end if;

  update public.bank_transactions set journal_entry_id = v_entry where id = t.id;
  return v_entry;
end $$;

revoke all on function public.post_bank_transaction(uuid) from public, anon;

create or replace function public.unpost_bank_transaction(p_transaction_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t     public.bank_transactions%rowtype;
  v_rev uuid;
begin
  select * into t from public.bank_transactions where id = p_transaction_id;
  if not found then
    raise exception 'bank transaction not found';
  end if;
  if not public.has_duty(t.association_id, 'books') then
    raise exception 'not authorized to unpost bank transactions for this association'
      using errcode = '42501';
  end if;
  if t.journal_entry_id is null then
    raise exception 'this transaction isn''t in the books';
  end if;

  v_rev := public.reverse_journal_entry(t.journal_entry_id);

  -- The journal keeps both halves forever; the subsidiary rows are what the
  -- budget, delinquency, and 1099 views read, and those must reflect the
  -- corrected state, not the mistaken one.
  delete from public.payments where journal_entry_id = t.journal_entry_id;
  delete from public.expenses where journal_entry_id = t.journal_entry_id;

  update public.bank_transactions set journal_entry_id = null where id = t.id;
  return v_rev;
end $$;

revoke all on function public.unpost_bank_transaction(uuid) from public, anon;

create or replace function public.create_expense_account(
  p_association_id uuid,
  p_name text
)
returns public.accounts
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_next_code text;
  v_account public.accounts;
begin
  if not public.has_duty(p_association_id, 'books') then
    raise exception 'not authorized to add a budget category for this association'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'category name is required';
  end if;

  select to_char(coalesce(max(code::int), 4990) + 10, 'FM0000')
    into v_next_code
  from public.accounts
  where association_id = p_association_id
    and type = 'expense'
    and code ~ '^[0-9]+$'
    and code::int < 5900;

  insert into public.accounts
    (association_id, code, name, type, is_cash_account, is_exempt_expenditure)
  values
    (p_association_id, v_next_code, v_name, 'expense', false, true)
  returning * into v_account;

  return v_account;
end $$;


-- Secretary: approving announcement emails.
create or replace function public.email_approve_batch(p_batch_id uuid)
returns table (queued integer, skipped integer)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  b public.email_batches%rowtype;
  o record;
  v_left integer;
  v_skip text;
  v_q integer := 0;
  v_s integer := 0;
begin
  select * into b from public.email_batches where id = p_batch_id for update;
  if not found or not (public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) or (b.kind = 'announcement' and public.has_position(b.association_id, 'secretary'))) then
    raise exception 'only a board admin can approve sending' using errcode = '42501';
  end if;
  if b.status <> 'draft' then
    raise exception 'this batch has already been approved or cancelled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.email_settings s
                  where s.association_id = b.association_id and s.sending_enabled and s.suspended_at is null) then
    raise exception 'email sending is off for this building' using errcode = '22023', hint = 'sending_off';
  end if;
  if not exists (select 1 from public.associations a where a.id = b.association_id and public.email_address_ok(lower(a.board_contact_email))) then
    raise exception 'set the board contact email first' using errcode = '22023', hint = 'no_reply_to';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email:' || b.association_id::text, 0));
  v_left := public.email_daily_remaining(b.association_id);

  for o in select * from public.email_outbox where batch_id = b.id and status = 'draft' order by created_at loop
    v_skip := public.email_skip_reason(b.association_id, o.person_id, o.to_email, o.kind, o.id);
    if v_skip is null and v_left <= 0 then v_skip := 'daily_cap'; end if;
    if v_skip is null and not exists (
         select 1 from public.persons p where p.id = o.person_id and lower(p.email) = o.to_email) then
      v_skip := 'address_changed';
    end if;
    if v_skip is null then
      update public.email_outbox set status = 'queued', queued_at = now() where id = o.id;
      perform public.email_log_event(b.association_id, o.id, o.person_id, o.to_email, o.kind, 'queued');
      v_left := v_left - 1; v_q := v_q + 1;
    else
      update public.email_outbox set status = 'skipped', skip_reason = v_skip where id = o.id;
      perform public.email_log_event(b.association_id, o.id, o.person_id, o.to_email, o.kind, 'skipped', v_skip);
      v_s := v_s + 1;
    end if;
  end loop;

  update public.email_batches set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = b.id;
  return query select v_q, v_s;
end $$;

revoke all on function public.email_approve_batch(uuid) from public, anon;
grant execute on function public.email_approve_batch(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- What owners and members see: officer titles on the board roster
-- ----------------------------------------------------------------------------

drop function if exists public.board_roster(uuid);
create function public.board_roster(p_association_id uuid)
returns table (full_name text, role text, title text)
language sql stable security definer set search_path = ''
as $$
  select p.full_name, g.role::text,
         (select string_agg(initcap(replace(bp.position, '_', ' ')), ', '
                 order by case bp.position when 'president' then 1 when 'vice_president' then 2 when 'secretary' then 3 when 'treasurer' then 4 else 5 end)
            from public.board_positions bp
           where bp.person_id = p.id and bp.association_id = p_association_id and bp.ended_at is null
             and (bp.term_end is null or bp.term_end >= current_date))
    from public.role_grants g
    join public.persons p on p.id = g.person_id
   where g.association_id = p_association_id
     and g.role in ('board_admin', 'board_member')
     and g.revoked_at is null
     and (g.expires_on is null or g.expires_on >= current_date)
     and public.is_member(p_association_id)
   order by (select min(case bp.position when 'president' then 1 when 'vice_president' then 2 when 'secretary' then 3 when 'treasurer' then 4 else 5 end)
               from public.board_positions bp
              where bp.person_id = p.id and bp.association_id = p_association_id and bp.ended_at is null) nulls last,
            (g.role = 'board_admin') desc, p.full_name
$$;
revoke all on function public.board_roster(uuid) from public, anon;
grant execute on function public.board_roster(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Change of board: one step
-- ----------------------------------------------------------------------------
-- Gives a position to a person (making them a board member if they are not on the board yet), ends the
-- previous holder's hold on an officer position, and optionally ends that person's board access too
-- (their board member role; an admin role is changed on the roster). Board admin only.

create or replace function public.change_board_position(
  p_association_id uuid,
  p_position       text,
  p_person_id      uuid,
  p_term_end       date default null,
  p_end_old_access boolean default false
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_new  uuid;
  v_old  record;
  v_end  date := coalesce(p_term_end, current_date + 730);
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can change the board' using errcode = '42501';
  end if;
  if p_position not in ('president', 'vice_president', 'secretary', 'treasurer', 'director') then
    raise exception 'unknown position' using errcode = '22023';
  end if;
  if not exists (select 1 from public.persons where id = p_person_id and association_id = p_association_id) then
    raise exception 'that person is not in this building' using errcode = '42501';
  end if;
  if v_end < current_date then
    raise exception 'the term has to end in the future' using errcode = '22023';
  end if;

  -- On the board first, so the position can be held.
  if not exists (
    select 1 from public.role_grants g
     where g.person_id = p_person_id and g.association_id = p_association_id
       and g.role in ('board_admin', 'board_member') and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)
  ) then
    insert into public.role_grants (association_id, person_id, role, granted_by)
    values (p_association_id, p_person_id, 'board_member', auth.uid())
    on conflict (association_id, person_id, role)
    do update set revoked_at = null, revoked_by = null, expires_on = null, granted_by = auth.uid();
  end if;

  -- The previous holder of an officer position steps down today.
  if p_position <> 'director' then
    for v_old in
      select id, person_id from public.board_positions
       where association_id = p_association_id and position = p_position and ended_at is null
         and person_id <> p_person_id
    loop
      update public.board_positions set ended_at = greatest(current_date, term_start) where id = v_old.id;
      if p_end_old_access and not exists (
        select 1 from public.board_positions
         where person_id = v_old.person_id and association_id = p_association_id and ended_at is null
      ) then
        update public.role_grants
           set revoked_at = now(), revoked_by = auth.uid()
         where person_id = v_old.person_id and association_id = p_association_id
           and role = 'board_member' and revoked_at is null;
      end if;
    end loop;
  end if;

  -- Already holding it: just move the term end.
  select id into v_new from public.board_positions
   where association_id = p_association_id and person_id = p_person_id and position = p_position and ended_at is null;
  if v_new is not null then
    update public.board_positions set term_end = v_end where id = v_new;
    return v_new;
  end if;

  insert into public.board_positions (association_id, person_id, position, term_start, term_end, created_by)
  values (p_association_id, p_person_id, p_position, current_date, v_end, auth.uid())
  returning id into v_new;
  return v_new;
end $$;

revoke all on function public.change_board_position(uuid, text, uuid, date, boolean) from public, anon;
grant execute on function public.change_board_position(uuid, text, uuid, date, boolean) to authenticated;

-- Stepping down without a successor.
create or replace function public.end_board_position(p_position_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  bp public.board_positions%rowtype;
begin
  select * into bp from public.board_positions where id = p_position_id;
  if not found or not public.has_role_in(bp.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can change the board' using errcode = '42501';
  end if;
  update public.board_positions set ended_at = greatest(current_date, term_start) where id = bp.id and ended_at is null;
end $$;

revoke all on function public.end_board_position(uuid) from public, anon;
grant execute on function public.end_board_position(uuid) to authenticated;
