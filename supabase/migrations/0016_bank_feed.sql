-- ============================================================================
-- Walkup — migration 0016: read-only bank feed (Plaid)
--
-- Scope, deliberately: this links a bank account to VIEW transactions. It
-- does not move money and never will through this table set. Autopay was
-- considered and explicitly declined — see docs/DECISIONS.md #24, which
-- extends the reasoning already on record in #22 ("no payment initiation").
--
-- The interesting problem here isn't the schema, it's that a Plaid access
-- token is a live credential — worse than a password, since it doesn't
-- expire on its own. It cannot sit in a column any authenticated role can
-- SELECT, not even board_admin, because audit_log's tg_audit() trigger
-- serializes to_jsonb(new)/to_jsonb(old) into a board_admin-readable table
-- (0004) — attaching that trigger to a table holding the token would leak it
-- into the audit trail forever. So the token lives in its own table with
-- RLS enabled and ZERO policies: nobody reaches it through PostgREST at all.
-- The only access path is two SECURITY DEFINER functions below, which run as
-- the table owner (bypassing RLS) after checking authorization themselves —
-- the same shape as post_journal_entry() in 0003 (DECISIONS #5), applied to
-- a secret instead of a ledger write.
-- ============================================================================

create table bank_connections (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references associations(id) on delete restrict,
  institution_name  text not null,
  plaid_item_id     text not null unique,
  status            text not null default 'active'
                       check (status in ('active', 'error', 'disconnected')),
  -- Plaid's opaque cursor for incremental /transactions/sync calls. Not a
  -- secret on its own — worthless without the access token — but treated as
  -- connection-internal state rather than something the client reads.
  sync_cursor       text,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  created_by        uuid not null default auth.uid()
);

-- 1:1 with bank_connections. Split out so the token can be RLS-fenced off
-- from the rest of the (harmless) connection metadata rather than fencing
-- off the whole row.
create table bank_connection_secrets (
  bank_connection_id uuid primary key references bank_connections(id) on delete cascade,
  -- Denormalized from bank_connections. Not read by any policy — this table
  -- has none — but every table carries association_id (CLAUDE.md invariant
  -- 5), and it means a direct SQL-editor query never needs a join to see
  -- which association a row belongs to.
  association_id      uuid not null references associations(id) on delete restrict,
  plaid_access_token  text not null
);

create table bank_transactions (
  id                    uuid primary key default gen_random_uuid(),
  association_id        uuid not null references associations(id) on delete restrict,
  bank_connection_id    uuid not null references bank_connections(id) on delete restrict,
  plaid_transaction_id  text not null unique,
  posted_on             date not null,
  -- Stored inverted from Plaid's own convention. Plaid reports positive =
  -- money OUT of the account, which is the opposite of how every other money
  -- figure in this app reads (positive = good/incoming, DECISIONS #14's
  -- contra-income logic and the Moss/Rust display convention both assume
  -- that). Flipping the sign once here, at the boundary, means nothing
  -- downstream has to remember Plaid's convention.
  amount                numeric(14,2) not null,
  description           text not null,
  pending               boolean not null default false,
  raw_category          text,
  synced_at             timestamptz not null default now()
);

alter table bank_connections        enable row level security;
alter table bank_connection_secrets enable row level security;
alter table bank_transactions       enable row level security;

-- ============================================================================
-- RLS — bank_connections, bank_transactions
--
-- Read: board_admin, board_member, accountant (can_read_financials) — the
-- same audience as the ledger. Owners get nothing; a bank feed is
-- association business, not owner-facing, same as vendors and expenses.
--
-- Write: board_admin only, not board_member. Connecting a bank account is a
-- higher-stakes, infrequent admin action — closer to granting a role
-- (role_grants, board_admin-only) than to logging a maintenance ticket.
-- ============================================================================

create policy bank_connections_select on public.bank_connections
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy bank_connections_update on public.bank_connections
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- No insert policy: rows are created only by store_bank_connection() below,
-- which writes the connection and its secret in one transaction. No delete
-- policy either — connections are retired via status = 'disconnected'
-- (revoke_bank_connection() below), never hard-deleted, so a transaction
-- history never loses the connection it came from (DECISIONS #8's reasoning,
-- applied here).

create policy bank_transactions_select on public.bank_transactions
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy bank_transactions_insert on public.bank_transactions
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy bank_transactions_update on public.bank_transactions
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

-- bank_connection_secrets gets NO policies of any kind, for any role. RLS is
-- enabled with nothing granted, which denies by default (0002's pattern) —
-- see the migration header for why.

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Stores a newly linked connection and its access token in one transaction.
-- Called right after the Plaid Link public-token exchange, server-side —
-- the token this receives never touches the browser again after this call.
create or replace function public.store_bank_connection(
  p_association_id   uuid,
  p_institution_name  text,
  p_plaid_item_id     text,
  p_access_token      text
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_connection uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to connect a bank account for this association'
      using errcode = '42501';
  end if;

  insert into public.bank_connections (
    association_id, institution_name, plaid_item_id, created_by
  ) values (
    p_association_id, p_institution_name, p_plaid_item_id, auth.uid()
  ) returning id into v_connection;

  insert into public.bank_connection_secrets (bank_connection_id, association_id, plaid_access_token)
  values (v_connection, p_association_id, p_access_token);

  return v_connection;
end $$;

revoke all on function public.store_bank_connection(uuid, text, text, text) from public, anon;
grant execute on function public.store_bank_connection(uuid, text, text, text) to authenticated;

-- The only way to read a stored access token. Called server-side, right
-- before a Plaid API call — the token is held in server memory for that one
-- call and discarded, never serialized into a response the browser sees.
create or replace function public.get_bank_access_token(p_connection_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_assoc uuid;
  v_token text;
begin
  select association_id into v_assoc
    from public.bank_connections
   where id = p_connection_id;

  if v_assoc is null then
    raise exception 'bank connection not found' using errcode = 'no_data_found';
  end if;

  if not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to read this bank connection'
      using errcode = '42501';
  end if;

  select plaid_access_token into v_token
    from public.bank_connection_secrets
   where bank_connection_id = p_connection_id;

  -- Distinguishing "revoked" from "never worked" from an authorization
  -- failure matters here: whatever calls this is about to hit Plaid's API,
  -- and a silent null would surface as a confusing error from Plaid instead
  -- of a clear one from here.
  if v_token is null then
    raise exception 'no stored access token for this connection — it may have been disconnected'
      using errcode = 'no_data_found';
  end if;

  return v_token;
end $$;

revoke all on function public.get_bank_access_token(uuid) from public, anon;
grant execute on function public.get_bank_access_token(uuid) to authenticated;

-- Retires a connection: marks it disconnected and deletes the stored token,
-- so there is nothing left that could still call Plaid on the association's
-- behalf. Transaction history is left in place — see the note on
-- bank_connections above.
create or replace function public.revoke_bank_connection(p_connection_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc
    from public.bank_connections
   where id = p_connection_id;

  if v_assoc is null then
    raise exception 'bank connection not found' using errcode = 'no_data_found';
  end if;

  if not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to disconnect this bank connection'
      using errcode = '42501';
  end if;

  delete from public.bank_connection_secrets where bank_connection_id = p_connection_id;

  update public.bank_connections
     set status = 'disconnected'
   where id = p_connection_id;
end $$;

revoke all on function public.revoke_bank_connection(uuid) from public, anon;
grant execute on function public.revoke_bank_connection(uuid) to authenticated;

-- ============================================================================
-- AUDIT
-- ============================================================================
-- bank_connections only. Who connected or disconnected a bank feed and when
-- is access-control-relevant, same reasoning 0004 gives for persons and
-- role_grants.
--
-- Deliberately NOT audited: bank_connection_secrets (would serialize the raw
-- token into audit_log's before/after JSONB — see the migration header) and
-- bank_transactions (synced external data with no accounting weight of its
-- own in this design, not a board action — closer to a cache than a record).

create trigger audit_bank_connections
  after insert or update or delete on public.bank_connections
  for each row execute function public.tg_audit();
