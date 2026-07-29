-- ============================================================================
-- Walkup — migration 0004: audit log
--
-- SECURITY DEFINER, so the trigger writes to audit_log as the table owner and
-- is not blocked by the deliberate absence of an INSERT policy in 0002.
--
-- audit_log has a SELECT policy for board_admin and nothing else. No UPDATE
-- policy, no DELETE policy, for any role. An audit log that board_admin can
-- edit is not an audit log.
-- ============================================================================

create or replace function public.tg_audit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_assoc  uuid;
  v_record uuid;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- A no-op update is not worth a row.
    if v_before = v_after then
      return new;
    end if;
  end if;

  v_record := coalesce((v_after->>'id')::uuid, (v_before->>'id')::uuid);

  -- associations is scoped by its own id, not by an association_id column.
  v_assoc := coalesce(
    (v_after->>'association_id')::uuid,
    (v_before->>'association_id')::uuid,
    case when tg_table_name = 'associations' then v_record end);

  if v_assoc is null then
    raise exception 'audit trigger on % could not determine association_id',
      tg_table_name;
  end if;

  insert into public.audit_log (
    association_id, actor_user_id, table_name, record_id,
    action, before_data, after_data
  ) values (
    v_assoc, auth.uid(), tg_table_name, v_record,
    lower(tg_op), v_before, v_after
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- Every table where a change has financial or access-control consequence.
do $$
declare
  t text;
  audited text[] := array[
    'journal_entries', 'journal_lines',
    'assessment_charges', 'payments', 'payment_allocations',
    'expenses', 'vendors',
    'assessment_schedules', 'late_fee_rules',
    'budgets', 'budget_lines',
    'accounts', 'funds', 'fiscal_years',
    'ownership_amendments', 'ownership_amendment_lines',
    'unit_owners', 'units',
    -- Who can see the books is as auditable as the books.
    'persons', 'role_grants',
    'tax_filings', 'associations'
  ];
begin
  foreach t in array audited loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.tg_audit()',
      'audit_' || t, t);
  end loop;
end $$;
