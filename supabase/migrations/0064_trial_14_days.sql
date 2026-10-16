-- ============================================================================
-- 0064: the free trial is 14 days (was 30 in 0062)
-- ============================================================================
-- Only the trigger for new associations changes. A trial already running keeps
-- the end date it was promised; the platform admin can shorten or extend one
-- with billing_extend_trial. src/lib/billing/config.ts TRIAL_DAYS must match.

create or replace function public.billing_on_association_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.billing_accounts (association_id, trial_ends_at)
  values (new.id, now() + interval '14 days')
  on conflict (association_id) do nothing;
  return new;
end $$;

revoke all on function public.billing_on_association_insert() from public, anon, authenticated;
