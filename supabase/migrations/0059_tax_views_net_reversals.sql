-- ============================================================================
-- Walkup — migration 0059: the cash-basis tax views net out reversals and
-- count every dollar of cash received
--
-- WHY (1, reversals). The import work (docs/specs/progress/N1-import.md) found
-- that the two cash-basis tax views count an entry and never look at whether
-- it was reversed. A reversal (reverse_journal_entry, 0036: same date, debits
-- and credits swapped) matches neither view's branch, so the ORIGINAL entry
-- kept counting. A 100.00 exempt deposit that was reversed still showed
-- exempt_income 100.00 in form_1120h_figures, and the bank feed's "unpost"
-- had the same flaw.
--
-- WHAT (1). Reversal entries themselves are skipped, and an original counts
-- only if the chain of posted reversals hanging off it is even in length
-- (none, or reversed-and-reversed-again). reverse_journal_entry lets a
-- reversal be reversed, which re-instates the original in the ledger; the
-- views now follow the ledger: original + reversal + re-reversal counts the
-- original once, and so on for any depth. (A function-level refusal, as
-- REVIEW-4 #3 sketched, was rejected: the ledger and the tax figures must
-- agree whatever is posted, and rows from the live 0036 function may exist.)
--
-- WHY (2, unapplied cash; REVIEW-4 #1, blocker). cash_basis_receipts (0022)
-- saw only the part of a payment that payment_allocations ties to a charge.
-- Cash received and not applied (an over-payment, a prepayment, a payment
-- recorded before the charge exists, an allocation to a charge with no ledger
-- entry) never reached the view, so Form 1120-H income and the 60% test were
-- understated. DECISIONS #1 and #3: the tax basis is cash received, in the year
-- received, whether or not it is applied to a charge.
--
-- WHAT (2). A third branch, basis 'unapplied': payment amount minus the part
-- already counted through its allocations, dated at the payment. The two
-- branches always sum to the payment, so applying cash later only moves it
-- from 'unapplied' to 'assessment' (never double counted, never dropped).
-- CLASSIFICATION RULE (documented decision): the unapplied remainder is
-- income of the same account the unit's dues post to, because that is what a
-- prepayment is (a payment of future dues). Account chosen, in order:
--   1. income account of the unit's most recent assessment-type charge,
--   2. else of the association's most recent assessment-type charge,
--   3. else the association's lowest-code income account flagged exempt
--      function income, and failing that its lowest-code income account.
-- It therefore follows that account's exempt / non-exempt flag (and a per-line
-- override on the payment's cash line, tax_line_classifications) exactly like
-- applied cash. It is never silently exempt: the account flag is the one the
-- board confirmed in the Tax Center, and basis = 'unapplied' lets the
-- Tax Center and reconciliation show it as its own kind of receipt. An
-- association with no income account at all has nothing to classify under
-- (and no chart to file from).
-- Also: each charge now contributes ONE income line per allocation (the
-- largest credit), so a charge entry with two income lines cannot double count.
-- ============================================================================

create or replace view public.cash_basis_receipts
with (security_invoker = true) as

-- 1. Cash applied to a charge, classified by the charge's income line.
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
join lateral (
  select l.id, l.account_id
    from public.journal_lines l
    join public.accounts a on a.id = l.account_id and a.type = 'income'
   where l.journal_entry_id = c.journal_entry_id and l.credit > 0
   order by l.credit desc, l.id
   limit 1) cl on true
join public.accounts inc            on inc.id = cl.account_id
left join public.tax_line_classifications ovr on ovr.journal_line_id = cl.id
where e.is_posted
  and e.reverses_entry_id is null
  and (with recursive chain(id) as (
          select e.id
          union all
          select r.id from public.journal_entries r
            join chain on r.reverses_entry_id = chain.id
           where r.is_posted)
        select count(*) from chain) % 2 = 1

union all

-- 2. Cash booked straight to an income account (interest, laundry, deposits).
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
where e.is_posted
  and e.reverses_entry_id is null
  and (with recursive chain(id) as (
          select e.id
          union all
          select r.id from public.journal_entries r
            join chain on r.reverses_entry_id = chain.id
           where r.is_posted)
        select count(*) from chain) % 2 = 1

union all

-- 3. Cash received and not applied to a charge (REVIEW-4 #1): the payment
--    minus the part branch 1 already counts. Classified as dues income (see
--    the header for the rule).
select
  p.association_id,
  e.fiscal_year_id,
  p.received_on,
  inc.id,
  inc.code,
  inc.name,
  coalesce(ovr.is_exempt, inc.is_exempt_function_income),
  (p.amount - ap.applied)::numeric(14,2),
  'unapplied'::text,
  cl.id
from public.payments p
join public.journal_entries e on e.id = p.journal_entry_id
join lateral (
  select l.id
    from public.journal_lines l
    join public.accounts a on a.id = l.account_id and a.is_cash_account
   where l.journal_entry_id = e.id and l.debit > 0
   order by l.debit desc, l.id
   limit 1) cl on true
cross join lateral (
  -- exactly the allocations branch 1 turns into a row
  select coalesce(sum(pa.amount), 0) as applied
    from public.payment_allocations pa
    join public.assessment_charges c on c.id = pa.charge_id
   where pa.payment_id = p.id
     and exists (
       select 1 from public.journal_lines l
         join public.accounts a on a.id = l.account_id and a.type = 'income'
        where l.journal_entry_id = c.journal_entry_id and l.credit > 0)) ap
join lateral (
  select k.account_id
    from (
      select il.account_id, 1 as pri, c2.due_on, c2.id, ''::text as code
        from public.assessment_charges c2
        join public.journal_lines il on il.journal_entry_id = c2.journal_entry_id and il.credit > 0
        join public.accounts ia on ia.id = il.account_id and ia.type = 'income'
       where c2.unit_id = p.unit_id and c2.charge_type = 'assessment'
      union all
      select il.account_id, 2, c3.due_on, c3.id, ''::text
        from public.assessment_charges c3
        join public.journal_lines il on il.journal_entry_id = c3.journal_entry_id and il.credit > 0
        join public.accounts ia on ia.id = il.account_id and ia.type = 'income'
       where c3.association_id = p.association_id and c3.charge_type = 'assessment'
      union all
      select a4.id, case when a4.is_exempt_function_income then 3 else 4 end, null::date, a4.id, a4.code
        from public.accounts a4
       where a4.association_id = p.association_id and a4.type = 'income'
    ) k
   order by k.pri, k.due_on desc nulls last, k.code, k.id
   limit 1) pick on true
join public.accounts inc on inc.id = pick.account_id
left join public.tax_line_classifications ovr on ovr.journal_line_id = cl.id
where e.is_posted
  and e.reverses_entry_id is null
  and (with recursive chain(id) as (
          select e.id
          union all
          select r.id from public.journal_entries r
            join chain on r.reverses_entry_id = chain.id
           where r.is_posted)
        select count(*) from chain) % 2 = 1
  and p.amount - ap.applied > 0;

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
  and e.reverses_entry_id is null
  and (with recursive chain(id) as (
          select e.id
          union all
          select r.id from public.journal_entries r
            join chain on r.reverses_entry_id = chain.id
           where r.is_posted)
        select count(*) from chain) % 2 = 1
  and acc.type in ('expense', 'asset');

grant select on public.cash_basis_receipts, public.cash_basis_disbursements to authenticated;
