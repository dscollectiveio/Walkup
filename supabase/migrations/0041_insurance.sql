-- ============================================================================
-- Walkup — migration 0041: insurance (your policy, claims, get quotes) and
-- the platform-admin role
--
-- Part 3 of docs/reference/build-prompt-budget-contractors-insurance-taxes.md.
--
--   * platform_admins + is_platform_admin(): a role above board_admin for
--     records shared by every association — insurance broker partners here,
--     official tax form templates in Part 4. Doug's call (2026-09-30): one
--     row, his account. Ships with NO rows; each environment's row is added
--     by hand (the accounts differ between environments), see DECISIONS #31.
--   * insurance_policies grows the declarations-page fields (named insured,
--     limits, deductibles, coverage form, agent, renewal lead time) and a
--     link to the document they were read from. Existing columns keep their
--     meaning: broker_name/broker_email are the agent's name/email,
--     `deductible`/`coverage_limit` stay the generic single figures.
--   * insurance_policy_field_sources: where every saved value came from —
--     extracted (with page, confidence, snippet), typed in, or copied from a
--     quote. The user can always see which page a number came from.
--   * insurance_claims, optionally tied to the repair (ticket) behind them.
--   * insurance_partners: global, platform-admin managed, ships EMPTY — Walkup
--     never invents a broker. insurance_quote_requests tracks each request;
--     insurance_quotes (0013) gains the same limits/deductibles plus a link
--     to its request and its document.
--   * associations gains the building facts a quote request needs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Platform admin
-- ----------------------------------------------------------------------------

create table public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete restrict,
  added_at timestamptz not null default now(),
  note     text
);

-- No policies: nobody reads or writes this table through the API. It's
-- consulted only via is_platform_admin(), and rows are added by hand.
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- Building facts for quote requests
-- ----------------------------------------------------------------------------

alter table public.associations
  add column year_built         smallint check (year_built is null or year_built between 1700 and 2100),
  add column construction_type  text check (construction_type is null or construction_type in
                                  ('frame', 'joisted_masonry', 'masonry_noncombustible', 'fire_resistive', 'other')),
  add column stories            smallint check (stories is null or stories between 1 and 200),
  add column roof_replaced_year smallint check (roof_replaced_year is null or roof_replaced_year between 1700 and 2100);

-- ----------------------------------------------------------------------------
-- insurance_policies: the declarations page
-- ----------------------------------------------------------------------------

alter table public.insurance_policies
  add column named_insured            text,
  add column insured_address          text,
  add column payment_schedule         text not null default 'unknown'
                                        check (payment_schedule in ('annual', 'semi_annual', 'quarterly', 'monthly', 'unknown')),
  add column agency_name              text,
  add column agent_phone              text,
  add column building_limit           numeric(14,2) check (building_limit is null or building_limit >= 0),
  add column coverage_form            text not null default 'unknown'
                                        check (coverage_form in ('bare_walls', 'single_entity', 'all_in', 'unknown')),
  add column liability_per_occurrence numeric(14,2) check (liability_per_occurrence is null or liability_per_occurrence >= 0),
  add column liability_aggregate      numeric(14,2) check (liability_aggregate is null or liability_aggregate >= 0),
  add column do_limit                 numeric(14,2) check (do_limit is null or do_limit >= 0),
  add column umbrella_limit           numeric(14,2) check (umbrella_limit is null or umbrella_limit >= 0),
  add column ordinance_or_law         boolean,
  add column loss_assessment_limit    numeric(14,2) check (loss_assessment_limit is null or loss_assessment_limit >= 0),
  add column water_backup_limit       numeric(14,2) check (water_backup_limit is null or water_backup_limit >= 0),
  add column flood_covered            boolean,
  add column property_deductible      numeric(14,2) check (property_deductible is null or property_deductible >= 0),
  add column water_damage_deductible  numeric(14,2) check (water_damage_deductible is null or water_damage_deductible >= 0),
  add column wind_hail_deductible     numeric(14,2) check (wind_hail_deductible is null or wind_hail_deductible >= 0),
  add column per_unit_deductible      numeric(14,2) check (per_unit_deductible is null or per_unit_deductible >= 0),
  add column renewal_reminder_days    smallint not null default 60 check (renewal_reminder_days between 0 and 365),
  add column replaced_at              timestamptz,
  add column last_reviewed_at         timestamptz,
  add column last_reviewed_by         uuid references auth.users(id),
  add column source_document_id       uuid references public.documents(id) on delete set null,
  add column created_by               uuid references auth.users(id) default auth.uid();

create table public.insurance_policy_field_sources (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references public.associations(id) on delete restrict,
  policy_id        uuid not null references public.insurance_policies(id) on delete cascade,
  field_name       text not null,
  source           text not null check (source in ('extracted', 'manual', 'quote')),
  document_id      uuid references public.documents(id) on delete set null,
  page_number      smallint check (page_number is null or page_number > 0),
  confidence       numeric(6,4) check (confidence is null or confidence between 0 and 1),
  raw_text_snippet text,
  created_at       timestamptz not null default now(),
  unique (policy_id, field_name)
);

-- ----------------------------------------------------------------------------
-- Claims
-- ----------------------------------------------------------------------------

create table public.insurance_claims (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  policy_id      uuid not null references public.insurance_policies(id) on delete restrict,
  ticket_id      uuid references public.tickets(id) on delete set null,
  date_of_loss   date not null,
  claim_number   text,
  description    text not null,
  amount_claimed numeric(14,2) check (amount_claimed is null or amount_claimed >= 0),
  amount_paid    numeric(14,2) check (amount_paid is null or amount_paid >= 0),
  status         text not null default 'open' check (status in ('open', 'paid', 'denied', 'withdrawn')),
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.insurance_claims (association_id, date_of_loss desc);

-- ----------------------------------------------------------------------------
-- Get quotes
-- ----------------------------------------------------------------------------

create table public.insurance_partners (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_email text not null,
  phone         text,
  states_served text[] not null default '{}',
  active        boolean not null default true,
  notes         text,
  created_at    timestamptz not null default now()
);

create table public.insurance_quote_requests (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  policy_id      uuid references public.insurance_policies(id) on delete set null,
  partner_id     uuid not null references public.insurance_partners(id) on delete restrict,
  payload_json   jsonb not null,
  status         text not null default 'draft'
                   check (status in ('draft', 'sent', 'quote_received', 'declined', 'expired', 'accepted')),
  sent_at        timestamptz,
  responded_at   timestamptz,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (status = 'draft' or sent_at is not null)
);

create index on public.insurance_quote_requests (association_id, created_at desc);

alter table public.insurance_quotes
  add column quote_request_id         uuid references public.insurance_quote_requests(id) on delete set null,
  add column document_id              uuid references public.documents(id) on delete set null,
  add column building_limit           numeric(14,2) check (building_limit is null or building_limit >= 0),
  add column coverage_form            text not null default 'unknown'
                                        check (coverage_form in ('bare_walls', 'single_entity', 'all_in', 'unknown')),
  add column liability_per_occurrence numeric(14,2) check (liability_per_occurrence is null or liability_per_occurrence >= 0),
  add column liability_aggregate      numeric(14,2) check (liability_aggregate is null or liability_aggregate >= 0),
  add column do_limit                 numeric(14,2) check (do_limit is null or do_limit >= 0),
  add column umbrella_limit           numeric(14,2) check (umbrella_limit is null or umbrella_limit >= 0),
  add column ordinance_or_law         boolean,
  add column loss_assessment_limit    numeric(14,2) check (loss_assessment_limit is null or loss_assessment_limit >= 0),
  add column water_backup_limit       numeric(14,2) check (water_backup_limit is null or water_backup_limit >= 0),
  add column flood_covered            boolean,
  add column property_deductible      numeric(14,2) check (property_deductible is null or property_deductible >= 0),
  add column water_damage_deductible  numeric(14,2) check (water_damage_deductible is null or water_damage_deductible >= 0),
  add column wind_hail_deductible     numeric(14,2) check (wind_hail_deductible is null or wind_hail_deductible >= 0),
  add column per_unit_deductible      numeric(14,2) check (per_unit_deductible is null or per_unit_deductible >= 0);

-- ----------------------------------------------------------------------------
-- Same-association guards (the FKs alone don't prevent pointing across tenants)
-- ----------------------------------------------------------------------------

create or replace function public.tg_insurance_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- All three tables carry policy_id (nullable on quote requests).
  if new.policy_id is not null and not exists (
    select 1 from public.insurance_policies p where p.id = new.policy_id and p.association_id = new.association_id
  ) then
    raise exception 'policy belongs to a different association' using errcode = '42501';
  end if;
  -- Nested, not AND-ed: only claims have ticket_id, and plpgsql would still
  -- resolve new.ticket_id on the other tables inside a single expression.
  if tg_table_name = 'insurance_claims' then
    if new.ticket_id is not null and not exists (
      select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id
    ) then
      raise exception 'repair belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger insurance_field_sources_same_association
  before insert or update on public.insurance_policy_field_sources
  for each row execute function public.tg_insurance_same_association();
create trigger insurance_claims_same_association
  before insert or update on public.insurance_claims
  for each row execute function public.tg_insurance_same_association();
create trigger insurance_quote_requests_same_association
  before insert or update on public.insurance_quote_requests
  for each row execute function public.tg_insurance_same_association();

-- ----------------------------------------------------------------------------
-- RLS — same shape as the 0013 insurance tables: board and accountant read,
-- board writes, board_admin deletes.
-- ----------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array['insurance_policy_field_sources', 'insurance_claims', 'insurance_quote_requests'];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.can_read_financials(association_id))', t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.is_board(association_id))', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.is_board(association_id))
         with check (public.is_board(association_id))', t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.has_role_in(association_id, array[''board_admin'']::public.app_role[]))',
      t || '_delete', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.tg_audit()', 'audit_' || t, t);
  end loop;
end $$;

-- Partners: any signed-in board can see active partners (their names appear
-- on the consent line); only a platform admin can see inactive ones or change
-- anything.
alter table public.insurance_partners enable row level security;

create policy insurance_partners_select on public.insurance_partners
  for select to authenticated using (active or public.is_platform_admin());
create policy insurance_partners_insert on public.insurance_partners
  for insert to authenticated with check (public.is_platform_admin());
create policy insurance_partners_update on public.insurance_partners
  for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy insurance_partners_delete on public.insurance_partners
  for delete to authenticated using (public.is_platform_admin());

-- Not on tg_audit(): the audit log is scoped per association and this table
-- belongs to none. It holds public broker contact details, nothing tenant-owned.
