-- ============================================================================
-- 0087: yearly refund requests, and the offer shown before one is made
-- ============================================================================
-- The Terms (DECISIONS #44) promise a full refund of a yearly charge on request within 14 days. Walkup never moves
-- money, so a request is a note to Doug, who refunds by hand in Stripe. Before a board admin can send one, the app
-- shows an offer (DECISIONS #53: 2 free months, then $15 a month for the next 4); taking it is a request too, of
-- kind 'offer', which Doug also applies by hand.
--
--   billing_request_refund(kind, reason)  board admin only. Yearly plan, paid, within 14 days of the charge, and no
--                                         request already open.
--   billing_refund_eligibility(assoc)     board only. Whether a request can be made now, and until when.
--   billing_admin_refunds()               platform admin only. Every request, open ones first.
--   billing_resolve_refund(id, status)    platform admin only. Marks one done or dismissed.

create table public.billing_refund_requests (
  id              uuid primary key default gen_random_uuid(),
  association_id  uuid not null references public.associations(id) on delete restrict,
  kind            text not null check (kind in ('refund', 'offer')),
  reason          text check (reason is null or char_length(btrim(reason)) between 1 and 500),
  requested_by    uuid references auth.users(id) on delete set null,
  plan_key        text,
  charged_on      date,
  status          text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at      timestamptz not null default now(),
  handled_at      timestamptz,
  handled_by      uuid references auth.users(id) on delete set null
);

-- One open request per building at a time.
create unique index billing_refund_one_open on public.billing_refund_requests (association_id) where status = 'open';

alter table public.billing_refund_requests enable row level security;

create policy billing_refund_requests_select on public.billing_refund_requests
  for select to authenticated using (public.is_board(association_id));

revoke all on public.billing_refund_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.billing_refund_requests from authenticated;

create trigger billing_refund_requests_audit
  after insert or update or delete on public.billing_refund_requests
  for each row execute function public.tg_audit();

comment on table public.billing_refund_requests is
  'A board admin''s request for a yearly refund, or the retention offer they took instead. Doug acts on it by hand in Stripe. Read by the building''s board; written only by the billing_* functions.';

-- The charge date of a yearly plan: the period began one year before it ends.
create or replace function public.billing_refund_eligibility(p_association_id uuid)
returns table (
  eligible    boolean,
  charged_on  date,
  until       date,
  open_kind   text
)
language sql stable security definer set search_path = ''
as $$
  select (b.subscription_status = 'active'
          and b.billing_interval = 'year'
          and b.current_period_end is not null
          and ((b.current_period_end - interval '1 year')::date + 14) >= current_date
          and not exists (select 1 from public.billing_refund_requests r where r.association_id = b.association_id and r.status = 'open')),
         (b.current_period_end - interval '1 year')::date,
         ((b.current_period_end - interval '1 year')::date + 14),
         (select r.kind from public.billing_refund_requests r where r.association_id = b.association_id and r.status = 'open' limit 1)
    from public.billing_accounts b
   where b.association_id = p_association_id
     and public.is_board(p_association_id)
$$;

revoke all on function public.billing_refund_eligibility(uuid) from public, anon;
grant execute on function public.billing_refund_eligibility(uuid) to authenticated;

create or replace function public.billing_request_refund(p_association_id uuid, p_kind text, p_reason text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_b  public.billing_accounts%rowtype;
  v_id uuid;
  v_charged date;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'Only a board admin can ask for a refund.' using errcode = '42501';
  end if;
  if p_kind not in ('refund', 'offer') then
    raise exception 'Choose a refund or the offer.' using errcode = '22023';
  end if;
  if p_reason is not null and char_length(btrim(p_reason)) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = '22023';
  end if;
  select * into v_b from public.billing_accounts where association_id = p_association_id;
  if not found or v_b.subscription_status is distinct from 'active' or v_b.billing_interval is distinct from 'year' or v_b.current_period_end is null then
    raise exception 'Refunds are for yearly plans that have been paid.' using errcode = '22023';
  end if;
  v_charged := (v_b.current_period_end - interval '1 year')::date;
  if v_charged + 14 < current_date then
    raise exception 'The 14 days to ask for a refund of this charge have passed.' using errcode = '22023';
  end if;
  if exists (select 1 from public.billing_refund_requests r where r.association_id = p_association_id and r.status = 'open') then
    raise exception 'A request for this building is already open.' using errcode = '23505';
  end if;
  insert into public.billing_refund_requests (association_id, kind, reason, requested_by, plan_key, charged_on)
  values (p_association_id, p_kind, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(), v_b.plan_key, v_charged)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.billing_request_refund(uuid, text, text) from public, anon;
grant execute on function public.billing_request_refund(uuid, text, text) to authenticated;

create or replace function public.billing_admin_refunds()
returns table (
  id             uuid,
  association_id uuid,
  display_name   text,
  kind           text,
  reason         text,
  plan_key       text,
  charged_on     date,
  status         text,
  created_at     timestamptz,
  requested_by   text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can see every refund request.' using errcode = '42501';
  end if;
  return query
  select r.id, r.association_id, a.display_name, r.kind, r.reason, r.plan_key, r.charged_on, r.status, r.created_at,
         (select p.full_name from public.persons p where p.auth_user_id = r.requested_by and p.association_id = r.association_id limit 1)
    from public.billing_refund_requests r
    join public.associations a on a.id = r.association_id
   order by (r.status = 'open') desc, r.created_at desc
   limit 100;
end $$;

revoke all on function public.billing_admin_refunds() from public, anon;
grant execute on function public.billing_admin_refunds() to authenticated;

create or replace function public.billing_resolve_refund(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin can handle a refund request.' using errcode = '42501';
  end if;
  if p_status not in ('done', 'dismissed') then
    raise exception 'Mark it done or dismissed.' using errcode = '22023';
  end if;
  update public.billing_refund_requests
     set status = p_status, handled_at = now(), handled_by = auth.uid()
   where id = p_id and status = 'open';
end $$;

revoke all on function public.billing_resolve_refund(uuid, text) from public, anon;
grant execute on function public.billing_resolve_refund(uuid, text) to authenticated;
