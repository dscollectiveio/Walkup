-- ============================================================================
-- Walkup — migration 0063: the bank's own balances, kept so every page agrees
--
-- WHY. The bank is the source of truth for how much money the association has
-- (Doug, 2026-10-16). Until now the Bank Feed asked Plaid live and showed the
-- answer, while Home and the financial statements showed the ledger's cash,
-- so the two could disagree, and only a board admin could see the live figure
-- at all (reading the Plaid token is board-admin only, 0016). This keeps the
-- latest balance per bank account, written whenever Walkup hears it from
-- Plaid (a live balance check by a board admin, Sync now, or the daily
-- sync's transactions/sync response), so every reader of the books sees the
-- same figure with the time it was true.
--
-- WHAT. bank_account_balances: one row per Plaid account on a connection,
-- replaced as a set each time. Read by anyone who can read the financials
-- (the same rule as bank_transactions). Written only through
-- record_bank_balances(), which a board admin of that association or the
-- service role (the daily sync) may call. No token, no transaction and no
-- ledger row is read or written here.
-- ============================================================================

create table public.bank_account_balances (
  bank_connection_id uuid not null references public.bank_connections(id) on delete cascade,
  plaid_account_id   text not null check (char_length(plaid_account_id) between 1 and 200),
  association_id     uuid not null references public.associations(id) on delete restrict,
  name               text not null check (char_length(name) between 1 and 200),
  mask               text check (mask is null or char_length(mask) <= 10),
  account_type       text not null check (char_length(account_type) between 1 and 40),
  current_balance    numeric(14, 2),
  as_of              timestamptz not null default now(),
  source             text not null check (source in ('live', 'last_sync', 'sync')),
  primary key (bank_connection_id, plaid_account_id)
);

create index bank_account_balances_association_idx on public.bank_account_balances (association_id);

alter table public.bank_account_balances enable row level security;

create policy bank_account_balances_read on public.bank_account_balances
  for select to authenticated
  using (public.can_read_financials(association_id));

-- No insert/update/delete policies: writes go through the function below.
revoke all on public.bank_account_balances from anon;
grant select on public.bank_account_balances to authenticated;
grant select, insert, update, delete on public.bank_account_balances to service_role;

create or replace function public.record_bank_balances(
  p_connection_id uuid,
  p_accounts      jsonb,
  p_source        text
)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc  uuid;
  v_status text;
  v_rows   integer;
begin
  if p_source not in ('live', 'last_sync', 'sync') then
    raise exception 'unknown balance source' using errcode = '22023';
  end if;
  if p_accounts is null or jsonb_typeof(p_accounts) <> 'array' then
    raise exception 'accounts must be a list' using errcode = '22023';
  end if;

  select association_id, status into v_assoc, v_status
    from public.bank_connections where id = p_connection_id;
  if v_assoc is null then
    raise exception 'bank connection not found' using errcode = 'no_data_found';
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to record balances for this bank' using errcode = '42501';
  end if;
  if v_status = 'disconnected' then
    return 0;
  end if;

  delete from public.bank_account_balances where bank_connection_id = p_connection_id;

  insert into public.bank_account_balances
    (bank_connection_id, plaid_account_id, association_id, name, mask, account_type, current_balance, as_of, source)
  select p_connection_id,
         a->>'account_id',
         v_assoc,
         left(coalesce(nullif(btrim(a->>'name'), ''), 'Account'), 200),
         left(nullif(a->>'mask', ''), 10),
         left(coalesce(nullif(a->>'type', ''), 'other'), 40),
         case when a->>'current' is null then null else round((a->>'current')::numeric, 2) end,
         now(),
         p_source
    from jsonb_array_elements(p_accounts) as a
   where coalesce(a->>'account_id', '') <> '';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

revoke all on function public.record_bank_balances(uuid, jsonb, text) from public, anon;
grant execute on function public.record_bank_balances(uuid, jsonb, text) to authenticated, service_role;

comment on table public.bank_account_balances is
  'The latest balance per bank account as the bank reported it; the source of truth for cash on every page (0063).';
comment on function public.record_bank_balances(uuid, jsonb, text) is
  'Replaces a connection''s stored bank balances. Board admin of the association or the service role (daily sync) only.';

-- ----------------------------------------------------------------------------
-- Which fund each bank account's money belongs to. A connection carries one
-- fund (0016), but one bank often holds both the checking account and the
-- reserve savings; this lets a board admin say "this account is the reserve"
-- so the day-to-day and reserve figures come out right. Unset means the
-- connection's fund. Kept apart from bank_account_balances, whose rows are
-- replaced on every balance check.
-- ----------------------------------------------------------------------------
create table public.bank_account_funds (
  bank_connection_id uuid not null references public.bank_connections(id) on delete cascade,
  plaid_account_id   text not null check (char_length(plaid_account_id) between 1 and 200),
  association_id     uuid not null references public.associations(id) on delete restrict,
  fund_id            uuid not null references public.funds(id) on delete cascade,
  updated_at         timestamptz not null default now(),
  primary key (bank_connection_id, plaid_account_id)
);

alter table public.bank_account_funds enable row level security;

create policy bank_account_funds_read on public.bank_account_funds
  for select to authenticated
  using (public.can_read_financials(association_id));

-- The fund must be the association's own, and the connection too.
create policy bank_account_funds_write on public.bank_account_funds
  for all to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (
    public.has_role_in(association_id, array['board_admin']::public.app_role[])
    and exists (select 1 from public.funds f where f.id = fund_id and f.association_id = bank_account_funds.association_id)
    and exists (select 1 from public.bank_connections c where c.id = bank_connection_id and c.association_id = bank_account_funds.association_id)
  );

revoke all on public.bank_account_funds from anon;
grant select, insert, update, delete on public.bank_account_funds to authenticated;
