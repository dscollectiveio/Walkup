-- ============================================================================
-- 0086: the owner's view of every building, and a note when a new one signs up
-- ============================================================================
-- Signup stays open (DECISIONS #52): anyone can create a building and become its admin. Doug, as the owner of the
-- company, wants to see every building that has signed up and who is involved in it, and to hear about a new one.
--
--   platform_buildings_overview()   platform admin only. One row per building: when it signed up, its units and
--                                   owners, and the people who hold a non-owner role (name, email, roles, when they
--                                   last signed in). Billing facts stay in billing_admin_overview().
--   platform_signup_alerts_claim()  service role only. Buildings created in the last 7 days that have not been
--                                   announced yet, with the people in them and the platform admins' emails to tell.
--   platform_signup_alert_mark()    service role only. Records that a building's alert went out.
--
-- No financial data is read here: people, roles, unit counts and dates only.

create table public.platform_signup_alerts (
  association_id uuid primary key references public.associations(id) on delete restrict,
  sent_at        timestamptz not null default now()
);

alter table public.platform_signup_alerts enable row level security;
revoke all on public.platform_signup_alerts from anon, authenticated;

comment on table public.platform_signup_alerts is
  'Which buildings the platform admins have already been told about. No policy and no grant: only the service functions touch it.';

-- The non-owner people of one building as json: name, email, roles, and when they last signed in.
create or replace function public.platform_building_people(p_association_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', x.full_name,
           'email', x.email,
           'roles', x.roles,
           'last_sign_in_at', x.last_sign_in_at
         ) order by x.full_name), '[]'::jsonb)
    from (
      select p.full_name,
             p.email,
             (select array_agg(distinct g.role::text order by g.role::text)
                from public.role_grants g
               where g.person_id = p.id and g.revoked_at is null
                 and (g.expires_on is null or g.expires_on >= current_date)
                 and g.role <> 'owner') as roles,
             (select u.last_sign_in_at from auth.users u where u.id = p.auth_user_id) as last_sign_in_at
        from public.persons p
       where p.association_id = p_association_id
         and exists (
           select 1 from public.role_grants g
            where g.person_id = p.id and g.revoked_at is null
              and (g.expires_on is null or g.expires_on >= current_date)
              and g.role <> 'owner')
    ) x
$$;

revoke all on function public.platform_building_people(uuid) from public, anon, authenticated;
grant execute on function public.platform_building_people(uuid) to service_role;

create or replace function public.platform_buildings_overview()
returns table (
  association_id uuid,
  display_name   text,
  city           text,
  state_code     text,
  created_at     timestamptz,
  deleted        boolean,
  unit_count     integer,
  owner_count    integer,
  people         jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see every building.' using errcode = '42501';
  end if;
  return query
  select a.id,
         a.display_name,
         a.city,
         a.state_code,
         a.created_at,
         a.deleted_at is not null,
         (select count(*)::integer from public.units u where u.association_id = a.id),
         (select count(distinct g.person_id)::integer from public.role_grants g
           where g.association_id = a.id and g.role = 'owner' and g.revoked_at is null
             and (g.expires_on is null or g.expires_on >= current_date)),
         public.platform_building_people(a.id)
    from public.associations a
   order by a.deleted_at is not null, a.created_at desc;
end $$;

revoke all on function public.platform_buildings_overview() from public, anon;
grant execute on function public.platform_buildings_overview() to authenticated;

-- New buildings to announce: created in the last 7 days, no alert yet. One row each, with the people in the
-- building and the emails of the platform admins to tell.
create or replace function public.platform_signup_alerts_claim()
returns table (
  association_id uuid,
  display_name   text,
  city           text,
  state_code     text,
  created_at     timestamptz,
  people         jsonb,
  recipients     text[]
)
language sql stable security definer set search_path = ''
as $$
  select a.id,
         a.display_name,
         a.city,
         a.state_code,
         a.created_at,
         public.platform_building_people(a.id),
         coalesce((select array_agg(distinct lower(btrim(u.email)))
                     from public.platform_admins pa
                     join auth.users u on u.id = pa.user_id
                    where u.email is not null), '{}'::text[])
    from public.associations a
   where a.deleted_at is null
     and a.created_at > now() - interval '7 days'
     and not exists (select 1 from public.platform_signup_alerts s where s.association_id = a.id)
   order by a.created_at
$$;

revoke all on function public.platform_signup_alerts_claim() from public, anon, authenticated;
grant execute on function public.platform_signup_alerts_claim() to service_role;

create or replace function public.platform_signup_alert_mark(p_association_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.platform_signup_alerts (association_id) values (p_association_id)
  on conflict (association_id) do nothing
$$;

revoke all on function public.platform_signup_alert_mark(uuid) from public, anon, authenticated;
grant execute on function public.platform_signup_alert_mark(uuid) to service_role;
