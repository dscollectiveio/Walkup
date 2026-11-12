-- 0094: a nickname the board gives each account inside a connected bank
-- ("Operating checking", "Reserve savings"). Shown on the bank feed beside the
-- bank's own name; the bank's name is never overwritten. One row per account,
-- written by a board admin, readable by anyone who can read the financials.

create table public.bank_account_nicknames (
  bank_connection_id uuid not null references public.bank_connections(id) on delete cascade,
  plaid_account_id   text not null check (char_length(plaid_account_id) between 1 and 200),
  association_id     uuid not null references public.associations(id) on delete restrict,
  nickname           text not null check (char_length(btrim(nickname)) between 1 and 40),
  updated_at         timestamptz not null default now(),
  primary key (bank_connection_id, plaid_account_id)
);

alter table public.bank_account_nicknames enable row level security;

create policy bank_account_nicknames_read on public.bank_account_nicknames
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy bank_account_nicknames_write on public.bank_account_nicknames
  for all to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (
    public.has_role_in(association_id, array['board_admin']::public.app_role[])
    and exists (select 1 from public.bank_connections c where c.id = bank_connection_id and c.association_id = bank_account_nicknames.association_id)
  );

revoke all on public.bank_account_nicknames from anon;
grant select, insert, update, delete on public.bank_account_nicknames to authenticated;
