-- ============================================================================
-- Walkup — migration 0035: the bank feed becomes how entries reach the ledger
--
-- Reverses the "never posted into the ledger" half of DECISIONS #24, on
-- Doug's explicit call (2026-09-17, DECISIONS #29): Plaid transactions are
-- the source of truth, each one is categorized by the board and then POSTED
-- to the real double-entry ledger through the same RPCs a hand-entered
-- payment or expense uses. This migration is the schema; 0036 is the posting
-- functions.
--
-- What a bank_transactions row gains:
--   * plaid_account_id / pending_transaction_id — persisted from Plaid so a
--     pending row and its later posted twin can be tied together, and so a
--     multi-account Item (checking + savings) can be told apart later.
--   * posting_kind + targets — the board's categorization. Kept ON the
--     transaction, not derived, so it survives a Plaid re-sync and so the
--     "ready to post but not yet posted" state is a real, queryable state.
--   * journal_entry_id — set exactly once, by post_bank_transaction(). This
--     is the idempotency guard: a row with a journal_entry_id cannot be
--     posted again, full stop. Undoing goes through a reversal entry
--     (0036), never by clearing this and re-posting silently.
--   * removed_at — Plaid retracts transactions (a pending one that never
--     settled, a bank-side correction). A retracted row that was already
--     posted must not vanish from under its journal entry; it is marked and
--     surfaced for review instead. Nothing in bank_transactions is hard
--     deleted by the sync any more — un-posted retractions are simply
--     marked and hidden.
--
-- bank_connections.cash_account_id / fund_id: which ledger cash account and
-- fund this bank account IS. Every posting needs a cash leg; the board picks
-- this once at connect time (default Operating Cash / Operating fund).
--
-- bank_categorization_rules: "description contains X ⇒ this kind/account".
-- Applied at sync time to pre-fill the categorization. auto_post = true
-- means "post without a second look" — but only ever during a board
-- member's own sync or an explicit "post all ready" click, never from the
-- unattended cron (see 0036 and DECISIONS #29 for why).
--
-- RLS: bank_transactions keeps its 0016 policies — select can_read_financials,
-- update board_admin — which already cover every new column. The rules
-- table gets the same shape. No table here becomes owner-visible.
-- ============================================================================

alter table bank_transactions
  add column plaid_account_id        text,
  add column pending_transaction_id  text,
  add column posting_kind            text
    check (posting_kind in ('expense', 'income', 'dues', 'transfer', 'excluded')),
  add column account_id              uuid references accounts(id) on delete restrict,
  add column vendor_id               uuid references vendors(id)  on delete set null,
  add column journal_entry_id        uuid references journal_entries(id) on delete restrict,
  add column excluded_at             timestamptz,
  add column removed_at              timestamptz;

-- A categorization is either complete for its kind or absent — no half-set
-- rows that post_bank_transaction() would then have to reject at runtime.
alter table bank_transactions
  add constraint bank_transactions_categorization_complete check (
    posting_kind is null
    or (posting_kind in ('expense', 'income', 'transfer') and account_id is not null)
    or (posting_kind = 'dues' and matched_unit_id is not null)
    or (posting_kind = 'excluded')
  );

create index bank_transactions_fingerprint_idx
  on bank_transactions (association_id, posted_on, amount);

create index bank_transactions_unposted_idx
  on bank_transactions (association_id, posted_on)
  where journal_entry_id is null and removed_at is null;

comment on column bank_transactions.journal_entry_id is
  'Set once by post_bank_transaction(). Non-null means this row is in the books; unpost_bank_transaction() reverses the entry and clears it.';
comment on column bank_transactions.removed_at is
  'Plaid retracted this transaction. Never deleted if it was posted — surfaced for review instead.';

alter table bank_connections
  add column cash_account_id uuid references accounts(id) on delete restrict,
  add column fund_id         uuid references funds(id)    on delete restrict;

comment on column bank_connections.cash_account_id is
  'The ledger cash account this bank account is (e.g. 1000 Operating Cash). Every posting from this connection uses it as the cash leg.';

-- Categorization now carries accounting weight, so board edits to a
-- transaction row are auditable. INSERTs are still the sync writing external
-- data and stay out of the audit log (0016's reasoning); UPDATEs are board
-- decisions.
create trigger audit_bank_transactions
  after update on public.bank_transactions
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- Categorization rules
-- ----------------------------------------------------------------------------

create table bank_categorization_rules (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null references associations(id) on delete restrict,
  -- Case-insensitive substring match against bank_transactions.description.
  pattern          text not null check (length(trim(pattern)) >= 3),
  posting_kind     text not null
    check (posting_kind in ('expense', 'income', 'dues', 'transfer', 'excluded')),
  account_id       uuid references accounts(id) on delete cascade,
  matched_unit_id  uuid references units(id)    on delete cascade,
  vendor_id        uuid references vendors(id)  on delete set null,
  auto_post        boolean not null default false,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  unique (association_id, pattern),
  check (
       (posting_kind in ('expense', 'income', 'transfer') and account_id is not null)
    or (posting_kind = 'dues' and matched_unit_id is not null)
    or (posting_kind = 'excluded')
  )
);

alter table bank_categorization_rules enable row level security;

create policy bank_categorization_rules_select on public.bank_categorization_rules
  for select to authenticated
  using (public.can_read_financials(association_id));

create policy bank_categorization_rules_insert on public.bank_categorization_rules
  for insert to authenticated
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy bank_categorization_rules_update on public.bank_categorization_rules
  for update to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]))
  with check (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create policy bank_categorization_rules_delete on public.bank_categorization_rules
  for delete to authenticated
  using (public.has_role_in(association_id, array['board_admin']::public.app_role[]));

create trigger audit_bank_categorization_rules
  after insert or update or delete on public.bank_categorization_rules
  for each row execute function public.tg_audit();

-- ----------------------------------------------------------------------------
-- create_cash_account — a transfer needs a real counterparty
-- ----------------------------------------------------------------------------
-- The seeded chart has exactly two cash accounts (1000 Operating Cash, 1010
-- Reserve Cash). A real building moves money to accounts that aren't
-- connected to Plaid ("TRANSFER TO CK CHASE BANK"), and those need to exist
-- in the chart as cash so the transfer posts cash-to-cash and stays off the
-- P&L. Same shape as create_expense_account (0032); codes step by 10 in the
-- 10xx block, below 1200 Assessments Receivable.

create or replace function public.create_cash_account(
  p_association_id uuid,
  p_name text
)
returns public.accounts
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := trim(p_name);
  v_next_code text;
  v_account public.accounts;
begin
  if not public.has_role_in(
       p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to add a cash account for this association'
      using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'account name is required';
  end if;

  select to_char(coalesce(max(code::int), 990) + 10, 'FM0000')
    into v_next_code
  from public.accounts
  where association_id = p_association_id
    and type = 'asset'
    and code ~ '^[0-9]+$'
    and code::int < 1200;

  insert into public.accounts
    (association_id, code, name, type, is_cash_account)
  values
    (p_association_id, v_next_code, v_name, 'asset', true)
  returning * into v_account;

  return v_account;
end $$;

revoke all on function public.create_cash_account(uuid, text) from public, anon;
grant execute on function public.create_cash_account(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- ensure_fiscal_year — two years of history needs two years of periods
-- ----------------------------------------------------------------------------
-- Self-serve signup seeds only the current fiscal year (0029). Plaid hands
-- back up to 24 months, so posting a 2024 transaction would fail for want of
-- a fiscal_years row. This creates the missing year on demand, aligned to
-- associations.fiscal_year_end_month. Internal: called from
-- post_bank_transaction() (0036), which has already authorized the caller,
-- so it is not granted to authenticated directly.

create or replace function public.ensure_fiscal_year(
  p_association_id uuid,
  p_date date
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_end_month int;
  v_start date;
  v_end date;
  v_label text;
begin
  select id into v_id
    from public.fiscal_years
   where association_id = p_association_id
     and p_date between starts_on and ends_on
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select fiscal_year_end_month into v_end_month
    from public.associations where id = p_association_id;
  v_end_month := coalesce(v_end_month, 12);

  -- The fiscal year containing p_date ends on the last day of v_end_month,
  -- in either p_date's year or the next one.
  v_end := (date_trunc('month', make_date(extract(year from p_date)::int, v_end_month, 1))
            + interval '1 month' - interval '1 day')::date;
  if v_end < p_date then
    v_end := (v_end + interval '1 year')::date;
  end if;
  v_start := (v_end - interval '1 year' + interval '1 day')::date;

  v_label := case
    when v_end_month = 12 then extract(year from v_end)::text
    else extract(year from v_start)::text || '–' || extract(year from v_end)::text
  end;

  insert into public.fiscal_years (association_id, label, starts_on, ends_on)
  values (p_association_id, v_label, v_start, v_end)
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.ensure_fiscal_year(uuid, date) from public, anon, authenticated;
