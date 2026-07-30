-- ============================================================================
-- Walkup — migration 0012: repair the balance check broken by 0007
--
-- 0007 revoked EXECUTE on check_entry_balanced from `authenticated`, reasoning
-- that Postgres does not check EXECUTE privilege when a trigger fires. That is
-- true of the trigger function itself — tg_lines_balanced — but
-- check_entry_balanced is called from inside that function as an ordinary
-- function call, and ordinary calls ARE privilege-checked against the current
-- user. At commit time the current user is `authenticated`.
--
-- Effect: every ledger write by a signed-in user failed with
--   42501 permission denied for function check_entry_balanced
-- In other words, 0007 disabled the ledger. It reached the live project.
--
-- WHY THE TEST SUITE MISSED IT
--
-- PGlite ran the same post successfully with the same privileges, so the local
-- suite stayed green. Deferred constraint triggers evidently do not resolve
-- their privilege context identically there. The harness is real Postgres for
-- DDL, constraints, policies and trigger logic — but it is not a faithful
-- model of deferred-trigger privilege resolution, and that gap can only be
-- closed against a real project. See docs/DECISIONS.md #21.
--
-- THE FIX
--
-- SECURITY DEFINER so the integrity check sees every line regardless of RLS —
-- an invariant check that depended on row visibility would be fragile — plus
-- an explicit EXECUTE grant, which is what the trigger path actually needs.
--
-- Exposure: the function returns void, takes a uuid, and raises only for an
-- unbalanced entry. No committed entry can be unbalanced, so a caller learns
-- nothing. anon remains revoked.
-- ============================================================================

create or replace function public.check_entry_balanced(p_entry uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_lines  integer;
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
begin
  if not exists (select 1 from public.journal_entries where id = p_entry) then
    return;
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lines, v_debit, v_credit
    from public.journal_lines
   where journal_entry_id = p_entry;

  if v_lines < 2 then
    raise exception
      'journal entry % has % line(s); double-entry requires at least two',
      p_entry, v_lines
      using errcode = 'check_violation';
  end if;

  if v_debit <> v_credit then
    raise exception
      'journal entry % is unbalanced: debits %, credits %, difference %',
      p_entry, v_debit, v_credit, v_debit - v_credit
      using errcode = 'check_violation';
  end if;
end $$;

revoke all on function public.check_entry_balanced(uuid) from public, anon;
grant execute on function public.check_entry_balanced(uuid) to authenticated;

-- Same trap, same fix, for the other deferred constraint triggers. These call
-- nothing beyond SQL, so they are unaffected today — but the grant makes the
-- requirement explicit rather than incidental.
grant execute on function public.tg_lines_balanced()            to authenticated;
grant execute on function public.tg_entry_balanced()            to authenticated;
grant execute on function public.tg_ownership_sums_to_100()     to authenticated;
grant execute on function public.tg_allocation_within_payment() to authenticated;
