-- ============================================================================
-- Walkup — migration 0036: posting a categorized bank transaction
--
-- Companion to 0035. Three functions:
--
--   post_bank_transaction(id)   — categorized row → real ledger entry, once.
--   reverse_journal_entry(id)   — mirror-image entry; the ledger's only undo.
--   unpost_bank_transaction(id) — reverse + drop the subsidiary row, so the
--                                 bank row can be re-categorized and re-posted.
--
-- post_bank_transaction deliberately routes through the EXISTING RPCs
-- rather than writing journal lines itself wherever a subsidiary table
-- exists: record_expense() also writes `expenses` (which /budget's monthly
-- actuals, the home dashboard, and the 1099 view read), and record_payment()
-- also writes `payments` + `payment_allocations` (which unit balances and
-- delinquency read). A journal-only expense would balance perfectly and
-- still be invisible to the budget page. Only the two cases with no
-- subsidiary table — non-dues income, and cash-to-cash transfers — go
-- straight to post_journal_entry().
--
-- Dues are cash-basis unless there's something to apply them to: if the unit
-- has open assessment charges the deposit is a payment against them (FIFO by
-- due date, via record_payment); if it has none, the deposit is assessment
-- income on the day it landed (debit cash / credit 4000, unit_id on both
-- lines). Both are correct for the 1120-H, which is filed on the cash
-- method and reads movements across cash accounts (DECISIONS #1).
--
-- Every function checks its own authorization. None of them is ever called
-- from the cron route: an unattended process with no human behind it does
-- not write to a tax-relevant ledger. Auto-post rules fire only inside a
-- board member's own manual sync or "post all ready" action — see
-- DECISIONS #29.
-- ============================================================================

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

  if not public.has_role_in(t.association_id, array['board_admin']::public.app_role[]) then
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
grant execute on function public.post_bank_transaction(uuid) to authenticated;

-- ----------------------------------------------------------------------------

create or replace function public.reverse_journal_entry(p_entry_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  e     public.journal_entries%rowtype;
  v_new uuid;
begin
  select * into e from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'journal entry not found';
  end if;
  if not public.is_board(e.association_id) then
    raise exception 'not authorized to reverse entries for this association'
      using errcode = '42501';
  end if;
  if not e.is_posted then
    raise exception 'only a posted entry can be reversed';
  end if;
  if exists (select 1 from public.journal_entries where reverses_entry_id = e.id) then
    raise exception 'this entry has already been reversed';
  end if;

  -- Same date and fiscal year as the original, so the pair nets to zero in
  -- the period the mistake was made, not the period it was noticed.
  -- Unposted first, then lines, then post — journal_lines_immutable only
  -- permits line inserts against an unposted entry (0003).
  insert into public.journal_entries (
    association_id, fiscal_year_id, entry_date, memo, source, source_id,
    reverses_entry_id, is_posted, created_by
  ) values (
    e.association_id, e.fiscal_year_id, e.entry_date,
    'Reversal: ' || coalesce(e.memo, ''), 'reversal', e.source_id,
    e.id, false, auth.uid()
  ) returning id into v_new;

  insert into public.journal_lines (
    association_id, journal_entry_id, account_id, fund_id, unit_id, debit, credit, line_memo
  )
  select association_id, v_new, account_id, fund_id, unit_id, credit, debit, line_memo
    from public.journal_lines
   where journal_entry_id = e.id;

  update public.journal_entries
     set is_posted = true, posted_at = now(), posted_by = auth.uid()
   where id = v_new;

  return v_new;
end $$;

revoke all on function public.reverse_journal_entry(uuid) from public, anon;
grant execute on function public.reverse_journal_entry(uuid) to authenticated;

-- ----------------------------------------------------------------------------

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
  if not public.has_role_in(t.association_id, array['board_admin']::public.app_role[]) then
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
grant execute on function public.unpost_bank_transaction(uuid) to authenticated;
