-- ============================================================================
-- 0088: tier changes at renewal, with their 30 days' notice (DECISIONS #44, #53)
-- ============================================================================
-- A plan is priced by a building's unit count. When the count moves a building into another tier, the Terms promise
-- the change happens only at a renewal, and only after at least 30 days' email to the board admins. This adds the
-- notice (kind 'tier_change', made by the daily run like the others in 0084) and the two service functions the run
-- needs. The change at Stripe itself is made by the run, not here, and only when it is switched on.

alter table public.billing_notices drop constraint if exists billing_notices_kind_check;
alter table public.billing_notices
  add constraint billing_notices_kind_check
  check (kind in ('price_change', 'read_only', 'early_access_end', 'founding_charge', 'tier_change'));

-- Paid, renewing subscriptions with what is needed to see whether the unit count has moved them into another tier,
-- and when (if ever) a tier-change notice for their next renewal was emailed.
create or replace function public.billing_tier_candidates()
returns table (
  association_id         uuid,
  stripe_subscription_id text,
  plan_key               text,
  billing_interval       text,
  current_period_end     timestamptz,
  unit_count             integer,
  notice_emailed_at      timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select b.association_id,
         b.stripe_subscription_id,
         b.plan_key,
         b.billing_interval,
         b.current_period_end,
         (select count(*)::integer from public.units u where u.association_id = b.association_id),
         (select n.emailed_at
            from public.billing_notices n
           where n.association_id = b.association_id
             and n.kind = 'tier_change'
             and n.effective_on = (b.current_period_end at time zone 'America/Chicago')::date
           order by n.created_at desc
           limit 1)
    from public.billing_accounts b
    join public.associations a on a.id = b.association_id and a.deleted_at is null
   where b.subscription_status = 'active'
     and b.stripe_subscription_id is not null
     and b.billing_interval in ('month', 'year')
     and b.current_period_end is not null
     and not b.cancel_at_period_end
$$;

revoke all on function public.billing_tier_candidates() from public, anon, authenticated;
grant execute on function public.billing_tier_candidates() to service_role;

-- Opens the notice for one renewal. The key names the building, the new plan and the renewal day, so it is made once.
create or replace function public.billing_open_tier_notice(p_association_id uuid, p_effective_on date, p_key text, p_detail text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_key is null or p_key !~ '^tier_change:[0-9a-f-]{36}:[a-z]{1,20}:[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'bad notice key' using errcode = '22023';
  end if;
  if p_detail is null or char_length(btrim(p_detail)) not between 1 and 600 then
    raise exception 'bad notice detail' using errcode = '22023';
  end if;
  insert into public.billing_notices (association_id, kind, effective_on, detail, dedupe_key)
  select a.id, 'tier_change', p_effective_on, btrim(p_detail), p_key
    from public.associations a
   where a.id = p_association_id and a.deleted_at is null
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

revoke all on function public.billing_open_tier_notice(uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.billing_open_tier_notice(uuid, date, text, text) to service_role;
