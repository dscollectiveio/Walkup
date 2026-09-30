-- ============================================================================
-- Walkup — migration 0040: contractors
--
-- Part 2 of docs/reference/build-prompt-budget-contractors-insurance-taxes.md.
--
-- Contractors stay in `vendors` (the ledger, 1099 view, bank feed and tickets
-- all point at it) — this extends that table rather than adding a second
-- one. The UI calls them contractors throughout.
--
--   * vendors: several trades, a status (preferred / okay / do not use) with
--     a required reason for "do not use", the board's own 1-5 rating, website,
--     license expiry, and the Google fields for a contractor saved from search.
--     `trade` (free text) is kept and shown; `trades` is the structured list.
--     `is_preferred` stays as a column every existing reader uses, kept in
--     step with `status` by a trigger.
--   * contractor_reviews: board-only (Doug, 2026-09-30) — owners still can't
--     read vendors, which hold W-9 and tax-ID information.
--   * contractor_search_cache: one Google result list per (association,
--     trade), reused for 24 hours so repeat searches cost nothing.
--   * google_api_calls: every live Google call, so cost can be reviewed.
--   * associations: street address, postal code and coordinates, so "near the
--     building" means something. Geocoded server-side, only when a key exists.
-- ============================================================================

alter table public.associations
  add column street_address text,
  add column postal_code    text,
  add column latitude       numeric(9,6) check (latitude is null or latitude between -90 and 90),
  add column longitude      numeric(9,6) check (longitude is null or longitude between -180 and 180);

-- ----------------------------------------------------------------------------
-- vendors
-- ----------------------------------------------------------------------------

alter table public.vendors
  add column trades             text[] not null default '{}',
  add column website_url        text,
  add column status             text not null default 'okay'
                                  check (status in ('preferred', 'okay', 'do_not_use')),
  add column do_not_use_reason  text,
  add column board_rating       smallint check (board_rating is null or board_rating between 1 and 5),
  add column license_expires_on date,
  add column source             text not null default 'manual' check (source in ('manual', 'google')),
  add column google_place_id    text,
  -- (6,4): the schema's precision for rates and ratios — a rating isn't money.
  add column google_rating      numeric(6,4) check (google_rating is null or google_rating between 0 and 5),
  add column google_review_count integer check (google_review_count is null or google_review_count >= 0),
  add column google_fetched_at  timestamptz,
  add column created_by         uuid references auth.users(id) default auth.uid(),
  add constraint vendors_do_not_use_needs_reason
    check (status <> 'do_not_use' or nullif(btrim(do_not_use_reason), '') is not null);

-- A place can be saved once per association; a manual contractor has none.
create unique index vendors_google_place_unique
  on public.vendors (association_id, google_place_id)
  where google_place_id is not null;

update public.vendors set status = 'preferred' where is_preferred;

-- Existing free-text trades mapped onto the trade list by keyword, falling
-- back to 'other'. The original text stays in `trade` and is still shown.
update public.vendors set trades = array[
  case
    when trade ~* 'plumb'                         then 'plumbing'
    when trade ~* 'electric'                      then 'electrical'
    when trade ~* 'hvac|heat|cool|furnace|boiler' then 'hvac'
    when trade ~* 'roof'                          then 'roofing'
    when trade ~* 'mason|tuckpoint|brick'         then 'masonry'
    when trade ~* 'general'                       then 'general'
    when trade ~* 'paint'                         then 'painting'
    when trade ~* 'carpent'                       then 'carpentry'
    when trade ~* 'landscap|lawn|garden'          then 'landscaping'
    when trade ~* 'snow'                          then 'snow'
    when trade ~* 'clean|janitor'                 then 'cleaning'
    when trade ~* 'pest|exterminat'               then 'pest'
    when trade ~* 'lock'                          then 'locksmith'
    when trade ~* 'appliance'                     then 'appliance'
    else 'other'
  end
]
where trade is not null and btrim(trade) <> '';

create or replace function public.tg_vendors_status_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.is_preferred := (new.status = 'preferred');
  if new.status <> 'do_not_use' then
    new.do_not_use_reason := null;
  end if;
  return new;
end $$;

create trigger vendors_status_sync
  before insert or update of status, is_preferred on public.vendors
  for each row execute function public.tg_vendors_status_sync();

-- ----------------------------------------------------------------------------
-- contractor_reviews
-- ----------------------------------------------------------------------------

create table public.contractor_reviews (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  vendor_id      uuid not null references public.vendors(id) on delete cascade,
  ticket_id      uuid references public.tickets(id) on delete set null,
  rating         smallint not null check (rating between 1 and 5),
  body           text,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now()
);

create index on public.contractor_reviews (association_id, vendor_id, created_at desc);

-- A review must belong to the same association as its contractor and repair.
create or replace function public.tg_contractor_review_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.vendors v where v.id = new.vendor_id and v.association_id = new.association_id
  ) then
    raise exception 'contractor belongs to a different association' using errcode = '42501';
  end if;
  if new.ticket_id is not null and not exists (
    select 1 from public.tickets t where t.id = new.ticket_id and t.association_id = new.association_id
  ) then
    raise exception 'repair belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger contractor_review_association
  before insert or update on public.contractor_reviews
  for each row execute function public.tg_contractor_review_association();

alter table public.contractor_reviews enable row level security;

create policy contractor_reviews_select on public.contractor_reviews
  for select to authenticated using (public.is_board(association_id));
create policy contractor_reviews_insert on public.contractor_reviews
  for insert to authenticated with check (public.is_board(association_id) and created_by = auth.uid());
create policy contractor_reviews_update on public.contractor_reviews
  for update to authenticated
  using (created_by = auth.uid() and public.is_board(association_id))
  with check (created_by = auth.uid() and public.is_board(association_id));
create policy contractor_reviews_delete on public.contractor_reviews
  for delete to authenticated
  using (
    (created_by = auth.uid() and public.is_board(association_id))
    or public.has_role_in(association_id, array['board_admin']::public.app_role[])
  );

create trigger audit_contractor_reviews after insert or update or delete on public.contractor_reviews
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- Google search cache + call log
-- ----------------------------------------------------------------------------

create table public.contractor_search_cache (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  trade          text not null,
  results_json   jsonb not null,
  fetched_at     timestamptz not null default now(),
  unique (association_id, trade)
);

alter table public.contractor_search_cache enable row level security;

create policy contractor_search_cache_select on public.contractor_search_cache
  for select to authenticated using (public.is_board(association_id));
create policy contractor_search_cache_insert on public.contractor_search_cache
  for insert to authenticated with check (public.is_board(association_id));
create policy contractor_search_cache_update on public.contractor_search_cache
  for update to authenticated
  using (public.is_board(association_id)) with check (public.is_board(association_id));

create table public.google_api_calls (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  kind           text not null check (kind in ('text_search', 'place_details', 'geocode')),
  trade          text,
  called_by      uuid references auth.users(id) default auth.uid(),
  called_at      timestamptz not null default now()
);

create index on public.google_api_calls (association_id, called_at desc);

alter table public.google_api_calls enable row level security;

create policy google_api_calls_select on public.google_api_calls
  for select to authenticated using (public.is_board(association_id));
create policy google_api_calls_insert on public.google_api_calls
  for insert to authenticated with check (public.is_board(association_id) and called_by = auth.uid());
