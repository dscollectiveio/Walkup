-- 0078: MFA recovery codes (docs/DECISIONS.md #46).
--   Ten single-use codes per account, created when a verified authenticator is enrolled and on request
--   from Account > Security. Only a salted scrypt hash is stored (computed by the app: the database has no
--   scrypt). A person who lost their authenticator redeems a code at sign-in, which removes their
--   authenticator factor so they can enrol a new one. Wrong codes are counted in the database: 5 wrong
--   attempts lock redemption for 15 minutes.
--
--   Nothing here uses the service key. The factor removal is inside mfa_recovery_redeem, which runs as the
--   function owner and deletes only the caller's own rows in auth.mfa_factors.

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create table public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  salt       text not null,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);

create table public.mfa_recovery_lockouts (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_lockouts enable row level security;

-- A person sees only their own rows, and only the harmless columns: never the salt or the hash.
-- Every write goes through the functions below.
create policy mfa_recovery_codes_select on public.mfa_recovery_codes
  for select to authenticated using (user_id = auth.uid());

revoke all on public.mfa_recovery_codes from public, anon, authenticated;
grant select (id, user_id, created_at, used_at) on public.mfa_recovery_codes to authenticated;
-- The lockout table has no policy and no grant: it is reached only through the functions.
revoke all on public.mfa_recovery_lockouts from public, anon, authenticated;

comment on table public.mfa_recovery_codes is
  'Salted scrypt hashes of a login''s MFA recovery codes. Users read id/used_at only; all writes via mfa_recovery_* functions.';
comment on table public.mfa_recovery_lockouts is
  'Failed recovery-code attempts per login. No policy and no grant: only mfa_recovery_redeem touches it.';

-- ----------------------------------------------------------------------------
-- 2. Freshness: seconds since this session last entered an authenticator code
-- ----------------------------------------------------------------------------

create or replace function public.mfa_totp_age_seconds()
returns bigint
language sql stable set search_path = '' as $$
  select (extract(epoch from now()) - max((e ->> 'timestamp')::numeric))::bigint
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
   where e ->> 'method' = 'totp'
     and (e ->> 'timestamp') ~ '^[0-9]+(\.[0-9]+)?$'
$$;

-- ----------------------------------------------------------------------------
-- 3. Create or replace the ten codes (needs a two-step code entered in the last 15 minutes)
-- ----------------------------------------------------------------------------

create or replace function public.mfa_recovery_set_codes(p_salts text[], p_hashes text[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_age bigint;
  i     integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.session_is_aal2() then
    raise exception 'confirm your two-step sign-in first' using errcode = '42501';
  end if;
  v_age := public.mfa_totp_age_seconds();
  if v_age is null or v_age > 900 or v_age < -60 then
    raise exception 'enter a fresh code from your authenticator app first' using errcode = '42501';
  end if;
  if p_salts is null or p_hashes is null
     or coalesce(array_length(p_salts, 1), 0) <> 10 or coalesce(array_length(p_hashes, 1), 0) <> 10 then
    raise exception 'exactly ten codes are required' using errcode = 'check_violation';
  end if;

  delete from public.mfa_recovery_codes where user_id = v_uid;
  for i in 1 .. 10 loop
    if p_salts[i] is null or btrim(p_salts[i]) = '' or p_hashes[i] is null or btrim(p_hashes[i]) = '' then
      raise exception 'malformed recovery code' using errcode = 'check_violation';
    end if;
    insert into public.mfa_recovery_codes (user_id, salt, code_hash) values (v_uid, p_salts[i], p_hashes[i]);
  end loop;

  -- New codes, clean slate.
  delete from public.mfa_recovery_lockouts where user_id = v_uid;
  return 10;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Status and salts (callable with a password-only session: that is who needs them)
-- ----------------------------------------------------------------------------

create or replace function public.mfa_recovery_status()
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'total',        (select count(*) from public.mfa_recovery_codes where user_id = auth.uid()),
    'remaining',    (select count(*) from public.mfa_recovery_codes where user_id = auth.uid() and used_at is null),
    'locked_until', (select locked_until from public.mfa_recovery_lockouts
                      where user_id = auth.uid() and locked_until > now())
  )
$$;

-- Salts are not secret; they let the app compute the digests it submits. Nothing is returned while locked.
create or replace function public.mfa_recovery_salts()
returns table (code_id uuid, salt text)
language sql stable security definer set search_path = '' as $$
  select c.id, c.salt
    from public.mfa_recovery_codes c
   where c.user_id = auth.uid()
     and c.used_at is null
     and not exists (select 1 from public.mfa_recovery_lockouts l where l.user_id = auth.uid() and l.locked_until > now())
   order by c.created_at, c.id
$$;

-- ----------------------------------------------------------------------------
-- 5. Redeem a code: spend it and remove the caller's authenticator factors
-- ----------------------------------------------------------------------------
-- p_digests is the typed code hashed once per unused salt. Returns
--   {ok: true}                                   code accepted, factors removed
--   {ok: false, reason: 'locked', locked_until}  too many wrong attempts
--   {ok: false, reason: 'wrong', attempts_left}  no match
-- A wrong code is returned, not raised, so the count survives the call.

create or replace function public.mfa_recovery_redeem(p_digests text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  v_lock    public.mfa_recovery_lockouts%rowtype;
  v_code_id uuid;
  v_failed  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_digests is null or coalesce(array_length(p_digests, 1), 0) > 10 then
    raise exception 'malformed request' using errcode = 'check_violation';
  end if;

  insert into public.mfa_recovery_lockouts (user_id) values (v_uid) on conflict (user_id) do nothing;
  select * into v_lock from public.mfa_recovery_lockouts where user_id = v_uid for update;

  if v_lock.locked_until is not null and v_lock.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_lock.locked_until);
  end if;
  if v_lock.locked_until is not null then
    -- The lock ran out: start counting again.
    update public.mfa_recovery_lockouts set failed_count = 0, locked_until = null, updated_at = now() where user_id = v_uid;
    v_lock.failed_count := 0;
  end if;

  select c.id into v_code_id
    from public.mfa_recovery_codes c
   where c.user_id = v_uid and c.used_at is null and c.code_hash = any (p_digests)
   limit 1
   for update;

  if v_code_id is not null then
    update public.mfa_recovery_codes set used_at = now() where id = v_code_id;
    -- Same effect as unenrolling the authenticator, which a locked-out person cannot do themselves.
    delete from auth.mfa_factors where user_id = v_uid;
    update public.mfa_recovery_lockouts set failed_count = 0, locked_until = null, updated_at = now() where user_id = v_uid;
    return jsonb_build_object('ok', true);
  end if;

  v_failed := v_lock.failed_count + 1;
  if v_failed >= 5 then
    update public.mfa_recovery_lockouts
       set failed_count = 0, locked_until = now() + interval '15 minutes', updated_at = now()
     where user_id = v_uid;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + interval '15 minutes');
  end if;
  update public.mfa_recovery_lockouts set failed_count = v_failed, updated_at = now() where user_id = v_uid;
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'attempts_left', 5 - v_failed);
end $$;

-- ----------------------------------------------------------------------------
-- 6. Who may run what
-- ----------------------------------------------------------------------------

revoke all on function public.mfa_totp_age_seconds() from public, anon;
revoke all on function public.mfa_recovery_set_codes(text[], text[]) from public, anon;
revoke all on function public.mfa_recovery_status() from public, anon;
revoke all on function public.mfa_recovery_salts() from public, anon;
revoke all on function public.mfa_recovery_redeem(text[]) from public, anon;

grant execute on function public.mfa_totp_age_seconds() to authenticated;
grant execute on function public.mfa_recovery_set_codes(text[], text[]) to authenticated;
grant execute on function public.mfa_recovery_status() to authenticated;
grant execute on function public.mfa_recovery_salts() to authenticated;
grant execute on function public.mfa_recovery_redeem(text[]) to authenticated;
