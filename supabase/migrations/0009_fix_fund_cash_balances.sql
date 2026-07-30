-- ============================================================================
-- Walkup — migration 0009: fix fund_cash_balances
--
-- The 0008 version produced nonsense: operating showed -$1,200.00 and reserve
-- +$1,200.00 against a correct trial balance of $60,232.18.
--
-- The cause is a LEFT JOIN misused as a filter:
--
--     from funds f
--     left join journal_lines l   on l.fund_id = f.id
--     left join journal_entries e on e.id = l.journal_entry_id and e.is_posted
--     left join accounts a        on a.id = l.account_id and a.is_cash_account
--
-- Conditions in the ON clause of a LEFT JOIN do not remove rows — they only
-- decide whether the right-hand side comes back NULL. So `l` still carried
-- EVERY journal line for the fund, and sum(l.debit - l.credit) totalled the
-- whole ledger rather than just cash movements. Within-fund entries net to
-- zero, which is why the visible residue was exactly the six $200 inter-fund
-- reserve contributions.
--
-- The fix restricts the lines in a subquery, where the joins are INNER and
-- therefore actually filter, then LEFT JOINs that against funds so a fund with
-- no visible cash lines still appears with visible_lines = 0. That count is
-- what lets the UI say "not visible to you" instead of a false $0.00
-- (DECISIONS #17).
-- ============================================================================

create or replace view public.fund_cash_balances
with (security_invoker = true) as
select
  f.id            as fund_id,
  f.association_id,
  f.name,
  f.kind,
  f.is_restricted,
  count(cl.line_id)::int                    as visible_lines,
  coalesce(sum(cl.debit - cl.credit), 0)    as cash_balance
from public.funds f
left join (
  select
    l.id      as line_id,
    l.fund_id,
    l.debit,
    l.credit
  from public.journal_lines l
  join public.journal_entries e on e.id = l.journal_entry_id
  join public.accounts a        on a.id = l.account_id
  where e.is_posted
    and a.is_cash_account
) cl on cl.fund_id = f.id
group by f.id, f.association_id, f.name, f.kind, f.is_restricted;

grant select on public.fund_cash_balances to authenticated;
