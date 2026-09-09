-- ============================================================================
-- Walkup — migration 0022: Tax Center, phase 1a
--
-- Per-transaction tax-classification overrides, frozen figure provenance, and
-- finally activating the `tax_filings` table (0001_core_schema.sql:523) that
-- has existed since the very first migration but nothing has ever written to.
--
-- CLASSIFICATION OVERRIDES.
-- Every account already carries a required, CHECK-enforced default exemption
-- flag (accounts.is_exempt_function_income / is_exempt_expenditure), so there
-- is no naturally-occurring "unclassified" state in this schema. What a board
-- member can still hit is an atypical transaction posted to an otherwise-
-- uniform account (a one-off room rental posted to a normally-exempt income
-- account) that needs its own tax treatment without touching the account's
-- default for everything else.
--
-- The override cannot live as a column on journal_lines itself: a posted
-- entry's lines are immutable the moment they post (tg_line_immutable,
-- 0003_ledger.sql), which is nearly always immediately, per
-- post_journal_entry()'s own insert-then-post sequence. So it is a separate,
-- ordinarily-mutable table joined in at read time — the same shape as the
-- document hub's tag_source/review_state sitting beside otherwise-fixed
-- document rows, applied here to the ledger instead.
--
-- PROVENANCE.
-- tax_figure_provenance freezes, at compute time, which journal_lines produced
-- each number on the worksheet — so a later reclassification or a later
-- account edit never silently rewrites a saved filing's story of itself.
--
-- ACTIVATING tax_filings.
-- 0001's own deferred-work comment promised a trigger to freeze a filing once
-- locked_at is set; migration 0003 never built it. That gap is closed here,
-- for the first time this table is actually written to.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CLASSIFICATION OVERRIDES
-- ----------------------------------------------------------------------------

create table tax_line_classifications (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  journal_line_id uuid not null references journal_lines(id) on delete restrict,
  is_exempt       boolean not null,
  note            text,
  created_by      uuid references auth.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  updated_at      timestamptz,
  unique (journal_line_id)
);

-- The client-supplied association_id is never trusted: it is always
-- recomputed from the line being classified, so a board member at one
-- association can never point an override at another association's line even
-- though the INSERT policy below only tests is_board() on the row as given.
--
-- SECURITY DEFINER so this lookup always sees the real journal_line
-- regardless of the caller's own RLS visibility (DECISIONS #23) — otherwise
-- an owner or a cross-tenant caller who cannot read journal_lines at all
-- would get a confusing "does not exist" instead of the intended
-- row-level-security rejection from the INSERT policy that runs afterward.
create or replace function public.tg_line_classification_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select association_id into new.association_id
    from public.journal_lines where id = new.journal_line_id;
  if new.association_id is null then
    raise exception 'journal_line % does not exist', new.journal_line_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger tax_line_classifications_association
  before insert or update on tax_line_classifications
  for each row execute function public.tg_line_classification_association();

alter table tax_line_classifications enable row level security;

create policy tax_line_classifications_select on tax_line_classifications
  for select to authenticated using (public.can_read_financials(association_id));

create policy tax_line_classifications_insert on tax_line_classifications
  for insert to authenticated with check (public.is_board(association_id));

create policy tax_line_classifications_update on tax_line_classifications
  for update to authenticated
  using (public.is_board(association_id))
  with check (public.is_board(association_id));

create policy tax_line_classifications_delete on tax_line_classifications
  for delete to authenticated using (public.is_board(association_id));

create trigger audit_tax_line_classifications
  after insert or update or delete on tax_line_classifications
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- TEACH THE CASH-BASIS VIEWS ABOUT OVERRIDES
-- ----------------------------------------------------------------------------
-- Additive columns appended to the end of each branch's select list — legal
-- under CREATE OR REPLACE VIEW (same column names/types/order, new columns
-- only at the end), so existing grants and every downstream view survive
-- untouched. Contrast migration 0010, which had to DROP+CREATE because it
-- changed an existing column's type — not the case here.

create or replace view public.cash_basis_receipts
with (security_invoker = true) as

select
  p.association_id,
  e.fiscal_year_id,
  p.received_on                      as received_on,
  inc.id                             as income_account_id,
  inc.code                           as income_account_code,
  inc.name                           as income_account_name,
  coalesce(ovr.is_exempt, inc.is_exempt_function_income) as is_exempt,
  pa.amount                          as amount,
  'assessment'::text                 as basis,
  cl.id                              as journal_line_id
from public.payments p
join public.payment_allocations pa on pa.payment_id = p.id
join public.assessment_charges c    on c.id = pa.charge_id
join public.journal_entries e       on e.id = p.journal_entry_id
join public.journal_lines cl        on cl.journal_entry_id = c.journal_entry_id
join public.accounts inc            on inc.id = cl.account_id
                                   and inc.type = 'income'
                                   and cl.credit > 0
left join public.tax_line_classifications ovr on ovr.journal_line_id = cl.id
where e.is_posted

union all

select
  l_inc.association_id,
  e.fiscal_year_id,
  e.entry_date,
  inc.id,
  inc.code,
  inc.name,
  coalesce(ovr.is_exempt, inc.is_exempt_function_income),
  l_inc.credit,
  'direct'::text,
  l_inc.id
from public.journal_entries e
join public.journal_lines l_cash on l_cash.journal_entry_id = e.id
join public.accounts a_cash      on a_cash.id = l_cash.account_id
                                and a_cash.is_cash_account
                                and l_cash.debit > 0
join public.journal_lines l_inc  on l_inc.journal_entry_id = e.id
join public.accounts inc         on inc.id = l_inc.account_id
                                and inc.type = 'income'
                                and l_inc.credit > 0
left join public.tax_line_classifications ovr on ovr.journal_line_id = l_inc.id
where e.is_posted;

create or replace view public.cash_basis_disbursements
with (security_invoker = true) as
select
  l_debit.association_id,
  e.fiscal_year_id,
  e.entry_date                 as paid_on,
  acc.id                       as account_id,
  acc.code                     as account_code,
  acc.name                     as account_name,
  acc.type                     as account_type,
  coalesce(ovr.is_exempt, acc.is_exempt_expenditure, false) as is_exempt,
  l_debit.debit                as amount,
  l_debit.id                   as journal_line_id
from public.journal_entries e
join public.journal_lines l_cash  on l_cash.journal_entry_id = e.id
join public.accounts a_cash       on a_cash.id = l_cash.account_id
                                 and a_cash.is_cash_account
                                 and l_cash.credit > 0
join public.journal_lines l_debit on l_debit.journal_entry_id = e.id
                                 and l_debit.debit > 0
join public.accounts acc          on acc.id = l_debit.account_id
                                 and not acc.is_cash_account
left join public.tax_line_classifications ovr on ovr.journal_line_id = l_debit.id
where e.is_posted
  and acc.type in ('expense', 'asset');

-- ----------------------------------------------------------------------------
-- FIGURE PROVENANCE
-- ----------------------------------------------------------------------------

create table tax_figure_provenance (
  id                      uuid primary key default gen_random_uuid(),
  association_id          uuid not null references associations(id) on delete restrict,
  filing_id               uuid not null references tax_filings(id) on delete cascade,
  figure_key              text not null check (figure_key in (
                             'exempt_income', 'nonexempt_income', 'gross_income',
                             'exempt_expenditures', 'total_expenditures',
                             'taxable_income', 'tax_due',
                             'test_60_pct_ratio', 'test_90_pct_ratio'
                           )),
  value                   numeric(14,2),
  derivation              text not null check (derivation in ('sum', 'computed')),
  source_journal_line_ids uuid[] not null default '{}',
  formula_description     text not null,
  created_at              timestamptz not null default now(),
  unique (filing_id, figure_key)
);

alter table tax_figure_provenance enable row level security;

create policy tax_figure_provenance_select on tax_figure_provenance
  for select to authenticated using (public.can_read_financials(association_id));

-- No insert/update/delete policy for any role, for the same reason
-- journal_entries/journal_lines/tax_filings have none (0002_rls.sql:246):
-- written only by compute_and_save_tax_filing() below.

-- ----------------------------------------------------------------------------
-- FREEZE A FILING ONCE LOCKED — the trigger 0001 promised and 0003 never built
-- ----------------------------------------------------------------------------

create or replace function public.tg_tax_filing_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.locked_at is not null then
    raise exception 'tax filing % is locked and cannot be changed', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger tax_filings_immutable
  before update on tax_filings
  for each row execute function public.tg_tax_filing_immutable();

-- ----------------------------------------------------------------------------
-- COMPUTE AND SAVE — freezes a snapshot with provenance
-- ----------------------------------------------------------------------------
-- Deliberately duplicates a small amount of arithmetic against
-- src/lib/tax/form1120h.ts's computeForm1120h(): that TypeScript function
-- keeps driving the always-current, unsaved landing-page view, while this RPC
-- exists specifically to freeze a point-in-time snapshot with the journal
-- lines that produced it. Keep the two in sync by hand if the 1120-H
-- computation ever changes; a provenance-vs-TS cross-check lives in
-- tests/db/tax-center.test.ts to catch drift.

create or replace function public.compute_and_save_tax_filing(
  p_association_id uuid,
  p_fiscal_year_id uuid
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_filing              uuid;
  v_locked_at           timestamptz;
  v_exempt_income        numeric(14,2);
  v_exempt_income_lines   uuid[];
  v_nonexempt_income      numeric(14,2);
  v_nonexempt_income_lines uuid[];
  v_gross_income          numeric(14,2);
  v_gross_income_lines     uuid[];
  v_exempt_expenditures    numeric(14,2);
  v_exempt_expenditures_lines uuid[];
  v_total_expenditures     numeric(14,2);
  v_total_expenditures_lines uuid[];
  v_rate                 numeric(14,6);
  v_deduction             numeric(14,2);
  v_income_test_threshold numeric(9,6);
  v_expenditure_test_threshold numeric(9,6);
  v_income_ratio          numeric(9,6);
  v_expenditure_ratio     numeric(9,6);
  v_income_passed         boolean;
  v_expenditure_passed    boolean;
  v_taxable_income        numeric(14,2);
  v_tax_due               numeric(14,2);
  v_params_snapshot       jsonb;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to save a tax filing for this association'
      using errcode = '42501';
  end if;

  select locked_at into v_locked_at
    from public.tax_filings
   where association_id = p_association_id
     and fiscal_year_id = p_fiscal_year_id
     and form = '1120-H';

  if v_locked_at is not null then
    raise exception 'this filing is locked and cannot be recomputed'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_exempt_income, v_exempt_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_nonexempt_income, v_nonexempt_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and not is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_gross_income, v_gross_income_lines
    from public.cash_basis_receipts
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_exempt_expenditures, v_exempt_expenditures_lines
    from public.cash_basis_disbursements
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id
     and is_exempt;

  select coalesce(sum(amount), 0), coalesce(array_agg(journal_line_id), '{}')
    into v_total_expenditures, v_total_expenditures_lines
    from public.cash_basis_disbursements
   where association_id = p_association_id and fiscal_year_id = p_fiscal_year_id;

  select numeric_value into v_rate
    from public.tax_parameters
   where key = 'form_1120h_rate_condo' and effective_from <= current_date
     and (effective_to is null or effective_to > current_date);
  select numeric_value into v_deduction
    from public.tax_parameters
   where key = 'form_1120h_specific_deduction' and effective_from <= current_date
     and (effective_to is null or effective_to > current_date);
  select numeric_value into v_income_test_threshold
    from public.tax_parameters
   where key = 'form_1120h_income_test' and effective_from <= current_date
     and (effective_to is null or effective_to > current_date);
  select numeric_value into v_expenditure_test_threshold
    from public.tax_parameters
   where key = 'form_1120h_expenditure_test' and effective_from <= current_date
     and (effective_to is null or effective_to > current_date);

  if v_rate is null or v_deduction is null
     or v_income_test_threshold is null or v_expenditure_test_threshold is null then
    raise exception 'a required 1120-H tax parameter is missing from tax_parameters'
      using errcode = 'check_violation';
  end if;

  if v_gross_income = 0 then
    v_income_ratio := null; v_income_passed := true;
  else
    v_income_ratio := round(v_exempt_income / v_gross_income, 6);
    v_income_passed := v_income_ratio >= v_income_test_threshold;
  end if;

  if v_total_expenditures = 0 then
    v_expenditure_ratio := null; v_expenditure_passed := true;
  else
    v_expenditure_ratio := round(v_exempt_expenditures / v_total_expenditures, 6);
    v_expenditure_passed := v_expenditure_ratio >= v_expenditure_test_threshold;
  end if;

  v_taxable_income := greatest(0, v_nonexempt_income - v_deduction);
  v_tax_due := round(v_taxable_income * v_rate, 2);

  select jsonb_agg(to_jsonb(tp) - 'id') into v_params_snapshot
    from public.tax_parameters tp
   where key in ('form_1120h_rate_condo', 'form_1120h_specific_deduction',
                 'form_1120h_income_test', 'form_1120h_expenditure_test')
     and effective_from <= current_date
     and (effective_to is null or effective_to > current_date);

  insert into public.tax_filings (
    association_id, fiscal_year_id, form,
    exempt_income_cash, nonexempt_income_cash, gross_income_cash,
    exempt_expenditures_cash, total_expenditures_cash,
    test_60_pct_ratio, test_60_pct_passed, test_90_pct_ratio, test_90_pct_passed,
    taxable_income, tax_due, parameters_snapshot, computed_at
  ) values (
    p_association_id, p_fiscal_year_id, '1120-H',
    v_exempt_income, v_nonexempt_income, v_gross_income,
    v_exempt_expenditures, v_total_expenditures,
    v_income_ratio, v_income_passed, v_expenditure_ratio, v_expenditure_passed,
    v_taxable_income, v_tax_due, v_params_snapshot, now()
  )
  on conflict (association_id, fiscal_year_id, form) do update set
    exempt_income_cash = excluded.exempt_income_cash,
    nonexempt_income_cash = excluded.nonexempt_income_cash,
    gross_income_cash = excluded.gross_income_cash,
    exempt_expenditures_cash = excluded.exempt_expenditures_cash,
    total_expenditures_cash = excluded.total_expenditures_cash,
    test_60_pct_ratio = excluded.test_60_pct_ratio,
    test_60_pct_passed = excluded.test_60_pct_passed,
    test_90_pct_ratio = excluded.test_90_pct_ratio,
    test_90_pct_passed = excluded.test_90_pct_passed,
    taxable_income = excluded.taxable_income,
    tax_due = excluded.tax_due,
    parameters_snapshot = excluded.parameters_snapshot,
    computed_at = excluded.computed_at
  returning id into v_filing;

  delete from public.tax_figure_provenance where filing_id = v_filing;

  insert into public.tax_figure_provenance
    (association_id, filing_id, figure_key, value, derivation, source_journal_line_ids, formula_description)
  values
    (p_association_id, v_filing, 'exempt_income', v_exempt_income, 'sum',
     v_exempt_income_lines, 'sum of cash receipts classified as exempt function income'),
    (p_association_id, v_filing, 'nonexempt_income', v_nonexempt_income, 'sum',
     v_nonexempt_income_lines, 'sum of cash receipts not classified as exempt function income'),
    (p_association_id, v_filing, 'gross_income', v_gross_income, 'sum',
     v_gross_income_lines, 'sum of all cash receipts for the fiscal year'),
    (p_association_id, v_filing, 'exempt_expenditures', v_exempt_expenditures, 'sum',
     v_exempt_expenditures_lines, 'sum of cash disbursements classified as exempt expenditures'),
    (p_association_id, v_filing, 'total_expenditures', v_total_expenditures, 'sum',
     v_total_expenditures_lines, 'sum of all cash disbursements for the fiscal year'),
    (p_association_id, v_filing, 'taxable_income', v_taxable_income, 'computed',
     '{}', format('greatest(0, nonexempt_income %s - specific deduction %s)', v_nonexempt_income, v_deduction)),
    (p_association_id, v_filing, 'tax_due', v_tax_due, 'computed',
     '{}', format('taxable_income %s x rate %s', v_taxable_income, v_rate)),
    (p_association_id, v_filing, 'test_60_pct_ratio', v_income_ratio, 'computed',
     '{}', format('exempt_income %s / gross_income %s, must be >= %s', v_exempt_income, v_gross_income, v_income_test_threshold)),
    (p_association_id, v_filing, 'test_90_pct_ratio', v_expenditure_ratio, 'computed',
     '{}', format('exempt_expenditures %s / total_expenditures %s, must be >= %s', v_exempt_expenditures, v_total_expenditures, v_expenditure_test_threshold));

  return v_filing;
end $$;

revoke all on function public.compute_and_save_tax_filing(uuid, uuid) from public, anon;
grant execute on function public.compute_and_save_tax_filing(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- LOCK — mark filed, freeze forever
-- ----------------------------------------------------------------------------

create or replace function public.lock_tax_filing(
  p_filing_id uuid,
  p_filed_on  date
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_association uuid;
begin
  select association_id into v_association
    from public.tax_filings where id = p_filing_id;

  if v_association is null then
    raise exception 'tax filing % does not exist', p_filing_id
      using errcode = 'check_violation';
  end if;

  if not public.is_board(v_association) then
    raise exception 'not authorized to mark this filing as filed'
      using errcode = '42501';
  end if;

  update public.tax_filings
     set filed_on = p_filed_on, locked_at = now()
   where id = p_filing_id;
end $$;

revoke all on function public.lock_tax_filing(uuid, date) from public, anon;
grant execute on function public.lock_tax_filing(uuid, date) to authenticated;
