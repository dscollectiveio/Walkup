-- ============================================================================
-- Walkup — migration 0018: building settings
--
-- Unit specs for the roster, and the ownership-amendment RPC that DECISIONS
-- #7 already implied was needed: ownership_amendment_lines carries the same
-- deferred-trigger-across-multiple-rows shape as journal_lines
-- (tg_ownership_sums_to_100, 0003) — writing a valid amendment as two
-- separate PostgREST requests (header, then lines) is unsafe for the same
-- reason post_journal_entry exists (DECISIONS #5). record_ownership_amendment
-- below does the whole thing in one call, modeled directly on
-- post_journal_entry.
-- ============================================================================

alter table public.units
  add column square_footage smallint check (square_footage is null or square_footage > 0),
  add column bedroom_count  smallint check (bedroom_count  is null or bedroom_count  >= 0),
  -- Full and half baths as separate counts, not one numeric(3,1) — a bare
  -- decimal here would trip the "every numeric column is money or a
  -- percentage" invariant the migration test suite enforces, and two
  -- integer counts are unambiguous in a way "1.5 bathrooms" only looks like
  -- it is (a full bath plus a powder room reads the same as it should).
  add column full_bathrooms smallint check (full_bathrooms is null or full_bathrooms >= 0),
  add column half_bathrooms smallint check (half_bathrooms is null or half_bathrooms >= 0);

-- No RLS or audit-trigger changes needed: units_update (0002) is row-level,
-- not column-level, and tg_audit (0004) captures to_jsonb(new/old) on the
-- whole row — both already cover these columns for free.

-- ----------------------------------------------------------------------------
-- RECORD AN OWNERSHIP AMENDMENT
-- ----------------------------------------------------------------------------
-- The missing counterpart to post_journal_entry. Requires every unit to
-- appear in p_lines — a subset that happens to sum to 100 must never pass
-- silently, which is a worse bug than one that fails to sum to 100 at all,
-- since it would pass the deferred trigger while quietly dropping a unit.
--
-- Known residual gap, not closed here: ownership_amendments and
-- ownership_amendment_lines still carry direct is_board INSERT/UPDATE
-- policies from 0002's shared config_tables loop (unlike journal_entries/
-- journal_lines, which have no write policies at all, forcing every write
-- through post_journal_entry). A client could still bypass this RPC with two
-- raw table calls, and a header inserted with zero lines is never caught by
-- anything — tg_ownership_sums_to_100 lives only on the lines table, and an
-- amendment with no lines has nothing to sum. Closing that gap means pulling
-- these two tables out of the shared loop, a larger change than this task
-- asked for. Mitigation is discipline: the app calls this RPC exclusively.
create or replace function public.record_ownership_amendment(
  p_association_id        uuid,
  p_effective_from        date,
  p_lines                 jsonb,
  p_reason                text default null,
  p_recorded_document_ref text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_amendment  uuid;
  v_unit_count integer;
begin
  if not public.is_board(p_association_id) then
    raise exception 'not authorized to record an ownership amendment for this association'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 1 then
    raise exception 'an ownership amendment needs at least one line'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_unit_count from public.units where association_id = p_association_id;
  if jsonb_array_length(p_lines) <> v_unit_count then
    raise exception
      'an ownership amendment must cover every unit: % units in the association, % lines provided',
      v_unit_count, jsonb_array_length(p_lines)
      using errcode = 'check_violation';
  end if;

  insert into public.ownership_amendments (
    association_id, effective_from, reason, recorded_document_ref, created_by
  ) values (
    p_association_id, p_effective_from, p_reason, p_recorded_document_ref, auth.uid()
  ) returning id into v_amendment;

  insert into public.ownership_amendment_lines (
    association_id, amendment_id, unit_id, percentage
  )
  select
    p_association_id,
    v_amendment,
    (l->>'unit_id')::uuid,
    (l->>'percentage')::numeric
  from jsonb_array_elements(p_lines) l;

  -- Sum-to-100 is verified by the deferred trigger at COMMIT, not here. A
  -- caller that swallows the commit error will believe this succeeded —
  -- same caveat post_journal_entry documents for its own balance check.
  return v_amendment;
end $$;

revoke all on function public.record_ownership_amendment(
  uuid, date, jsonb, text, text) from public, anon;
grant execute on function public.record_ownership_amendment(
  uuid, date, jsonb, text, text) to authenticated;
