-- ============================================================================
-- Walkup — migration 0046: bank feed speed
--
-- Three things, all in service of a treasurer who opens the bank feed for
-- ten minutes a month and should not wait on it:
--
--   1. bank_payee_history — a derived, trigger-maintained tally of how this
--      board has filed each payee before. The "Recommended" chip used to be
--      built by reading up to 2,000 categorized bank_transactions rows on
--      every page load and tallying them in the app. The tally now lives in
--      a small table (one row per payee + direction + choice) that a trigger
--      keeps right as rows are categorized, re-categorized, un-categorized
--      or retracted. Read-only to everyone; only the trigger writes it.
--      Later slices also read amount_cents_total / count for an "unusually
--      large for this payee" nudge.
--
--   2. post_bank_transactions(uuid[]) / unpost_bank_transactions(uuid[]) —
--      batch wrappers that loop over the existing per-row RPCs. "Post all
--      ready" with forty rows was forty round trips; now it is one. Nothing
--      is bypassed: each id still goes through post_bank_transaction() /
--      unpost_bank_transaction(), which do their own authorization and all
--      the accounting (DECISIONS #5, #29). One row failing does not stop
--      the rest — each call runs in its own sub-transaction and the result
--      says, per id, whether it worked and why not if it didn't.
--
--   3. bank_transactions.rule_id — which saved rule pre-filled a row during
--      sync, so the page can say "from your rule" instead of leaving the
--      board to guess. The column only; the sync writes it in a later slice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bank_payee_key — the same normalisation as src/lib/plaid/similar.ts
-- normalizeDescription(), so the app and the database agree on which rows
-- are "the same payee". Lowercase; digits, # and * become a space; anything
-- else that is not a–z or space becomes a space; runs of spaces collapse;
-- trimmed. "COMED 8841" and "ComEd *9120" both become "comed".
-- Keep the two in step: tests/db/bank-feed-speed.test.ts checks they match.
-- ----------------------------------------------------------------------------

create or replace function public.bank_payee_key(p_description text)
returns text
language sql immutable strict set search_path = ''
as $$
  select trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(p_description), '[0-9#*]+', ' ', 'g'),
        '[^a-z ]+', ' ', 'g'),
      ' +', ' ', 'g'))
$$;

-- ----------------------------------------------------------------------------
-- bank_payee_history
-- ----------------------------------------------------------------------------

create table public.bank_payee_history (
  association_id      uuid     not null references public.associations(id) on delete restrict,
  payee_key           text     not null,
  -- sign(amount): -1 money out, 1 money in. A refund from a vendor is not
  -- filed like a payment to them, so the two directions are kept apart.
  direction           smallint not null check (direction in (-1, 1)),
  posting_kind        text     not null,
  account_id          uuid,
  matched_unit_id     uuid,
  count               int      not null default 0,
  -- Sum of abs(amount) in cents, so a typical amount is amount_cents_total
  -- / count. Whole cents in a bigint, not money in numeric(14,2): this is a
  -- tally for a hint, never a figure that reaches the books.
  amount_cents_total  bigint   not null default 0,
  last_seen           date,
  -- account_id / matched_unit_id are null for 'excluded' and for dues /
  -- expense respectively, and a null must still mean "one row".
  unique nulls not distinct (association_id, payee_key, direction, posting_kind, account_id, matched_unit_id)
);

comment on table public.bank_payee_history is
  'Derived: how this board has filed each payee so far. Maintained only by tg_bank_payee_history() on bank_transactions; never written by hand. Not audited — it is a tally of audited rows, not a record in its own right.';

create index bank_payee_history_lookup_idx
  on public.bank_payee_history (association_id, payee_key, direction);

alter table public.bank_payee_history enable row level security;

-- Same audience as the bank feed itself. No insert/update/delete policy for
-- anyone: the trigger below is SECURITY DEFINER and writes as the table
-- owner, which is the only path that ever changes a row.
create policy bank_payee_history_select on public.bank_payee_history
  for select to authenticated
  using (public.can_read_financials(association_id));

-- No audit trigger, deliberately. Every change here is a consequence of a
-- bank_transactions UPDATE, which is already audited (0035); logging the
-- tally as well would double the audit volume and say nothing new.

-- ----------------------------------------------------------------------------
-- tg_bank_payee_history — keeps the tally right
--
-- A bank_transactions row "counts" when it is categorized (posting_kind not
-- null), still stands (removed_at null) and is not for zero dollars. The
-- trigger subtracts the old row's contribution when it stops counting and
-- adds the new row's when it starts, so categorize, re-categorize,
-- un-categorize and retraction all land correctly; an update that leaves the
-- payee + choice alone (posting, unposting, a vendor change) is a no-op.
--
-- SECURITY DEFINER with search_path pinned (DECISIONS #23): it writes a
-- table the calling board member has no insert/update/delete policy on,
-- and it must see every row regardless of who triggered it.
-- ----------------------------------------------------------------------------

create or replace function public.tg_bank_payee_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_counts boolean := false;
  v_new_counts boolean := false;
  v_old_key    text;
  v_new_key    text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_counts := old.posting_kind is not null and old.removed_at is null and old.amount <> 0;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_counts := new.posting_kind is not null and new.removed_at is null and new.amount <> 0;
  end if;

  if v_old_counts then v_old_key := public.bank_payee_key(old.description); end if;
  if v_new_counts then v_new_key := public.bank_payee_key(new.description); end if;

  -- Same payee, same direction, same choice, same amount: nothing to move.
  if v_old_counts and v_new_counts
     and v_old_key = v_new_key
     and old.amount = new.amount
     and old.posting_kind = new.posting_kind
     and old.account_id is not distinct from new.account_id
     and old.matched_unit_id is not distinct from new.matched_unit_id then
    return null;
  end if;

  if v_old_counts then
    update public.bank_payee_history h
       set count = h.count - 1,
           amount_cents_total = h.amount_cents_total - round(abs(old.amount) * 100)::bigint
     where h.association_id = old.association_id
       and h.payee_key = v_old_key
       and h.direction = sign(old.amount)::smallint
       and h.posting_kind = old.posting_kind
       and h.account_id is not distinct from old.account_id
       and h.matched_unit_id is not distinct from old.matched_unit_id;
    -- last_seen is left alone on a decrement: recomputing it would mean a
    -- scan, and "when we last saw this" is only a hint.
    delete from public.bank_payee_history h
     where h.association_id = old.association_id
       and h.payee_key = v_old_key
       and h.direction = sign(old.amount)::smallint
       and h.posting_kind = old.posting_kind
       and h.account_id is not distinct from old.account_id
       and h.matched_unit_id is not distinct from old.matched_unit_id
       and h.count <= 0;
  end if;

  if v_new_counts then
    insert into public.bank_payee_history
      (association_id, payee_key, direction, posting_kind, account_id, matched_unit_id,
       count, amount_cents_total, last_seen)
    values
      (new.association_id, v_new_key, sign(new.amount)::smallint, new.posting_kind,
       new.account_id, new.matched_unit_id,
       1, round(abs(new.amount) * 100)::bigint, new.posted_on)
    on conflict (association_id, payee_key, direction, posting_kind, account_id, matched_unit_id)
    do update set
      count              = public.bank_payee_history.count + 1,
      amount_cents_total = public.bank_payee_history.amount_cents_total + excluded.amount_cents_total,
      last_seen          = greatest(public.bank_payee_history.last_seen, excluded.last_seen);
  end if;

  return null;
end $$;

revoke all on function public.tg_bank_payee_history() from public, anon;
grant execute on function public.tg_bank_payee_history() to authenticated;

create trigger bank_transactions_payee_history
  after insert or update or delete on public.bank_transactions
  for each row execute function public.tg_bank_payee_history();

-- Backfill from what is already categorized. Same definition of "counts"
-- as the trigger, so the table starts exactly where the trigger would have
-- left it.
insert into public.bank_payee_history
  (association_id, payee_key, direction, posting_kind, account_id, matched_unit_id,
   count, amount_cents_total, last_seen)
select association_id,
       public.bank_payee_key(description),
       sign(amount)::smallint,
       posting_kind,
       account_id,
       matched_unit_id,
       count(*)::int,
       sum(round(abs(amount) * 100))::bigint,
       max(posted_on)
  from public.bank_transactions
 where posting_kind is not null
   and removed_at is null
   and amount <> 0
 group by 1, 2, 3, 4, 5, 6;

-- ----------------------------------------------------------------------------
-- post_bank_transactions / unpost_bank_transactions — many ids, one call
--
-- Each id goes through the per-row RPC unchanged; this only saves the round
-- trips. A failing row is reported, not fatal: the EXCEPTION block gives
-- each call its own sub-transaction, so a pending row in the middle of the
-- batch leaves the rows around it posted. post_bank_transaction() returns
-- null for an 'excluded' row (it marks excluded_at instead of writing an
-- entry) — that is a success here too.
-- ----------------------------------------------------------------------------

create or replace function public.post_bank_transactions(p_ids uuid[])
returns table (id uuid, ok boolean, error text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      perform public.post_bank_transaction(v_id);
      id := v_id; ok := true; error := null;
    exception when others then
      id := v_id; ok := false; error := sqlerrm;
    end;
    return next;
  end loop;
end $$;

revoke all on function public.post_bank_transactions(uuid[]) from public, anon;
grant execute on function public.post_bank_transactions(uuid[]) to authenticated;

create or replace function public.unpost_bank_transactions(p_ids uuid[])
returns table (id uuid, ok boolean, error text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  foreach v_id in array coalesce(p_ids, '{}'::uuid[]) loop
    begin
      perform public.unpost_bank_transaction(v_id);
      id := v_id; ok := true; error := null;
    exception when others then
      id := v_id; ok := false; error := sqlerrm;
    end;
    return next;
  end loop;
end $$;

revoke all on function public.unpost_bank_transactions(uuid[]) from public, anon;
grant execute on function public.unpost_bank_transactions(uuid[]) to authenticated;

-- ----------------------------------------------------------------------------
-- bank_transactions.rule_id
-- ----------------------------------------------------------------------------

alter table public.bank_transactions
  add column rule_id uuid references public.bank_categorization_rules(id) on delete set null;

comment on column public.bank_transactions.rule_id is
  'Set when a sync pre-filled this row''s categorization from a saved rule, so the page can say so. Null for anything a person chose by hand.';
