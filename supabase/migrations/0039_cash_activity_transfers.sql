-- ============================================================================
-- Walkup — migration 0039: split transfers out of monthly cash activity
--
-- monthly_cash_activity (0017) sums every posted movement on a cash account,
-- per fund kind. A transfer between the association's own accounts (moving
-- money into the reserve, say) is two such movements: out of operating, into
-- reserve. Summed across fund kinds, the home page's "in and out" bars counted
-- that as money coming in AND going out, which it isn't.
--
-- inflow/outflow keep their meaning exactly (every cash movement — the running
-- balance depends on it). Two columns are appended with the part of each that
-- is a transfer, so callers asking "what came in / went out" can subtract it,
-- and the Budget & spending page can show money moved to the reserve as its
-- own "Saved" line. A reversal of a transfer (unposting one) is a transfer too.
--
-- create or replace view can only append columns, which is what this does.
-- ============================================================================

create or replace view public.monthly_cash_activity
with (security_invoker = true) as
with entries as (
  select
    e.id,
    e.entry_date,
    (
      e.source = 'transfer'
      or (
        e.source = 'reversal'
        and e.source_id is not null
        and exists (
          select 1 from public.journal_entries o
          where o.association_id = e.association_id
            and o.source = 'transfer'
            and o.source_id = e.source_id
        )
      )
    ) as is_transfer
  from public.journal_entries e
  where e.is_posted
)
select
  l.association_id,
  date_trunc('month', en.entry_date)::date        as month,
  f.kind                                          as fund_kind,
  count(*)::int                                   as visible_lines,
  coalesce(sum(l.debit), 0)::numeric(14,2)::text  as inflow,
  coalesce(sum(l.credit), 0)::numeric(14,2)::text as outflow,
  coalesce(sum(l.debit)  filter (where en.is_transfer), 0)::numeric(14,2)::text as transfer_inflow,
  coalesce(sum(l.credit) filter (where en.is_transfer), 0)::numeric(14,2)::text as transfer_outflow
from public.journal_lines l
join entries en        on en.id = l.journal_entry_id
join public.accounts a on a.id = l.account_id and a.is_cash_account
join public.funds f    on f.id = l.fund_id
group by l.association_id, date_trunc('month', en.entry_date), f.kind;

grant select on public.monthly_cash_activity to authenticated;
