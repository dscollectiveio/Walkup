-- ============================================================================
-- Walkup — migration 0055: email reminders and statements
--
-- DECISIONS #36: Walkup sends no email to anyone unless a board administrator
-- has approved it. Approval is either a batch ("Send these N emails") or a
-- standing rule the administrator switched on. This migration holds the
-- machinery and, more importantly, the limits, in SQL, where a compromised
-- application or a compromised board account cannot talk its way past them:
--
--   * recipients are persons rows of this association (no free addresses),
--     and the address must still match the person at the moment of sending;
--   * one email per person per week per kind;
--   * a daily ceiling per association (20 a day for the first week after
--     sending is switched on), and an hourly ceiling for the whole platform;
--   * nothing is sent to a hard-bounced or complaining address, or to anyone
--     who opted out; balances in the email must still be true when it goes;
--   * a claimed message is sent by whoever claimed it, once: the claim token
--     and the Resend idempotency key make a retry safe.
--
-- Content is not stored here. A message is a kind, a snapshot of facts built
-- from the ledger, and an optional short note from the board. The application
-- renders it from a template (src/lib/email/templates). No model writes any
-- of it.
--
-- Money crosses the API as text (#20). Everything that writes goes through a
-- SECURITY DEFINER function with a pinned search_path (#5, #23).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Helpers
-- ----------------------------------------------------------------------------

-- True only for a request made with the project's service key (the cron route
-- and the Resend webhook route). A signed-in user cannot forge the claim.
create or replace function public.email_is_service()
returns boolean language sql stable set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role' $$;

revoke all on function public.email_is_service() from public, anon;
grant execute on function public.email_is_service() to authenticated, service_role;

-- The building's "today". Walkup is Illinois-only and the database runs in UTC:
-- after about 7 p.m. Chicago time current_date is already tomorrow, which would
-- turn a charge due today into an overdue one between "prepared" and "sent".
-- Same zone as ai_day_start() (0051) and the app's buildingTodayIso().
create or replace function public.email_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'America/Chicago')::date $$;

revoke all on function public.email_today() from public, anon, authenticated;

-- A deliberately plain address check. Anything stricter belongs to the mail
-- server; this keeps whitespace, commas, angle brackets and line breaks out.
create or replace function public.email_address_ok(p_email text)
returns boolean language sql immutable set search_path = ''
as $$
  select p_email is not null
     and char_length(p_email) <= 254
     and p_email ~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
$$;

revoke all on function public.email_address_ok(text) from public, anon;
grant execute on function public.email_address_ok(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. Settings, rules, preferences, suppressions
-- ----------------------------------------------------------------------------

create table public.email_settings (
  id               uuid primary key default gen_random_uuid(),
  association_id   uuid not null unique references public.associations(id) on delete restrict,
  sending_enabled  boolean not null default false,
  enabled_at       timestamptz,
  enabled_by       uuid references auth.users(id),
  daily_cap        integer not null default 60 check (daily_cap between 1 and 200),
  suspended_at     timestamptz,
  suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 300),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (not sending_enabled or enabled_at is not null)
);

comment on table public.email_settings is
  'Per association: whether Walkup may send email at all (a board admin switches it on, and only once a reply-to contact is set), the daily ceiling, and a platform-admin suspension. Written only by email_set_sending / email_suspend.';

create table public.reminder_rules (
  id                    uuid primary key default gen_random_uuid(),
  association_id        uuid not null references public.associations(id) on delete restrict,
  kind                  text not null check (kind in ('dues_upcoming', 'dues_overdue')),
  days                  smallint not null check (days between 1 and 90),
  min_amount            numeric(14,2) not null default 1.00 check (min_amount >= 0),
  repeat_every_days     smallint not null default 7 check (repeat_every_days between 7 and 60),
  max_reminders         smallint not null default 3 check (max_reminders between 1 and 6),
  enabled               boolean not null default false,
  paused_at             timestamptz,
  enabled_by            uuid references auth.users(id),
  enabled_at            timestamptz,
  last_run_on           date,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (association_id, kind),
  check (not enabled or enabled_at is not null)
);

comment on table public.reminder_rules is
  'A standing rule a board admin switched on: dues_upcoming = N days before a charge is due; dues_overdue = once a unit is N days past due, repeating no faster than every repeat_every_days (never faster than weekly, whatever is typed), at most max_reminders times. Evaluated by the daily cron through email_run_rules.';

create table public.email_preferences (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references public.associations(id) on delete restrict,
  person_id         uuid not null unique references public.persons(id) on delete restrict,
  dues_reminders    boolean not null default true,
  statements        boolean not null default true,
  announcements     boolean not null default true,
  unsubscribed_all  boolean not null default false,
  -- The unsubscribe link carries this and nothing else; no login. Same
  -- construction as invites.token (three UUIDs, 48 bytes of entropy).
  token             text not null unique default (
                      replace(gen_random_uuid()::text, '-', '') ||
                      replace(gen_random_uuid()::text, '-', '') ||
                      replace(gen_random_uuid()::text, '-', '')),
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

comment on table public.email_preferences is
  'Per person: which kinds of email they accept. A person reads only their own row; changes go through set_my_email_preferences() or the unsubscribe link (email_unsubscribe). The board sees only who opted out, through email_optouts().';

create table public.email_suppressions (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  email          text not null check (email = lower(email)),
  reason         text not null check (reason in ('bounce', 'complaint')),
  created_at     timestamptz not null default now(),
  unique (association_id, email)
);

comment on table public.email_suppressions is
  'Addresses Walkup will not send to for this association: a hard bounce or a spam complaint reported by Resend. Written only by email_record_event. A board admin can clear one after fixing the address (email_clear_suppression).';

-- ----------------------------------------------------------------------------
-- 2. Batches, outbox, log
-- ----------------------------------------------------------------------------

create table public.email_batches (
  id             uuid primary key default gen_random_uuid(),
  association_id uuid not null references public.associations(id) on delete restrict,
  kind           text not null check (kind in ('dues_reminder', 'late_fee_notice', 'statement', 'annual_statement', 'announcement')),
  source         text not null default 'manual' check (source in ('manual', 'rule')),
  rule_id        uuid references public.reminder_rules(id) on delete restrict,
  status         text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  period_start   date,
  period_end     date,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  check ((status = 'approved') = (approved_at is not null)),
  check (source = 'manual' or rule_id is not null),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create index email_batches_assoc_idx on public.email_batches (association_id, created_at desc);

comment on table public.email_batches is
  'One approval: a board admin reviewed these drafts and pressed Send (source manual), or a standing rule they switched on produced them (source rule, approved_by = whoever enabled the rule). Progress is read from the outbox rows.';

create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references public.associations(id) on delete restrict,
  batch_id            uuid not null references public.email_batches(id) on delete restrict,
  kind                text not null check (kind in ('dues_reminder', 'late_fee_notice', 'statement', 'annual_statement', 'announcement')),
  person_id           uuid not null references public.persons(id) on delete restrict,
  unit_ids            uuid[] not null default '{}',
  to_email            text not null check (public.email_address_ok(to_email) and to_email = lower(to_email)),
  to_name             text check (to_name is null or char_length(to_name) <= 120),
  -- Snapshot of the ledger facts the template renders (jsonb, money as text).
  facts               jsonb not null default '{}',
  board_note          text check (board_note is null or (char_length(board_note) <= 500 and board_note !~* '(://|www\.|@)')),
  template_key        text not null,
  template_version    smallint not null default 1,
  status              text not null default 'draft'
                        check (status in ('draft', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped', 'cancelled')),
  skip_reason         text check (skip_reason is null or skip_reason ~ '^[a-z_]{1,40}$'),
  idempotency_key     text not null unique,
  claim_token         uuid,
  claimed_at          timestamptz,
  attempts            smallint not null default 0 check (attempts between 0 and 5),
  not_before          timestamptz,
  provider_message_id text,
  subject             text check (subject is null or char_length(subject) <= 300),
  last_error          text check (last_error is null or char_length(last_error) <= 500),
  queued_at           timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (status not in ('skipped', 'failed') or skip_reason is not null or last_error is not null),
  check (status <> 'sent' or (sent_at is not null and provider_message_id is not null))
);

create index email_outbox_batch_idx  on public.email_outbox (batch_id, status);
create index email_outbox_person_idx on public.email_outbox (person_id, kind, claimed_at desc);
create index email_outbox_assoc_idx  on public.email_outbox (association_id, created_at desc);
create index email_outbox_units_idx  on public.email_outbox using gin (unit_ids);
create unique index email_outbox_provider_idx on public.email_outbox (provider_message_id) where provider_message_id is not null;

comment on table public.email_outbox is
  'One message to one person. Holds inputs (kind, facts, optional board note), never rendered text. The send log: who, what, when, provider id and status including bounces. Editable only while draft; written only by the email_* functions.';

create table public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  association_id      uuid not null references public.associations(id) on delete restrict,
  outbox_id           uuid references public.email_outbox(id) on delete restrict,
  person_id           uuid references public.persons(id) on delete restrict,
  to_email            text,
  kind                text,
  event               text not null check (event in ('queued', 'claimed', 'sent', 'failed', 'skipped', 'delivered', 'delayed', 'bounced', 'complained', 'unsubscribed', 'resubscribed', 'cancelled', 'suppression_cleared')),
  detail              text check (detail is null or char_length(detail) <= 500),
  provider_message_id text,
  svix_id             text,
  created_at          timestamptz not null default now()
);

create index email_log_assoc_idx  on public.email_log (association_id, created_at desc);
create index email_log_outbox_idx on public.email_log (outbox_id);
create unique index email_log_svix_idx on public.email_log (svix_id) where svix_id is not null;

comment on table public.email_log is
  'Append-only history of what happened to each message (queued, sent, delivered, bounced, ...), including webhook events from Resend. No update or delete policy for anyone.';

-- Same-association guards ------------------------------------------------------

create or replace function public.tg_email_same_association()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'email_outbox' then
    if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id)
       or not exists (select 1 from public.email_batches b where b.id = new.batch_id and b.association_id = new.association_id)
       or exists (select 1 from unnest(new.unit_ids) x
                   where not exists (select 1 from public.units u where u.id = x and u.association_id = new.association_id)) then
      raise exception 'person, batch or unit belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'email_batches' then
    if new.rule_id is not null and not exists (
         select 1 from public.reminder_rules r where r.id = new.rule_id and r.association_id = new.association_id) then
      raise exception 'rule belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'email_preferences' then
    if not exists (select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id) then
      raise exception 'person belongs to a different association' using errcode = '42501';
    end if;
  elsif tg_table_name = 'email_log' then
    if (new.outbox_id is not null and not exists (
          select 1 from public.email_outbox o where o.id = new.outbox_id and o.association_id = new.association_id))
       or (new.person_id is not null and not exists (
          select 1 from public.persons p where p.id = new.person_id and p.association_id = new.association_id)) then
      raise exception 'outbox row or person belongs to a different association' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.tg_email_same_association() from public, anon;
grant execute on function public.tg_email_same_association() to authenticated;

create trigger email_outbox_same_association before insert or update on public.email_outbox
  for each row execute function public.tg_email_same_association();
create trigger email_batches_same_association before insert or update on public.email_batches
  for each row execute function public.tg_email_same_association();
create trigger email_preferences_same_association before insert or update on public.email_preferences
  for each row execute function public.tg_email_same_association();
create trigger email_log_same_association before insert or update on public.email_log
  for each row execute function public.tg_email_same_association();

-- The outbox state machine, frozen content, and the weekly backstop ---------------

create or replace function public.tg_email_outbox_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then return new; end if;

  -- Personal-data removal (email_redact_person) is the one edit allowed on a
  -- message that has been approved or sent: it blanks the address and facts.
  -- It says so with a transaction-local setting; nobody else can reach this
  -- table with an UPDATE (there is no update policy).
  if old.status <> 'draft'
     and coalesce(current_setting('walkup.email_redaction', true), '') <> 'on' and (
       new.to_email is distinct from old.to_email or new.person_id is distinct from old.person_id
       or new.facts is distinct from old.facts or new.board_note is distinct from old.board_note
       or new.kind is distinct from old.kind or new.batch_id is distinct from old.batch_id
       or new.unit_ids is distinct from old.unit_ids or new.template_key is distinct from old.template_key) then
    raise exception 'an approved message cannot be changed' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'draft'    and new.status in ('queued', 'cancelled', 'skipped'))
    or (old.status = 'draft'    and new.status = 'sent' and new.provider_message_id like 'manual:%')
    or (old.status = 'queued'   and new.status in ('sending', 'skipped', 'cancelled'))
    or (old.status = 'sending'  and new.status in ('sent', 'queued', 'failed'))
    or (old.status = 'sent'     and new.status in ('delivered', 'bounced', 'complained'))
    or (old.status = 'delivered' and new.status in ('bounced', 'complained'))) then
    raise exception 'a message cannot go from % to %', old.status, new.status using errcode = '42501';
  end if;

  if new.status = 'sending' and old.status <> 'sending' and exists (
       select 1 from public.email_outbox o
        where o.person_id = new.person_id and o.kind = new.kind and o.id <> new.id
          and o.status in ('sending', 'sent', 'delivered', 'bounced', 'complained')
          and o.claimed_at > now() - interval '7 days') then
    raise exception 'weekly limit: this person already received or is receiving this kind of email'
      using errcode = '53400', hint = 'weekly_cap';
  end if;
  return new;
end $$;

revoke all on function public.tg_email_outbox_guard() from public, anon;
grant execute on function public.tg_email_outbox_guard() to authenticated;

create trigger email_outbox_guard before insert or update on public.email_outbox
  for each row execute function public.tg_email_outbox_guard();

create trigger audit_email_settings after insert or update or delete on public.email_settings
  for each row execute function public.tg_audit();
create trigger audit_reminder_rules after insert or update or delete on public.reminder_rules
  for each row execute function public.tg_audit();
create trigger audit_email_batches after insert or update or delete on public.email_batches
  for each row execute function public.tg_audit();

-- RLS ---------------------------------------------------------------------------
-- Read-only for the board; owners read only their own preferences. No insert,
-- update or delete policy exists on any of these tables.

alter table public.email_settings    enable row level security;
alter table public.reminder_rules    enable row level security;
alter table public.email_preferences enable row level security;
alter table public.email_suppressions enable row level security;
alter table public.email_batches     enable row level security;
alter table public.email_outbox      enable row level security;
alter table public.email_log         enable row level security;

create policy email_settings_select on public.email_settings
  for select to authenticated using (public.is_board(association_id));
create policy reminder_rules_select on public.reminder_rules
  for select to authenticated using (public.is_board(association_id));
create policy email_preferences_select on public.email_preferences
  for select to authenticated using (person_id = public.current_person_id(association_id));
create policy email_suppressions_select on public.email_suppressions
  for select to authenticated using (public.is_board(association_id));
create policy email_batches_select on public.email_batches
  for select to authenticated using (public.is_board(association_id));
create policy email_outbox_select on public.email_outbox
  for select to authenticated using (public.is_board(association_id));
create policy email_log_select on public.email_log
  for select to authenticated using (public.is_board(association_id));

-- ----------------------------------------------------------------------------
-- 3. Internal helpers (callable only by other SECURITY DEFINER functions)
-- ----------------------------------------------------------------------------

create or replace function public.email_log_event(
  p_assoc uuid, p_outbox uuid, p_person uuid, p_email text, p_kind text,
  p_event text, p_detail text default null, p_provider text default null, p_svix text default null)
returns void language sql security definer set search_path = ''
as $$
  insert into public.email_log (association_id, outbox_id, person_id, to_email, kind, event, detail, provider_message_id, svix_id)
  values (p_assoc, p_outbox, p_person, p_email, p_kind, p_event, left(p_detail, 500), p_provider, p_svix)
$$;
revoke all on function public.email_log_event(uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- Open charges as a list for the template (at most 12 lines).
create or replace function public.email_unit_facts(p_unit_id uuid, p_as_of date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
           'unit_id', c.unit_id, 'label', c.unit_label, 'as_of', p_as_of,
           'owed', c.owed, 'overdue', c.overdue, 'credit', c.credit, 'net', c.net,
           'oldest_overdue_on', c.oldest_overdue_on,
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object('due_on', x.due_on, 'label', x.label, 'balance', x.bal) order by x.due_on)
               from (
                 select ch.due_on,
                        case ch.charge_type
                          when 'assessment' then 'Dues for ' || to_char(ch.period_start, 'FMMonth YYYY')
                          when 'special_assessment' then 'Special assessment'
                          when 'late_fee' then 'Late fee' else 'Charge' end as label,
                        (ch.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = ch.id), 0))::numeric(14,2)::text as bal
                   from public.assessment_charges ch
                  where ch.unit_id = p_unit_id and ch.waived_at is null and ch.written_off_at is null
                    and ch.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = ch.id), 0) > 0
                  order by ch.due_on limit 12) x), '[]'::jsonb))
    from public.unit_position_core(p_unit_id, p_as_of) c
$$;
revoke all on function public.email_unit_facts(uuid, date) from public, anon, authenticated;

create or replace function public.email_statement_facts(p_unit_id uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'unit_id', p_unit_id,
    'label', (select u.label from public.units u where u.id = p_unit_id),
    'from', p_from, 'to', p_to,
    'opening', coalesce((select s.balance from public.unit_statement_core(p_unit_id, p_from, p_to) s where s.kind = 'opening'), '0.00'),
    'charges', (select coalesce(sum(s.charge::numeric), 0)::numeric(14,2)::text from public.unit_statement_core(p_unit_id, p_from, p_to) s where s.kind <> 'opening'),
    'payments', (select coalesce(sum(s.payment::numeric), 0)::numeric(14,2)::text from public.unit_statement_core(p_unit_id, p_from, p_to) s where s.kind <> 'opening'),
    'adjustments', (select coalesce(sum(s.adjustment::numeric), 0)::numeric(14,2)::text from public.unit_statement_core(p_unit_id, p_from, p_to) s where s.kind <> 'opening'),
    'closing', coalesce((select s.balance from public.unit_statement_core(p_unit_id, p_from, p_to) s order by s.seq desc limit 1), '0.00'))
$$;
revoke all on function public.email_statement_facts(uuid, date, date) from public, anon, authenticated;

-- Is the snapshot still true? A reminder must not state a balance the ledger no longer shows.
create or replace function public.email_facts_current(p_kind text, p_facts jsonb)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  u jsonb;
  cur jsonb;
begin
  if p_kind in ('dues_reminder', 'late_fee_notice') then
    for u in select * from jsonb_array_elements(p_facts -> 'units') loop
      cur := public.email_unit_facts((u ->> 'unit_id')::uuid, public.email_today());
      if cur is null or cur ->> 'owed' is distinct from u ->> 'owed' or cur ->> 'overdue' is distinct from u ->> 'overdue'
         or cur ->> 'credit' is distinct from u ->> 'credit' then
        return false;
      end if;
    end loop;
    if p_kind = 'late_fee_notice' then
      return exists (
        select 1 from public.assessment_charges c
         where c.id = (p_facts ->> 'fee_charge_id')::uuid and c.charge_type = 'late_fee'
           and c.waived_at is null and c.written_off_at is null);
    end if;
    return true;
  elsif p_kind in ('statement', 'annual_statement') then
    for u in select * from jsonb_array_elements(p_facts -> 'units') loop
      cur := public.email_statement_facts((u ->> 'unit_id')::uuid, (u ->> 'from')::date, (u ->> 'to')::date);
      if cur ->> 'closing' is distinct from u ->> 'closing' then return false; end if;
    end loop;
    return true;
  elsif p_kind = 'announcement' then
    return exists (
      select 1 from public.announcements a
       where a.id = (p_facts ->> 'announcement_id')::uuid and a.status = 'published'
         and (a.expires_on is null or a.expires_on >= public.email_today()));
  end if;
  return false;
end $$;
revoke all on function public.email_facts_current(text, jsonb) from public, anon, authenticated;

create or replace function public.email_pref_allows(p_person uuid, p_kind text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select not e.unsubscribed_all and case
             when p_kind in ('dues_reminder', 'late_fee_notice') then e.dues_reminders
             when p_kind in ('statement', 'annual_statement')    then e.statements
             when p_kind = 'announcement'                        then e.announcements
             else false end
      from public.email_preferences e where e.person_id = p_person), true)
$$;
revoke all on function public.email_pref_allows(uuid, text) from public, anon, authenticated;

create or replace function public.email_daily_remaining(p_assoc uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select greatest(0,
             case when s.enabled_at > now() - interval '7 days' then least(s.daily_cap, 20) else s.daily_cap end
             - (select count(*) from public.email_outbox o
                 where o.association_id = p_assoc and o.claimed_at >= public.ai_day_start()
                   and o.status in ('sending', 'sent', 'delivered', 'bounced', 'complained')))::integer
      from public.email_settings s where s.association_id = p_assoc), 0)
$$;
revoke all on function public.email_daily_remaining(uuid) from public, anon, authenticated;

create or replace function public.email_platform_hourly_limit()
returns integer language sql immutable set search_path = '' as $$ select 300 $$;
revoke all on function public.email_platform_hourly_limit() from public, anon, authenticated;

-- Why a person cannot be emailed right now, or null when they can.
create or replace function public.email_skip_reason(p_assoc uuid, p_person uuid, p_email text, p_kind text, p_exclude_outbox uuid default null)
returns text language sql stable security definer set search_path = ''
as $$
  select case
    when not public.email_address_ok(lower(p_email)) then 'no_email'
    when exists (select 1 from public.email_suppressions s where s.association_id = p_assoc and s.email = lower(p_email)) then 'suppressed'
    when not public.email_pref_allows(p_person, p_kind) then 'opted_out'
    when exists (select 1 from public.email_outbox o
                  where o.person_id = p_person and o.kind = p_kind
                    and o.id is distinct from p_exclude_outbox
                    and o.status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained')
                    and coalesce(o.claimed_at, o.queued_at) > now() - interval '7 days') then 'weekly_cap'
    else null end
$$;
revoke all on function public.email_skip_reason(uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function public.email_ensure_preferences(p_person uuid)
returns void language sql security definer set search_path = ''
as $$
  insert into public.email_preferences (association_id, person_id)
  select p.association_id, p.id from public.persons p where p.id = p_person
  on conflict (person_id) do nothing
$$;
revoke all on function public.email_ensure_preferences(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Board functions: settings, rules, batches
-- ----------------------------------------------------------------------------

create or replace function public.email_set_sending(p_association_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can turn email sending on or off' using errcode = '42501';
  end if;
  if p_enabled and not exists (
       select 1 from public.associations a
        where a.id = p_association_id and public.email_address_ok(lower(a.board_contact_email))) then
    raise exception 'set the board contact email first; replies go there' using errcode = '22023', hint = 'no_reply_to';
  end if;
  insert into public.email_settings (association_id, sending_enabled, enabled_at, enabled_by)
  values (p_association_id, p_enabled, case when p_enabled then now() end, case when p_enabled then auth.uid() end)
  on conflict (association_id) do update set
    sending_enabled = excluded.sending_enabled,
    enabled_at = case when excluded.sending_enabled and not email_settings.sending_enabled then now()
                      when excluded.sending_enabled then email_settings.enabled_at end,
    enabled_by = case when excluded.sending_enabled and not email_settings.sending_enabled then auth.uid()
                      when excluded.sending_enabled then email_settings.enabled_by end,
    updated_at = now();
  if not p_enabled then
    -- Switching off stops everything already waiting.
    update public.email_outbox set status = 'cancelled', skip_reason = 'sending_off'
     where association_id = p_association_id and status in ('draft', 'queued');
    update public.reminder_rules set enabled = false, paused_at = null where association_id = p_association_id;
  end if;
end $$;

revoke all on function public.email_set_sending(uuid, boolean) from public, anon;
grant execute on function public.email_set_sending(uuid, boolean) to authenticated;

create or replace function public.email_set_daily_cap(p_association_id uuid, p_cap integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can change the daily limit' using errcode = '42501';
  end if;
  if p_cap < 1 or p_cap > 200 then
    raise exception 'the daily limit must be between 1 and 200' using errcode = '22023';
  end if;
  insert into public.email_settings (association_id, daily_cap) values (p_association_id, p_cap)
  on conflict (association_id) do update set daily_cap = excluded.daily_cap, updated_at = now();
end $$;

revoke all on function public.email_set_daily_cap(uuid, integer) from public, anon;
grant execute on function public.email_set_daily_cap(uuid, integer) to authenticated;

-- Platform admin only: stop one association's email at once.
create or replace function public.email_suspend(p_association_id uuid, p_suspended boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into public.email_settings (association_id, suspended_at, suspended_reason)
  values (p_association_id, case when p_suspended then now() end, case when p_suspended then left(p_reason, 300) end)
  on conflict (association_id) do update set
    suspended_at = excluded.suspended_at, suspended_reason = excluded.suspended_reason, updated_at = now();
end $$;

revoke all on function public.email_suspend(uuid, boolean, text) from public, anon;
grant execute on function public.email_suspend(uuid, boolean, text) to authenticated;

create or replace function public.email_save_rule(
  p_association_id uuid, p_kind text, p_days integer, p_min_amount numeric,
  p_repeat_every_days integer, p_max_reminders integer, p_enabled boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can change reminder rules' using errcode = '42501';
  end if;
  if p_enabled and not exists (
       select 1 from public.email_settings s
        where s.association_id = p_association_id and s.sending_enabled and s.suspended_at is null) then
    raise exception 'turn on email sending before switching on a rule' using errcode = '22023', hint = 'sending_off';
  end if;
  insert into public.reminder_rules
    (association_id, kind, days, min_amount, repeat_every_days, max_reminders, enabled, enabled_by, enabled_at)
  values
    (p_association_id, p_kind, p_days, coalesce(p_min_amount, 1.00), p_repeat_every_days, p_max_reminders,
     p_enabled, case when p_enabled then auth.uid() end, case when p_enabled then now() end)
  on conflict (association_id, kind) do update set
    days = excluded.days, min_amount = excluded.min_amount,
    repeat_every_days = excluded.repeat_every_days, max_reminders = excluded.max_reminders,
    enabled = excluded.enabled,
    enabled_by = case when excluded.enabled then auth.uid() else reminder_rules.enabled_by end,
    enabled_at = case when excluded.enabled then now() else reminder_rules.enabled_at end,
    paused_at = case when excluded.enabled then null else reminder_rules.paused_at end,
    updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.email_save_rule(uuid, text, integer, numeric, integer, integer, boolean) from public, anon;
grant execute on function public.email_save_rule(uuid, text, integer, numeric, integer, integer, boolean) to authenticated;

create or replace function public.email_set_rule_paused(p_rule_id uuid, p_paused boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare r public.reminder_rules%rowtype;
begin
  select * into r from public.reminder_rules where id = p_rule_id;
  if not found or not public.is_board(r.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.reminder_rules set paused_at = case when p_paused then now() end where id = r.id;
end $$;

revoke all on function public.email_set_rule_paused(uuid, boolean) from public, anon;
grant execute on function public.email_set_rule_paused(uuid, boolean) to authenticated;

create or replace function public.email_clear_suppression(p_association_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role_in(p_association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can clear a blocked address' using errcode = '42501';
  end if;
  -- A spam complaint is the recipient's own decision and stays; only a bounce (a bad address) can be cleared.
  delete from public.email_suppressions
   where association_id = p_association_id and email = lower(p_email) and reason = 'bounce';
  -- Clearing a block is a decision somebody made; leave a line in the log (REVIEW-1 #17).
  if found then
    perform public.email_log_event(p_association_id, null, null, lower(p_email), null,
                                   'suppression_cleared', 'Block cleared by ' || coalesce(auth.uid()::text, 'unknown'));
  end if;
end $$;

revoke all on function public.email_clear_suppression(uuid, text) from public, anon;
grant execute on function public.email_clear_suppression(uuid, text) to authenticated;

-- Prepare a batch of drafts. Facts come from the ledger here, never from the
-- caller. Recipients are the current owners of the chosen units.
create or replace function public.email_prepare_batch(
  p_association_id uuid,
  p_kind           text,
  p_unit_ids       uuid[],
  p_period_start   date default null,
  p_period_end     date default null,
  p_announcement_id uuid default null,
  p_fee_charge_id  uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_batch uuid;
  v_units uuid[] := coalesce(p_unit_ids, '{}');
  v_id    uuid;
  r       record;
  v_facts jsonb;
  v_skip  text;
  v_template text;
begin
  if not public.is_board(p_association_id) then
    raise exception 'only the board can prepare email' using errcode = '42501';
  end if;
  if p_kind not in ('dues_reminder', 'late_fee_notice', 'statement', 'annual_statement', 'announcement') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if cardinality(v_units) > 100 then
    raise exception 'at most 100 units in one batch' using errcode = '22023';
  end if;
  if p_kind in ('dues_reminder', 'statement', 'annual_statement') and cardinality(v_units) = 0 then
    raise exception 'choose at least one unit' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_units) x where not exists (
       select 1 from public.units u where u.id = x and u.association_id = p_association_id)) then
    raise exception 'unit belongs to a different association' using errcode = '42501';
  end if;
  if p_kind in ('statement', 'annual_statement') and (p_period_start is null or p_period_end is null) then
    raise exception 'a statement needs a period' using errcode = '22023';
  end if;

  if p_kind = 'late_fee_notice' then
    select array[c.unit_id] into v_units from public.assessment_charges c
     where c.id = p_fee_charge_id and c.association_id = p_association_id and c.charge_type = 'late_fee'
       and c.waived_at is null and c.written_off_at is null
       and c.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = c.id), 0) > 0;
    if v_units is null then
      raise exception 'that late fee is not charged or is already settled' using errcode = '22023', hint = 'fee_not_open';
    end if;
  end if;
  if p_kind = 'announcement' and not exists (
       select 1 from public.announcements a
        where a.id = p_announcement_id and a.association_id = p_association_id and a.status = 'published') then
    raise exception 'that announcement is not posted' using errcode = '22023';
  end if;

  insert into public.email_batches (association_id, kind, period_start, period_end)
  values (p_association_id, p_kind, p_period_start, p_period_end)
  returning id into v_batch;

  v_template := p_kind;

  for r in
    select p.id as person_id, lower(p.email) as email, p.full_name,
           array_agg(distinct uo.unit_id) as owned
      from public.unit_owners uo
      join public.persons p on p.id = uo.person_id
     where uo.association_id = p_association_id
       and uo.effective_from <= public.email_today()
       and (uo.effective_to is null or uo.effective_to >= public.email_today())
       and (
         (p_kind = 'announcement' and exists (
            select 1 from public.announcements a
             where a.id = p_announcement_id
               and (a.audience = 'all' or exists (
                     select 1 from public.announcement_units au
                      where au.announcement_id = a.id and au.unit_id = uo.unit_id))))
         or (p_kind <> 'announcement' and uo.unit_id = any (v_units)))
     group by p.id, p.email, p.full_name
  loop
    if p_kind = 'dues_reminder' then
      select jsonb_build_object('units', coalesce(jsonb_agg(public.email_unit_facts(x, public.email_today())), '[]'::jsonb))
        into v_facts
        from unnest(r.owned) x
       where x = any (v_units)
          -- THE NET RULE (REVIEW-4 #5): a unit is dunned for what is past due after its
          -- unapplied payments are counted, the same figure the statement ends on.
          and greatest((public.email_unit_facts(x, public.email_today()) ->> 'overdue')::numeric
                       - (public.email_unit_facts(x, public.email_today()) ->> 'credit')::numeric, 0) > 0;
      if jsonb_array_length(v_facts -> 'units') = 0 then continue; end if;
    elsif p_kind = 'late_fee_notice' then
      v_facts := jsonb_build_object(
        'units', jsonb_build_array(public.email_unit_facts(v_units[1], public.email_today())),
        'fee_charge_id', p_fee_charge_id,
        'fee_amount', (select c.amount::numeric(14,2)::text from public.assessment_charges c where c.id = p_fee_charge_id),
        'fee_charged_on', (select c.due_on from public.assessment_charges c where c.id = p_fee_charge_id));
    elsif p_kind in ('statement', 'annual_statement') then
      select jsonb_build_object('units', jsonb_agg(public.email_statement_facts(x, p_period_start, p_period_end)))
        into v_facts from unnest(r.owned) x where x = any (v_units);
    else
      v_facts := jsonb_build_object('announcement_id', p_announcement_id);
    end if;

    perform public.email_ensure_preferences(r.person_id);
    v_skip := public.email_skip_reason(p_association_id, r.person_id, r.email, p_kind);
    v_id := gen_random_uuid();
    insert into public.email_outbox
      (id, association_id, batch_id, kind, person_id, unit_ids, to_email, to_name, facts,
       template_key, status, skip_reason, idempotency_key)
    values
      (v_id, p_association_id, v_batch, p_kind, r.person_id,
       case when p_kind = 'announcement' then r.owned else (select coalesce(array_agg(x), '{}') from unnest(r.owned) x where x = any (v_units)) end,
       coalesce(nullif(r.email, ''), 'invalid@invalid.invalid'), left(r.full_name, 120), v_facts,
       v_template, case when v_skip is null then 'draft' else 'skipped' end, v_skip, 'wk-' || v_id::text);
  end loop;

  return v_batch;
end $$;

revoke all on function public.email_prepare_batch(uuid, text, uuid[], date, date, uuid, uuid) from public, anon;
grant execute on function public.email_prepare_batch(uuid, text, uuid[], date, date, uuid, uuid) to authenticated;

create or replace function public.email_edit_draft(p_outbox_id uuid, p_board_note text, p_left_out boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare o public.email_outbox%rowtype;
begin
  select * into o from public.email_outbox where id = p_outbox_id;
  if not found or not public.is_board(o.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if o.status not in ('draft', 'cancelled') or (o.status = 'cancelled' and o.skip_reason is distinct from 'left_out') then
    raise exception 'this message can no longer be edited' using errcode = '22023';
  end if;
  if not exists (select 1 from public.email_batches b where b.id = o.batch_id and b.status = 'draft') then
    raise exception 'this batch has already been approved' using errcode = '22023';
  end if;
  if p_left_out then
    update public.email_outbox set status = 'cancelled', skip_reason = 'left_out' where id = o.id and status = 'draft';
  elsif o.status = 'cancelled' then
    -- cancelled -> draft is not in the state machine; a left-out message is re-prepared instead
    raise exception 'prepare the batch again to include this person' using errcode = '22023';
  else
    update public.email_outbox set board_note = nullif(btrim(p_board_note), '') where id = o.id;
  end if;
end $$;

revoke all on function public.email_edit_draft(uuid, text, boolean) from public, anon;
grant execute on function public.email_edit_draft(uuid, text, boolean) to authenticated;

create or replace function public.email_cancel_batch(p_batch_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare b public.email_batches%rowtype;
begin
  select * into b from public.email_batches where id = p_batch_id;
  if not found or not public.is_board(b.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.email_outbox set status = 'cancelled', skip_reason = coalesce(skip_reason, 'cancelled')
   where batch_id = b.id and status in ('draft', 'queued');
  update public.email_batches set status = 'cancelled' where id = b.id and status = 'draft';
end $$;

revoke all on function public.email_cancel_batch(uuid) from public, anon;
grant execute on function public.email_cancel_batch(uuid) to authenticated;

-- The approval. Board admin only, MFA-gated through has_role_in.
create or replace function public.email_approve_batch(p_batch_id uuid)
returns table (queued integer, skipped integer)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  b public.email_batches%rowtype;
  o record;
  v_left integer;
  v_skip text;
  v_q integer := 0;
  v_s integer := 0;
begin
  select * into b from public.email_batches where id = p_batch_id for update;
  if not found or not public.has_role_in(b.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'only a board admin can approve sending' using errcode = '42501';
  end if;
  if b.status <> 'draft' then
    raise exception 'this batch has already been approved or cancelled' using errcode = '22023';
  end if;
  if not exists (select 1 from public.email_settings s
                  where s.association_id = b.association_id and s.sending_enabled and s.suspended_at is null) then
    raise exception 'email sending is off for this building' using errcode = '22023', hint = 'sending_off';
  end if;
  if not exists (select 1 from public.associations a where a.id = b.association_id and public.email_address_ok(lower(a.board_contact_email))) then
    raise exception 'set the board contact email first' using errcode = '22023', hint = 'no_reply_to';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('email:' || b.association_id::text, 0));
  v_left := public.email_daily_remaining(b.association_id);

  for o in select * from public.email_outbox where batch_id = b.id and status = 'draft' order by created_at loop
    v_skip := public.email_skip_reason(b.association_id, o.person_id, o.to_email, o.kind, o.id);
    if v_skip is null and v_left <= 0 then v_skip := 'daily_cap'; end if;
    if v_skip is null and not exists (
         select 1 from public.persons p where p.id = o.person_id and lower(p.email) = o.to_email) then
      v_skip := 'address_changed';
    end if;
    if v_skip is null then
      update public.email_outbox set status = 'queued', queued_at = now() where id = o.id;
      perform public.email_log_event(b.association_id, o.id, o.person_id, o.to_email, o.kind, 'queued');
      v_left := v_left - 1; v_q := v_q + 1;
    else
      update public.email_outbox set status = 'skipped', skip_reason = v_skip where id = o.id;
      perform public.email_log_event(b.association_id, o.id, o.person_id, o.to_email, o.kind, 'skipped', v_skip);
      v_s := v_s + 1;
    end if;
  end loop;

  update public.email_batches set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = b.id;
  return query select v_q, v_s;
end $$;

revoke all on function public.email_approve_batch(uuid) from public, anon;
grant execute on function public.email_approve_batch(uuid) to authenticated;

-- Walkup did not send this one: a board member opened it in their own mail
-- app (or Walkup sending is off) and says they sent it. Recorded so the
-- history, the weekly limit and "last reminded" stay true. Any board member.
create or replace function public.email_mark_sent_by_hand(p_outbox_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare o public.email_outbox%rowtype;
begin
  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found or not public.is_board(o.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if o.status <> 'draft' then
    raise exception 'this message is not a draft' using errcode = '22023';
  end if;
  update public.email_outbox
     set status = 'sent', sent_at = now(), claimed_at = now(), queued_at = coalesce(queued_at, now()),
         provider_message_id = 'manual:' || o.id::text
   where id = o.id;
  perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, 'sent', 'Sent by hand from a board member''s own email');
end $$;

revoke all on function public.email_mark_sent_by_hand(uuid) from public, anon;
grant execute on function public.email_mark_sent_by_hand(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Sending: claim, mark sent, mark failed
-- ----------------------------------------------------------------------------
-- Used by the board's own "Send" request (as the signed-in board admin) and by
-- the daily cron (service key). Both go through the same checks.

create or replace function public.email_claim(p_batch_id uuid, p_limit integer default 10)
returns table (
  outbox_id uuid, claim_token uuid, association_id uuid, kind text, to_email text, to_name text,
  facts jsonb, board_note text, template_key text, template_version smallint,
  idempotency_key text, attempts smallint, unsubscribe_token text,
  association_name text, reply_to_email text, reply_to_name text, batch_id uuid, has_login boolean)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  o record;
  v_assoc uuid;
  v_skip text;
  v_hour integer;
  v_token uuid;
  v_n integer := 0;
begin
  if p_batch_id is null then
    if not public.email_is_service() then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  else
    select b.association_id into v_assoc from public.email_batches b where b.id = p_batch_id;
    if v_assoc is null or not (public.email_is_service()
         or public.has_role_in(v_assoc, array['board_admin']::public.app_role[])) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;

  -- Release messages whose sender died mid-send. Within 20 hours the same
  -- Resend idempotency key makes a second attempt safe; after that the
  -- outcome is unknown and a person must check before anything is resent.
  update public.email_outbox x set status = 'queued', not_before = null
   where x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'
     and x.claimed_at > now() - interval '20 hours' and x.attempts < 3
     and (p_batch_id is null or x.batch_id = p_batch_id);
  update public.email_outbox x set status = 'failed', last_error = 'Outcome unknown: the send did not report back. Check Resend before sending again.'
   where x.status = 'sending' and x.claimed_at <= now() - interval '20 hours'
     and (p_batch_id is null or x.batch_id = p_batch_id);

  for o in
    select x.* from public.email_outbox x
      join public.email_batches b on b.id = x.batch_id
     where x.status = 'queued' and b.status = 'approved'
       and (x.not_before is null or x.not_before <= now())
       and (p_batch_id is null or x.batch_id = p_batch_id)
       -- The daily cron (no batch) has no signed-in session to read a statement
       -- PDF or an announcement with, so it sends only the plain reminder kinds;
       -- a statement or announcement batch is finished from the review page.
       and (p_batch_id is not null or x.kind in ('dues_reminder', 'late_fee_notice'))
     order by x.queued_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update of x skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended('email:' || o.association_id::text, 0));

    select count(*) into v_hour from public.email_outbox z
     where z.claimed_at > now() - interval '1 hour' and z.status in ('sending', 'sent', 'delivered', 'bounced', 'complained');

    v_skip := case
      when not exists (select 1 from public.email_settings s where s.association_id = o.association_id and s.sending_enabled and s.suspended_at is null)
        then 'sending_off'
      when not exists (select 1 from public.persons p where p.id = o.person_id and lower(p.email) = o.to_email)
        then 'address_changed'
      else public.email_skip_reason(o.association_id, o.person_id, o.to_email, o.kind, o.id) end;
    if v_skip is null and not public.email_facts_current(o.kind, o.facts) then v_skip := 'balance_changed'; end if;
    if v_skip is null and public.email_daily_remaining(o.association_id) <= 0 then v_skip := 'daily_cap'; end if;
    -- The hourly platform ceiling is a pause, not a verdict (REVIEW-4 #8): the message stays
    -- queued and is looked at again in ten minutes; nothing further is claimed this call.
    if v_skip is null and v_hour >= public.email_platform_hourly_limit() then
      update public.email_outbox set not_before = now() + interval '10 minutes' where id = o.id;
      exit;
    end if;

    if v_skip is not null then
      update public.email_outbox set status = 'skipped', skip_reason = v_skip where id = o.id;
      perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, 'skipped', v_skip);
      continue;
    end if;

    v_token := gen_random_uuid();
    update public.email_outbox set status = 'sending', claim_token = v_token, claimed_at = now(), attempts = attempts + 1
     where id = o.id;
    perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, 'claimed');

    return query
      select o.id, v_token, o.association_id, o.kind, o.to_email, o.to_name, o.facts, o.board_note,
             o.template_key, o.template_version, o.idempotency_key, (o.attempts + 1)::smallint,
             (select e.token from public.email_preferences e where e.person_id = o.person_id),
             a.display_name, lower(a.board_contact_email), a.board_contact_name, o.batch_id,
             (select p.auth_user_id is not null from public.persons p where p.id = o.person_id)
        from public.associations a where a.id = o.association_id;
    v_n := v_n + 1;
  end loop;
end $$;

revoke all on function public.email_claim(uuid, integer) from public, anon;
grant execute on function public.email_claim(uuid, integer) to authenticated, service_role;

create or replace function public.email_mark_sent(
  p_outbox_id uuid, p_claim_token uuid, p_provider_message_id text, p_subject text)
returns void language plpgsql security definer set search_path = ''
as $$
declare o public.email_outbox%rowtype;
begin
  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found or not (public.email_is_service() or public.has_role_in(o.association_id, array['board_admin']::public.app_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if o.status in ('sent', 'delivered') and o.provider_message_id = p_provider_message_id then return; end if;
  if o.status <> 'sending' or o.claim_token is distinct from p_claim_token then
    raise exception 'this message is not claimed by you' using errcode = '22023';
  end if;
  update public.email_outbox
     set status = 'sent', sent_at = now(), provider_message_id = left(p_provider_message_id, 200), subject = left(p_subject, 300), last_error = null
   where id = o.id;
  perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, 'sent', null, p_provider_message_id);
end $$;

revoke all on function public.email_mark_sent(uuid, uuid, text, text) from public, anon;
grant execute on function public.email_mark_sent(uuid, uuid, text, text) to authenticated, service_role;

create or replace function public.email_mark_failed(
  p_outbox_id uuid, p_claim_token uuid, p_error text, p_retryable boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare o public.email_outbox%rowtype;
begin
  select * into o from public.email_outbox where id = p_outbox_id for update;
  if not found or not (public.email_is_service() or public.has_role_in(o.association_id, array['board_admin']::public.app_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if o.status <> 'sending' or o.claim_token is distinct from p_claim_token then
    raise exception 'this message is not claimed by you' using errcode = '22023';
  end if;
  if p_retryable and o.attempts < 3 then
    update public.email_outbox
       set status = 'queued', last_error = left(p_error, 500), not_before = now() + (o.attempts * interval '10 minutes')
     where id = o.id;
  else
    update public.email_outbox set status = 'failed', last_error = left(p_error, 500) where id = o.id;
  end if;
  perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, 'failed', p_error);
end $$;

revoke all on function public.email_mark_failed(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.email_mark_failed(uuid, uuid, text, boolean) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Service-only: rules and Resend events
-- ----------------------------------------------------------------------------

create or replace function public.email_run_rules(p_today date)
returns table (association_id uuid, batch_id uuid, queued integer)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  rl record;
  v_batch uuid;
  v_n integer;
  c record;
  v_id uuid;
  v_facts jsonb;
  v_skip text;
begin
  if not public.email_is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for rl in
    select r.* from public.reminder_rules r
      join public.email_settings s on s.association_id = r.association_id
     where r.enabled and r.paused_at is null and s.sending_enabled and s.suspended_at is null
       and (r.last_run_on is null or r.last_run_on < p_today)
       -- A standing rule carries its enabler's approval. Once that person no longer holds an active
       -- board_admin grant here, the rule does not run until a current admin turns it on again.
       and exists (
         select 1 from public.role_grants g join public.persons gp on gp.id = g.person_id
          where gp.auth_user_id = r.enabled_by and g.association_id = r.association_id
            and g.role = 'board_admin' and g.revoked_at is null
            and (g.expires_on is null or g.expires_on >= p_today))
  loop
    v_batch := null; v_n := 0;

    for c in
      with owned as (
        select uo.unit_id, p.id as person_id, lower(p.email) as email, p.full_name
          from public.unit_owners uo join public.persons p on p.id = uo.person_id
         where uo.association_id = rl.association_id and uo.effective_from <= p_today
           and (uo.effective_to is null or uo.effective_to >= p_today)
      ), pos as (
        select o.*, f as facts
          from owned o, lateral public.email_unit_facts(o.unit_id, p_today) f
      ), due as (
        select pos.*,
               -- net rule: what is owed after unapplied payments, never below zero
               greatest((pos.facts ->> 'owed')::numeric - (pos.facts ->> 'credit')::numeric, 0) as owed_n,
               greatest((pos.facts ->> 'overdue')::numeric - (pos.facts ->> 'credit')::numeric, 0) as overdue_n,
               (pos.facts ->> 'oldest_overdue_on')::date as oldest,
               (select min(ch.due_on) from public.assessment_charges ch
                 where ch.unit_id = pos.unit_id and ch.waived_at is null and ch.written_off_at is null
                   and ch.due_on >= p_today
                   and ch.amount - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.charge_id = ch.id), 0) > 0) as next_due
          from pos
      )
      select d.person_id, d.email, d.full_name,
             array_agg(d.unit_id) as unit_ids,
             jsonb_agg(d.facts) as unit_facts
        from due d
       where d.owed_n >= rl.min_amount
         and (
           (rl.kind = 'dues_overdue' and d.overdue_n > 0 and d.oldest is not null and p_today - d.oldest >= rl.days
              and (select count(*) from public.email_outbox ob
                    where d.unit_id = any (ob.unit_ids) and ob.kind = 'dues_reminder' and ob.batch_id in (
                          select bb.id from public.email_batches bb where bb.rule_id = rl.id)
                      and ob.status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained')
                      and (ob.created_at at time zone 'America/Chicago')::date >= d.oldest) < rl.max_reminders
              and not exists (select 1 from public.email_outbox ob
                    where d.unit_id = any (ob.unit_ids) and ob.kind = 'dues_reminder'
                      and ob.batch_id in (select bb.id from public.email_batches bb where bb.rule_id = rl.id)
                      and ob.status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained')
                      and (ob.created_at at time zone 'America/Chicago')::date > p_today - rl.repeat_every_days))
           or (rl.kind = 'dues_upcoming' and d.next_due is not null and d.next_due - p_today <= rl.days
               and d.overdue_n = 0)
         )
       group by d.person_id, d.email, d.full_name
    loop
      v_skip := public.email_skip_reason(rl.association_id, c.person_id, c.email, 'dues_reminder');
      if v_skip is not null then continue; end if;
      if v_batch is null then
        insert into public.email_batches (association_id, kind, source, rule_id, status, created_by, approved_by, approved_at)
        values (rl.association_id, 'dues_reminder', 'rule', rl.id, 'approved', rl.enabled_by, rl.enabled_by, now())
        returning id into v_batch;
      end if;
      perform public.email_ensure_preferences(c.person_id);
      v_id := gen_random_uuid();
      insert into public.email_outbox
        (id, association_id, batch_id, kind, person_id, unit_ids, to_email, to_name, facts,
         template_key, status, queued_at, idempotency_key)
      values
        (v_id, rl.association_id, v_batch, 'dues_reminder', c.person_id, c.unit_ids, c.email, left(c.full_name, 120),
         jsonb_build_object('units', c.unit_facts, 'rule_kind', rl.kind, 'rule_days', rl.days),
         case rl.kind when 'dues_upcoming' then 'dues_upcoming' else 'dues_reminder' end, 'queued', now(), 'wk-' || v_id::text);
      perform public.email_log_event(rl.association_id, v_id, c.person_id, c.email, 'dues_reminder', 'queued', 'rule ' || rl.kind);
      v_n := v_n + 1;
    end loop;

    update public.reminder_rules set last_run_on = p_today where id = rl.id;
    if v_batch is not null then
      association_id := rl.association_id; batch_id := v_batch; queued := v_n;
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.email_run_rules(date) from public, anon, authenticated;
grant execute on function public.email_run_rules(date) to service_role;

-- A webhook event from Resend. Unknown message ids (Walkup's account emails
-- also go through Resend) are ignored. A replayed event (same svix id) is
-- ignored. Returns what happened.
create or replace function public.email_record_event(
  p_provider_message_id text, p_event text, p_detail text, p_svix_id text, p_permanent boolean default true)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  o public.email_outbox%rowtype;
  v_event text;
begin
  if not public.email_is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into o from public.email_outbox where provider_message_id = p_provider_message_id for update;
  if not found then return 'ignored'; end if;
  v_event := case p_event
    when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained' when 'email.delivery_delayed' then 'delayed'
    when 'email.failed' then 'failed' else null end;
  if v_event is null then return 'ignored'; end if;
  -- A temporary bounce (mailbox full, server busy) is news, not a reason to stop writing to someone.
  if v_event = 'bounced' and not p_permanent then v_event := 'delayed'; end if;
  if p_svix_id is not null and exists (select 1 from public.email_log where svix_id = p_svix_id) then
    return 'duplicate';
  end if;

  perform public.email_log_event(o.association_id, o.id, o.person_id, o.to_email, o.kind, v_event, p_detail, p_provider_message_id, p_svix_id);

  if v_event = 'delivered' and o.status = 'sent' then
    update public.email_outbox set status = 'delivered' where id = o.id;
  elsif v_event = 'bounced' and o.status in ('sent', 'delivered') then
    update public.email_outbox set status = 'bounced', last_error = left(p_detail, 500) where id = o.id;
    insert into public.email_suppressions (association_id, email, reason)
    values (o.association_id, o.to_email, 'bounce') on conflict (association_id, email) do nothing;
  elsif v_event = 'complained' and o.status in ('sent', 'delivered') then
    update public.email_outbox set status = 'complained' where id = o.id;
    insert into public.email_suppressions (association_id, email, reason)
    values (o.association_id, o.to_email, 'complaint') on conflict (association_id, email) do nothing;
    perform public.email_ensure_preferences(o.person_id);
    update public.email_preferences set unsubscribed_all = true, updated_at = now() where person_id = o.person_id;
  end if;
  return v_event;
end $$;

revoke all on function public.email_record_event(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.email_record_event(text, text, text, text, boolean) to service_role;

-- Message history is kept 24 months, then removed (the batch rows stay: they
-- hold no personal data). Called by the daily cron.
create or replace function public.email_purge(p_months integer default 24)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if not public.email_is_service() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_months < 12 then
    raise exception 'history is kept at least 12 months' using errcode = '22023';
  end if;
  delete from public.email_log where created_at < now() - make_interval(months => p_months);
  delete from public.email_outbox o
   where o.created_at < now() - make_interval(months => p_months)
     and not exists (select 1 from public.email_log l where l.outbox_id = o.id);
  get diagnostics v_n = row_count;
  -- Also the daily home for another retention rule: abandoned import batches
  -- lose their staged rows after 14 days (0056, REVIEW-1 #17).
  perform public.import_expire_stale(14);
  return v_n;
end $$;

revoke all on function public.email_purge(integer) from public, anon, authenticated;
grant execute on function public.email_purge(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 7. People: preferences and the unsubscribe link
-- ----------------------------------------------------------------------------

create or replace function public.set_my_email_preferences(
  p_association_id uuid, p_dues_reminders boolean, p_statements boolean, p_announcements boolean, p_unsubscribed_all boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_person uuid := public.current_person_id(p_association_id);
begin
  if v_person is null then raise exception 'not allowed' using errcode = '42501'; end if;
  perform public.email_ensure_preferences(v_person);
  update public.email_preferences
     set dues_reminders = p_dues_reminders, statements = p_statements,
         announcements = p_announcements, unsubscribed_all = p_unsubscribed_all, updated_at = now()
   where person_id = v_person;
end $$;

revoke all on function public.set_my_email_preferences(uuid, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.set_my_email_preferences(uuid, boolean, boolean, boolean, boolean) to authenticated;

-- Creates the caller's row on first look, so the page can show their token-free state.
create or replace function public.my_email_preferences(p_association_id uuid)
returns table (dues_reminders boolean, statements boolean, announcements boolean, unsubscribed_all boolean, email text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare v_person uuid := public.current_person_id(p_association_id);
begin
  if v_person is null then return; end if;
  perform public.email_ensure_preferences(v_person);
  return query
    select e.dues_reminders, e.statements, e.announcements, e.unsubscribed_all, p.email
      from public.email_preferences e join public.persons p on p.id = e.person_id
     where e.person_id = v_person;
end $$;

revoke all on function public.my_email_preferences(uuid) from public, anon;
grant execute on function public.my_email_preferences(uuid) to authenticated;

-- Board: who has opted out of what (no tokens, no other data).
create or replace function public.email_optouts(p_association_id uuid)
returns table (person_id uuid, dues_reminders boolean, statements boolean, announcements boolean, unsubscribed_all boolean)
language sql stable security definer set search_path = ''
as $$
  select e.person_id, e.dues_reminders, e.statements, e.announcements, e.unsubscribed_all
    from public.email_preferences e
   where e.association_id = p_association_id and public.is_board(p_association_id)
     and (not e.dues_reminders or not e.statements or not e.announcements or e.unsubscribed_all)
$$;

revoke all on function public.email_optouts(uuid) from public, anon;
grant execute on function public.email_optouts(uuid) to authenticated;

-- The two functions a signed-out person's unsubscribe link may call
-- (DECISIONS #36; the only anon-callable functions besides #34's waitlist).
-- The token is the whole credential: 48 bytes of randomness. Showing the page
-- never changes anything; only email_unsubscribe does.

create or replace function public.email_preference_for_token(p_token text)
returns table (association_name text, masked_email text, dues_reminders boolean, statements boolean, announcements boolean, unsubscribed_all boolean)
language sql stable security definer set search_path = ''
as $$
  select a.display_name,
         regexp_replace(coalesce(p.email, ''), '^(.).*(@.*)$', '\1***\2'),
         e.dues_reminders, e.statements, e.announcements, e.unsubscribed_all
    from public.email_preferences e
    join public.persons p on p.id = e.person_id
    join public.associations a on a.id = e.association_id
   where e.token = p_token and char_length(p_token) = 96
$$;

revoke all on function public.email_preference_for_token(text) from public;
grant execute on function public.email_preference_for_token(text) to anon, authenticated;

create or replace function public.email_unsubscribe(p_token text, p_scope text, p_subscribe boolean default false)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare e public.email_preferences%rowtype;
begin
  if p_scope not in ('all', 'dues_reminders', 'statements', 'announcements') then
    raise exception 'unknown scope' using errcode = '22023';
  end if;
  select * into e from public.email_preferences where token = p_token and char_length(p_token) = 96 for update;
  if not found then return false; end if;
  update public.email_preferences set
    unsubscribed_all = case when p_scope = 'all' then not p_subscribe else unsubscribed_all end,
    dues_reminders   = case when p_scope = 'dues_reminders' then p_subscribe else dues_reminders end,
    statements       = case when p_scope = 'statements' then p_subscribe else statements end,
    announcements    = case when p_scope = 'announcements' then p_subscribe else announcements end,
    updated_at = now()
   where id = e.id;
  perform public.email_log_event(e.association_id, null, e.person_id, null, null,
            case when p_subscribe then 'resubscribed' else 'unsubscribed' end, p_scope);
  return true;
end $$;

revoke all on function public.email_unsubscribe(text, text, boolean) from public;
grant execute on function public.email_unsubscribe(text, text, boolean) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. Personal-data removal reaches the email tables (DECISIONS #30)
-- ----------------------------------------------------------------------------
-- redact_person (0037, last replaced by 0048) is replaced with the 0048 body plus one call: the
-- person's address is blanked in the outbox and log, their preferences are
-- deleted and their address is dropped from the suppression list.

create or replace function public.email_redact_person(p_person_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('walkup.email_redaction', 'on', true);
  update public.email_outbox set to_email = 'removed@invalid.invalid', to_name = null, facts = '{}'::jsonb, board_note = null
   where person_id = p_person_id;
  perform set_config('walkup.email_redaction', 'off', true);
  update public.email_log set to_email = null where person_id = p_person_id;
  delete from public.email_preferences where person_id = p_person_id;
  if p_email is not null then
    delete from public.email_suppressions where email = lower(p_email)
      and association_id = (select association_id from public.persons where id = p_person_id);
  end if;
end $$;

revoke all on function public.email_redact_person(uuid, text) from public, anon, authenticated;

create or replace function public.redact_person(p_person_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  p public.persons%rowtype;
begin
  select * into p from public.persons where id = p_person_id;
  if not found then
    raise exception 'person not found';
  end if;

  if not public.has_role_in(
       p.association_id, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to remove personal data for this association'
      using errcode = '42501';
  end if;

  if p.auth_user_id is not null and p.auth_user_id = auth.uid() then
    raise exception 'you can''t remove your own personal data from here';
  end if;

  if exists (
    select 1 from public.role_grants g
     where g.person_id = p.id
       and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date)) then
    raise exception 'revoke this person''s access before removing their personal data';
  end if;

  if exists (
    select 1 from public.unit_owners uo
     where uo.person_id = p.id
       and (uo.effective_to is null or uo.effective_to >= current_date)) then
    raise exception 'this person still owns a unit — record the ownership change first';
  end if;

  if exists (
    select 1 from public.associations a where a.accountant_person_id = p.id) then
    raise exception 'this person is recorded as your tax accountant — choose another accountant first';
  end if;

  update public.persons
     set full_name       = 'Former member',
         email           = null,
         phone           = null,
         mailing_address = null,
         auth_user_id    = null
   where id = p.id;

  perform public.email_redact_person(p.id, p.email);

  if p.email is not null then
    update public.invites
       set email = null
     where association_id = p.association_id
       and lower(email) = lower(p.email);

    update public.audit_log
       set before_data = case when before_data is null then null
                              else before_data || jsonb_build_object('email', null) end,
           after_data  = case when after_data is null then null
                              else after_data  || jsonb_build_object('email', null) end
     where association_id = p.association_id
       and table_name = 'invites'
       and (lower(before_data->>'email') = lower(p.email)
         or lower(after_data->>'email')  = lower(p.email));
  end if;

  update public.audit_log
     set before_data = case when before_data is null then null
                            else before_data || jsonb_build_object(
                              'full_name', '[redacted]', 'email', null,
                              'phone', null, 'mailing_address', null) end,
         after_data  = case when after_data is null then null
                            else after_data || jsonb_build_object(
                              'full_name', case when after_data->>'full_name' = 'Former member'
                                                then 'Former member' else '[redacted]' end,
                              'email', null, 'phone', null, 'mailing_address', null) end
   where association_id = p.association_id
     and table_name = 'persons'
     and record_id = p.id;
end $$;

revoke all on function public.redact_person(uuid) from public, anon;
grant execute on function public.redact_person(uuid) to authenticated;
