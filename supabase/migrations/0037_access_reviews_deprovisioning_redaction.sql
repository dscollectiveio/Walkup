-- ============================================================================
-- Walkup — migration 0037: access reviews, automated deprovisioning, and
-- personal-data redaction
--
-- Three controls Plaid's security review asked Walkup to attest to by
-- 2027-03-27 (DECISIONS #30), each built as a real mechanism rather than a
-- promise in a policy document:
--
-- 1. access_reviews + record_access_review() — a board admin's periodic
--    review of who holds access is recorded as an append-only row carrying a
--    snapshot of every active grant at that moment. The home page reminds a
--    board admin when the last one is more than 90 days old. Evidence of a
--    review, not just a claim that one happens.
--
-- 2. deprovision_stale_access() — revokes access that should no longer
--    exist, automatically:
--      * an `owner` grant whose holder USED to own a unit and no longer owns
--        any (a sale or transfer closed). Owners who have never been
--        assigned a unit are left alone — an invite redeemed before the
--        board records the ownership is legitimately pending, not stale.
--      * any grant past its expires_on (accountants, 0001) — access checks
--        already refuse these (has_role_in, 0025), so this only makes the
--        revocation a recorded event instead of a silent lapse.
--    revoked_by stays null: that is how the audit log distinguishes the
--    system from a person. Runs daily from the bank-sync cron (the one
--    service-role path, DECISIONS #28 — role_grants is not the ledger, so
--    #29's "the cron never writes the books" is untouched) and at the start
--    of every recorded access review.
--
-- 3. redact_person() — removes a former member's personal details on
--    request. The persons row survives (ledger history, unit_owners, and
--    payments reference it), but its name becomes "Former member" and its
--    email, phone, mailing address, and login link are cleared. Refused
--    while the person holds any active grant or current unit ownership, and
--    refused on your own record.
--
--    The deliberate exception: audit_log rows for that person (and for
--    invites sent to their email) are scrubbed of those same fields. The
--    audit log is otherwise append-only and unreachable for update by every
--    role (0004); this function is the single path that modifies it, it
--    touches only personal-data keys, and the event itself — who changed
--    what, when — is kept. A deletion that leaves the deleted data sitting
--    in the audit log is not a deletion. DECISIONS #30.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Access reviews
-- ----------------------------------------------------------------------------

create table access_reviews (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references associations(id) on delete restrict,
  reviewed_at     timestamptz not null default now(),
  reviewed_by     uuid references auth.users(id),
  notes           text,
  -- [{person_id, full_name, role, granted_on, expires_on}] at review time.
  active_grants   jsonb not null,
  revoked_count   int not null default 0
);

create index access_reviews_association_idx on access_reviews (association_id, reviewed_at desc);

alter table access_reviews enable row level security;

-- Read by board admins. No insert/update/delete policy for anyone: rows are
-- written only by record_access_review() and never changed afterwards.
create policy access_reviews_select on public.access_reviews
  for select to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- ----------------------------------------------------------------------------
-- 2. Automated deprovisioning
-- ----------------------------------------------------------------------------

-- Internal worker. p_association_id null = every association (the cron).
-- Not granted to authenticated: board admins reach it through
-- record_access_review(), which has already checked who they are.
create or replace function public.deprovision_stale_access(p_association_id uuid default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_count int := 0;
  v_rows  int;
begin
  -- Expired grants: already inert at access time; record the revocation.
  update public.role_grants
     set revoked_at = now()
   where revoked_at is null
     and expires_on is not null
     and expires_on < current_date
     and (p_association_id is null or association_id = p_association_id);
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Owners whose ownership ended and who own nothing now.
  update public.role_grants g
     set revoked_at = now()
   where g.revoked_at is null
     and g.role = 'owner'
     and (p_association_id is null or g.association_id = p_association_id)
     and exists (
       select 1 from public.unit_owners uo
        where uo.person_id = g.person_id
          and uo.association_id = g.association_id
          and uo.effective_to is not null
          and uo.effective_to < current_date)
     and not exists (
       select 1 from public.unit_owners uo
        where uo.person_id = g.person_id
          and uo.association_id = g.association_id
          and (uo.effective_to is null or uo.effective_to >= current_date));
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  return v_count;
end $$;

revoke all on function public.deprovision_stale_access(uuid) from public, anon, authenticated;
grant execute on function public.deprovision_stale_access(uuid) to service_role;

create or replace function public.record_access_review(
  p_association_id uuid,
  p_notes text default null
)
returns public.access_reviews
language plpgsql security definer set search_path = ''
as $$
declare
  v_revoked int;
  v_review  public.access_reviews;
begin
  if not public.has_role_in(
       p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to record an access review for this association'
      using errcode = '42501';
  end if;

  -- Clean up first, so the snapshot shows access as it stands after review.
  v_revoked := public.deprovision_stale_access(p_association_id);

  insert into public.access_reviews
    (association_id, reviewed_by, notes, active_grants, revoked_count)
  select
    p_association_id,
    auth.uid(),
    nullif(trim(p_notes), ''),
    coalesce(jsonb_agg(jsonb_build_object(
      'person_id',  g.person_id,
      'full_name',  p.full_name,
      'role',       g.role,
      'granted_on', g.granted_on,
      'expires_on', g.expires_on
    ) order by p.full_name, g.role), '[]'::jsonb),
    v_revoked
  from public.role_grants g
  join public.persons p on p.id = g.person_id
  where g.association_id = p_association_id
    and g.revoked_at is null
    and (g.expires_on is null or g.expires_on >= current_date)
  returning * into v_review;

  return v_review;
end $$;

revoke all on function public.record_access_review(uuid, text) from public, anon;
grant execute on function public.record_access_review(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Personal-data redaction
-- ----------------------------------------------------------------------------

create or replace function public.redact_person(p_person_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.persons%rowtype;
begin
  select * into p from public.persons where id = p_person_id;
  if not found then
    raise exception 'person not found';
  end if;

  if not public.has_role_in(
       p.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to remove personal data for this association'
      using errcode = '42501';
  end if;

  if p.auth_user_id is not null and p.auth_user_id = auth.uid() then
    raise exception 'you can''t remove your own personal data from here';
  end if;

  if exists (
    select 1 from public.role_grants g
     where g.person_id = p.id
       and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)) then
    raise exception 'revoke this person''s access before removing their personal data';
  end if;

  if exists (
    select 1 from public.unit_owners uo
     where uo.person_id = p.id
       and (uo.effective_to is null or uo.effective_to >= current_date)) then
    raise exception 'this person still owns a unit — record the ownership change first';
  end if;

  update public.persons
     set full_name       = 'Former member',
         email           = null,
         phone           = null,
         mailing_address = null,
         auth_user_id    = null
   where id = p.id;

  if p.email is not null then
    update public.invites
       set email = null
     where association_id = p.association_id
       and lower(email) = lower(p.email);

    update public.audit_log
       set before_data = case when before_data is null then null
                              else before_data || jsonb_build_object('email', null) end,
           after_data  = case when after_data is null then null
                              else after_data  || jsonb_build_object('email', null) end
     where association_id = p.association_id
       and table_name = 'invites'
       and (lower(before_data->>'email') = lower(p.email)
         or lower(after_data->>'email')  = lower(p.email));
  end if;

  -- Includes the row the update above just wrote, whose before_data still
  -- holds everything that was removed.
  update public.audit_log
     set before_data = case when before_data is null then null
                            else before_data || jsonb_build_object(
                              'full_name', '[redacted]', 'email', null,
                              'phone', null, 'mailing_address', null) end,
         after_data  = case when after_data is null then null
                            else after_data || jsonb_build_object(
                              'full_name', case when after_data->>'full_name' = 'Former member'
                                                then 'Former member' else '[redacted]' end,
                              'email', null, 'phone', null, 'mailing_address', null) end
   where association_id = p.association_id
     and table_name = 'persons'
     and record_id = p.id;
end $$;

revoke all on function public.redact_person(uuid) from public, anon;
grant execute on function public.redact_person(uuid) to authenticated;
