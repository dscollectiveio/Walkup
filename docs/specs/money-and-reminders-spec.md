# Money features: reminders by email and owner statements

Doug, 2026-10-14: "Money features. Owner dues reminders and owner statements.
Walkup still wouldn't move money." and "Reminders by email: Walkup never sends
anything itself, which is safe, but it means every reminder is a manual step."

This spec designs: dues reminders and late-fee notices sent by email after a
board administrator approves them (a batch, or a standing rule); owner
statements as a PDF and as an email, per unit, for a period or for the year;
a collections view (who is behind, how long, who was reminded); and the
database, cron, webhook, unsubscribe and legal text that go with them.
**Walkup still never moves money, never holds an account, and never puts a
payment account number in an email.**

It follows `docs/specs/insurance-repairs-overhaul.md` section 4 (quality bar),
reuses the foundation's `DraftEmail` and mailto kit (`docs/specs/foundation-spec.md`
section 7) and the Resend relationship already named on the privacy page, and
depends on `owner-portal-spec.md` (migration 0054: `unit_statement*`,
`unit_position_core`, `board_contact_email`, the portal pages that link here).

Status: design only. The SQL in section 3 was applied on a scratch PGlite
database after 0001 to 0054 and exercised (approval, claim, retry, weekly cap,
staleness, opt-out, bounce suppression, rule run, replay of a webhook event,
signed-out unsubscribe, cross-association isolation, the lint queries from
`tests/db/migrations.test.ts` and `rls.test.ts`) before it was written here.
Migration order: **0054 owner portal, 0055 this, 0056 imports.**

---

## 0. Contents

1. Decision #36, scope, what exists today
2. Architecture: who runs what, the service-role exception, environment, DNS
3. Migration `0055_email_reminders.sql` (complete draft SQL) and its limits
4. Libraries: configuration, Resend client, templates, statements, collections
5. The sending pipeline: batch, claim, send, record; cron; webhook; unsubscribe
6. Server actions
7. The emails: exact copy
8. Pages, with copy and states
9. Statement PDF
10. Security review
11. CAN-SPAM checklist
12. Privacy page and Terms text
13. Test plan
14. Build order
15. Integration tasks
16. Deliberately left out

---

## 1. Decision #36, scope, what exists today

### 1.1 Decision #36 (text for `docs/DECISIONS.md`)

> **36. Walkup sends no email to anyone unless a board administrator has
> approved it.** Decided by the lead engineer on Doug's behalf, 2026-10-14,
> after Doug asked for reminders and statements by email ("every reminder is a
> manual step"). This relaxes #22's "No automatic sending" (and the matching
> sentences in the Terms and the Privacy Policy). It does not relax #22's
> "No payment initiation".
>
> What "approved" means:
> (a) **A batch.** The board reviews drafted emails (who, why, the numbers,
> the optional note) and a board admin presses "Send these N emails from
> Walkup". Approval is recorded (`email_batches.approved_by/at`).
> (b) **A standing rule.** A board admin switches on a rule per reminder type
> ("send a dues reminder when a unit is N days overdue"). Each rule is visible,
> pausable, and has a send log. The admin who switched it on is the approver of
> everything it sends. Rules exist only for dues reminders; statements, late-fee
> notices and announcements are always a batch.
>
> What is enforced in SQL, not in the app (0055): recipients are people in this
> association whose address still matches; one email per person per week per
> kind; at most 20 a day for a week after sending is switched on, then the
> board's daily limit (default 60, never above 200); 300 an hour for the whole
> platform; never to an address that hard-bounced or complained; never to
> someone who opted out; a reminder is skipped, not sent, if the balance in it
> is no longer what the ledger shows; a message sends once (claim token plus
> the provider's idempotency key); sending is off until a board admin turns it
> on and a reply-to contact is set; a platform admin can suspend an
> association.
>
> What an email may contain: text built from a template and facts read from
> the ledger (money formatted from stored text values), plus an optional note
> the board typed (500 characters, no links or addresses). **No model writes
> any email.** No account number, routing number or Zelle handle is ever in an
> email; the email links to the owner's page in Walkup (or, for an owner with no
> login, says to ask the board). Every email carries: who it is from ("Walkup
> on behalf of {association}", from `notifications@walkuphoa.com`), the board's
> contact as reply-to, a one-click unsubscribe link and header, and a plain
> footer naming DS Collective LLC and the association.
>
> Delivery is through Resend's HTTP API (`RESEND_API_KEY`). Without the key the
> app works fully: drafts are prepared, reviewed and opened with `mailto:`, and
> "Mark as sent" records them.
>
> **Service role.** #28's single exception (the daily bank sync) becomes three
> narrow entry points, all in `src/app/api/**`: the bank-sync cron (unchanged),
> the reminder cron, and the Resend webhook. The two new ones use the service
> key only through `serviceRpc()`, an allowlist wrapper that can call six named
> functions that are granted to `service_role` and nobody else. They never read
> or write a table directly.
>
> **Signed-out writes.** #34's single `anon` function becomes three. The two
> added are `email_preference_for_token()` (reads) and `email_unsubscribe()`
> (sets an opt-out flag). The token is 48 bytes of randomness stored on the
> person's preference row; a wrong token returns nothing. The lint test lists
> all three.

### 1.2 What exists today

- `src/app/delinquency` (board): aging buckets per unit and a "Send a reminder
  letter" button that opens one `mailto:` draft (`reminder-letter-button.tsx`),
  with a hard-coded body.
- `src/app/dues/needs-you.tsx`: one `mailto:` per "behind" item.
- Late fees: the rule (`associations.dues_late_fee_amount`, `dues_late_fee_grace_days`)
  and proposals (`lateFeeProposals`, `src/lib/dues/status.ts`) exist; the board
  confirms each fee, which posts a `late_fee` charge. **Nothing here changes
  that.** A late-fee notice is only a letter about a fee the board has already
  posted.
- `src/app/financial-statements/export/pdf/route.tsx` builds a P&L PDF with
  `@react-pdf/renderer` (`renderToBuffer`, ASCII-safe `Content-Disposition`,
  `pdf-document.tsx` with a navy banner, `Helvetica`, a footer with page
  numbers). The statement PDF reuses that look.
- No email is sent by the app. Account emails (sign-in confirmation, password
  reset) are Supabase Auth's, sent through Resend; Resend is already on the
  privacy page.
- `src/app/api/cron/sync-bank-feeds/route.ts` is the only service-role code,
  authorised by `CRON_SECRET`. `vercel.json` has one cron (`0 18 * * *`).
- The foundation owns `src/lib/email/mailto.ts` and `DraftEmail`. This spec adds
  files beside them in `src/lib/email/` and does not change the existing two.

### 1.3 Decisions needed from the lead engineer

| # | Question | Default taken in this spec |
|---|---|---|
| 1 | Service-role shape: one allowlist helper `serviceRpc()` shared by two new routes (default), or each route builds its own client like the bank cron | helper with a closed allowlist, no `.from()` |
| 2 | DS Collective LLC's postal address for the footer (`LEGAL_ADDRESS` in `site-config.ts`, currently unset) | Sending stays "not set up" until it is a real address (`TODO(doug)` placeholder fails closed) |
| 3 | Resend: confirm `notifications@walkuphoa.com` is verified for sending, DKIM and SPF are published, and which plan's rate limit applies (the page I fetched did not state it) | 600 ms between sends (under 2 a second); a 429 backs off by `retry-after` |
| 4 | Webhook event names and the bounce payload field for permanent versus temporary | `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`; `data.bounce.type === "Permanent"`; confirm in Resend's webhook reference at build time |
| 5 | Warm-up: 20 emails a day for the first 7 days after sending is switched on | on, because a compromised new account is the abuse case |
| 6 | Retention of message history | 24 months, purged by the daily cron; add one line to `/policies/data-retention` |

---

## 2. Architecture

```
Board admin (browser) -- prepare --> email_prepare_batch (RPC, session)  --> outbox rows: draft / skipped(reason)
                      -- review  --> /dues/send/[batchId]  (edit note, leave out)
                      -- approve --> email_approve_batch   (RPC, board_admin, caps) --> queued
                      -- send    --> server action after(): loop { email_claim -> render -> Resend -> email_mark_sent|failed }
Daily cron (Vercel, CRON_SECRET) --> serviceRpc: email_run_rules --> queued rows --> same loop (email_claim(null, ...))
Resend --> POST /api/webhooks/resend (Svix signature) --> serviceRpc: email_record_event --> delivered / bounced / complained
Owner (signed out) --> /unsubscribe/[token] --> anon RPC email_preference_for_token / email_unsubscribe
```

Three properties make this safe to build:

1. **Every limit is in SQL.** The application chooses what to ask for; the
   database refuses what is not allowed (section 3.2 lists each).
2. **A message is inputs, not text.** The outbox row holds `kind`, `facts`
   (a snapshot of ledger numbers as text) and an optional `board_note`. The
   renderer (`src/lib/email/templates`) is a pure function of those and of the
   association's name and contact. The board's review page uses the same
   renderer, so what they approve is what is sent. Approval freezes the inputs
   (`tg_email_outbox_guard`).
3. **A message sends at most once.** `email_claim` flips `queued` to `sending`
   and returns a claim token; `email_mark_sent` needs that token; the Resend
   call carries `Idempotency-Key: wk-{outbox id}` (valid 24 hours, 256
   characters at most, per Resend's docs); a stuck `sending` row is retried
   with the same key inside 20 hours and marked "outcome unknown" after that,
   never resent automatically.

### 2.1 Environment variables (add to `.env.local.example`)

```
# Email sent on behalf of an association (DECISIONS #36). Server only.
# Unset = the app works with drafts and mailto only.
RESEND_API_KEY=
# Svix signing secret of the Resend webhook endpoint ("whsec_..."). Needed to record bounces and complaints.
RESEND_WEBHOOK_SECRET=
# Optional. Default notifications@walkuphoa.com. Must be a verified Resend sender.
EMAIL_FROM_ADDRESS=
# Optional kill switch. 1 = behave as if RESEND_API_KEY were unset (nothing sends, drafts still work).
EMAIL_SENDING_DISABLED=
```
`CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` already exist (Production only, #28).

### 2.2 DNS and Resend setup (manual, once; Doug)

1. In Resend, add and verify `walkuphoa.com` (or a subdomain, see decision 3). Resend publishes DKIM (`resend._domainkey`) and uses a `send.` return-path subdomain for SPF and bounce MX; that does not collide with the ImprovMX records on the apex, but check the records Resend shows before adding them.
2. Publish a DMARC record (`_dmarc.walkuphoa.com`, start with `p=none` and an address that reaches Doug).
3. Create an API key with "sending access" for this domain only, put it in Vercel (Production and Preview as needed).
4. Create a webhook endpoint `https://www.walkuphoa.com/api/webhooks/resend` for the events in decision 4; copy the signing secret to `RESEND_WEBHOOK_SECRET`.
5. Send one test message from the dev project to a mailbox you control before any owner is emailed.

### 2.3 Configuration helper

```ts
// src/lib/email/config.ts  (server-only)
export type SendConfig =
  | { ok: true; apiKey: string; from: string /* bare address */ }
  | { ok: false; reason: "no_key" | "disabled" | "no_legal_address" };
export function sendConfig(): SendConfig;
// no_key: RESEND_API_KEY empty. disabled: EMAIL_SENDING_DISABLED === "1".
// no_legal_address: LEGAL_ADDRESS from site-config is a TODO placeholder (isPlaceholder).
export const SEND_INTERVAL_MS = 600;
export const CLAIM_BATCH_SIZE = 10;
export const SENDER_TIME_BUDGET_MS = 240_000;
export const MAX_ATTEMPTS = 3;
export function notConfiguredCopy(reason: Exclude<SendConfig, { ok: true }>["reason"]): string;
// no_key / disabled: "Sending from Walkup isn't set up on this account, so emails are drafts you open in your own email app."
// no_legal_address: "Walkup's mailing address isn't set yet, which every email must carry. Emails stay drafts until it is."
```

---

## 3. Migration `supabase/migrations/0055_email_reminders.sql`

Complete SQL (applied after 0054). New tables: `email_settings`,
`reminder_rules`, `email_preferences`, `email_suppressions`, `email_batches`,
`email_outbox`, `email_log`. `redact_person` is replaced (same body plus one
call) so personal-data removal reaches the email tables. No table has an
insert, update or delete policy; every write is one of the functions below.

```sql
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
  event               text not null check (event in ('queued', 'claimed', 'sent', 'failed', 'skipped', 'delivered', 'delayed', 'bounced', 'complained', 'unsubscribed', 'resubscribed', 'cancelled')),
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

  if old.status <> 'draft' and (
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
      cur := public.email_unit_facts((u ->> 'unit_id')::uuid, current_date);
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
         and (a.expires_on is null or a.expires_on >= current_date));
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
  delete from public.email_suppressions where association_id = p_association_id and email = lower(p_email);
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
       and uo.effective_from <= current_date
       and (uo.effective_to is null or uo.effective_to >= current_date)
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
      select jsonb_build_object('units', coalesce(jsonb_agg(public.email_unit_facts(x, current_date)), '[]'::jsonb))
        into v_facts
        from unnest(r.owned) x
       where x = any (v_units)
          -- net rule: past due AFTER unapplied payments are counted
          and greatest((public.email_unit_facts(x, current_date) ->> 'overdue')::numeric
                       - (public.email_unit_facts(x, current_date) ->> 'credit')::numeric, 0) > 0;
      if jsonb_array_length(v_facts -> 'units') = 0 then continue; end if;
    elsif p_kind = 'late_fee_notice' then
      v_facts := jsonb_build_object(
        'units', jsonb_build_array(public.email_unit_facts(v_units[1], current_date)),
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
    if v_skip is null and v_hour >= public.email_platform_hourly_limit() then v_skip := 'platform_cap'; end if;

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
       -- owed_n and overdue_n are net of unapplied payments (the net rule)
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
-- redact_person (0037) is replaced with the same body plus one call: the
-- person's address is blanked in the outbox and log, their preferences are
-- deleted and their address is dropped from the suppression list.

create or replace function public.email_redact_person(p_person_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.email_outbox set to_email = 'removed@invalid.invalid', to_name = null, facts = '{}'::jsonb, board_note = null
   where person_id = p_person_id;
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
```

### 3.1 Who may call what

| Function | Callable by | Notes |
|---|---|---|
| `email_set_sending`, `email_set_daily_cap`, `email_save_rule`, `email_clear_suppression`, `email_approve_batch` | board_admin (`has_role_in`, MFA-gated) | approving and enabling are admin acts |
| `email_prepare_batch`, `email_edit_draft`, `email_cancel_batch`, `email_set_rule_paused`, `email_mark_sent_by_hand`, `email_optouts` | board (admin or member) | drafting and reviewing are open to the board; sending is not |
| `email_suspend` | platform admin | the kill switch per association |
| `email_claim`, `email_mark_sent`, `email_mark_failed` | the board admin of that batch's association, or the service key | the same code for the "Send" click and for the cron |
| `email_run_rules`, `email_record_event`, `email_purge` | service key only | `revoke ... from public, anon, authenticated; grant ... to service_role` |
| `set_my_email_preferences`, `my_email_preferences` | the signed-in person, for themself | creates their preference row on first use |
| `email_preference_for_token`, `email_unsubscribe` | `anon` and `authenticated` | the only signed-out functions; token is the credential; the two lint tests list them |
| `email_log_event`, `email_unit_facts`, `email_statement_facts`, `email_facts_current`, `email_pref_allows`, `email_daily_remaining`, `email_platform_hourly_limit`, `email_skip_reason`, `email_ensure_preferences`, `email_redact_person` | other definer functions only | revoked from `authenticated` |

`email_is_service()` reads `auth.jwt() ->> 'role'`, which Supabase sets from the
key that signed the request; a signed-in user cannot forge it.

### 3.2 The limits, where they live

| Limit | Enforced by |
|---|---|
| Recipient is a person of this association, address matches `persons.email` now | `tg_email_same_association` on insert; `email_approve_batch` and `email_claim` re-check `lower(persons.email) = to_email` |
| Address is well formed (no spaces, commas, angle brackets or line breaks) | `email_address_ok` as a check on `email_outbox.to_email` |
| Board note has no links or addresses | check on `email_outbox.board_note` (`!~* '(://|www\.|@)'`), 500 characters |
| One email per person per week per kind | `email_skip_reason` (prepare, approve, claim) and the backstop in `tg_email_outbox_guard` (`53400`, hint `weekly_cap`) |
| Daily ceiling per association; 20 a day for the first 7 days | `email_daily_remaining`, checked in approve and in every claim |
| 300 an hour across the platform | `email_platform_hourly_limit`, checked in every claim |
| Sending off until a board admin turns it on, with a reply-to set | `email_set_sending`; claim skips with `sending_off` if it was switched off meanwhile |
| Suspended association | `email_settings.suspended_at` (platform admin); approve and claim refuse |
| No send to a bounced or complaining address; none to an opted-out person | `email_suppressions`, `email_preferences`, in `email_skip_reason` |
| A reminder never states a balance the ledger no longer shows | `email_facts_current` in every claim (`balance_changed`) |
| Content cannot change after approval | `tg_email_outbox_guard` |
| A message sends once | claim token, `unique (idempotency_key)`, state machine in the guard, provider idempotency key |
| Reminders no faster than weekly, at most N per overdue stretch | `reminder_rules` checks (`repeat_every_days >= 7`, `max_reminders <= 6`) and the rule query |
| History is kept 24 months | `email_purge` |

### 3.3 Notes

- **Why facts are built in SQL.** `email_prepare_batch` calls
  `email_unit_facts` / `email_statement_facts`, which read the ledger through
  `unit_position_core` / `unit_statement_core` (0054). The caller supplies
  only which units; a hand-edited request cannot put a different amount in an
  email.
- **Why `draft` can become `sent` by hand.** When sending is off the board
  still reviews drafts and opens each in its own mail app. `email_mark_sent_by_hand`
  records that (provider id `manual:{id}`), so history, "last reminded" and the
  weekly limit are accurate whichever way the mail left.
- **Why one row per person, not per unit.** Two units under one owner is one
  email listing both; the weekly limit then means one email a week.
- **Rules.** `email_run_rules(p_today)` is evaluated once a day per rule
  (`last_run_on`). **The net rule (one rule everywhere, as the owner-portal spec 1.3 says):** every
  amount, selection and minimum below is on `max(owed - credit, 0)` and
  `max(overdue - credit, 0)`, where `credit` is payments not yet applied to a
  charge, so an owner whose payment is merely unapplied is never reminded of
  money the statement shows as paid. `dues_overdue`: the oldest overdue open
  charge is at least `days` old, the net overdue amount is above zero, the unit's
  net balance is at least `min_amount`, fewer than
  `max_reminders` rule emails were queued or sent for that unit since the
  oldest overdue date, and none in the last `repeat_every_days`.
  `dues_upcoming`: nothing overdue and the earliest open charge not yet due is
  at most `days` away. Both skip opted-out, suppressed and week-capped people.
  Rule batches are created `approved` with `approved_by` = the admin who last
  switched the rule on.
- **Webhook events are matched by provider message id.** Resend also reports
  Supabase Auth's account emails on the same account; those ids match no outbox
  row and are ignored.
- **`email_record_event` and `p_permanent`.** A temporary bounce is logged as
  `delayed` and does not suppress the address.
- **`redact_person`.** Replaced with the 0037 body plus `perform
  public.email_redact_person(p.id, p.email)`: addresses in the outbox and log
  are blanked, facts cleared, preferences deleted, the suppression entry for
  that address removed.

---

## 4. Libraries

All server-only unless marked. Money is text end to end; arithmetic goes through
`src/lib/tax/form1120h.ts` `toCents`/`fromCents` (the project's money helpers).
No em dashes in any string.

### 4.1 `src/lib/email/facts.ts` (pure, zod; client-safe)

```ts
import { z } from "zod";

const money = z.string().regex(/^-?\d{1,12}\.\d{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const unitFacts = z.object({
  unit_id: z.guid(), label: z.string().max(60), as_of: isoDate,
  owed: money, overdue: money, credit: money, net: money,
  oldest_overdue_on: isoDate.nullable(),
  lines: z.array(z.object({ due_on: isoDate, label: z.string().max(60), balance: money })).max(12),
});
export const duesFacts = z.object({
  units: z.array(unitFacts).min(1).max(20),
  rule_kind: z.enum(["dues_upcoming", "dues_overdue"]).optional(),
  rule_days: z.number().int().optional(),
});
export const lateFeeFacts = z.object({
  units: z.array(unitFacts).length(1),
  fee_charge_id: z.guid(), fee_amount: money, fee_charged_on: isoDate,
});
export const statementUnitFacts = z.object({
  unit_id: z.guid(), label: z.string().max(60), from: isoDate, to: isoDate,
  opening: money, charges: money, payments: money, adjustments: money, closing: money,
});
export const statementFacts = z.object({ units: z.array(statementUnitFacts).min(1).max(20) });
export const announcementFacts = z.object({ announcement_id: z.guid() });

export type EmailKind = "dues_reminder" | "late_fee_notice" | "statement" | "annual_statement" | "announcement";
export const KIND_LABEL: Record<EmailKind, string> = {
  dues_reminder: "Dues reminder", late_fee_notice: "Late fee notice", statement: "Statement",
  annual_statement: "Annual statement", announcement: "Announcement",
};
export const PREFERENCE_OF: Record<EmailKind, "dues_reminders" | "statements" | "announcements"> = {
  dues_reminder: "dues_reminders", late_fee_notice: "dues_reminders",
  statement: "statements", annual_statement: "statements", announcement: "announcements",
};
export function parseFacts(kind: EmailKind, facts: unknown):
  { ok: true; data: DuesFacts | LateFeeFacts | StatementFacts | AnnouncementFacts } | { ok: false; error: string };
```

### 4.2 `src/lib/email/templates/` (pure)

```ts
// types.ts
export interface RenderContext {
  associationName: string;          // display_name
  replyToName: string;              // board_contact_name or "The board"
  replyToEmail: string;
  recipientFirstName: string;       // first word of to_name, "there" when empty
  hasLogin: boolean;                // from email_claim
  siteUrl: string;                  // SITE_URL
  unsubscribeUrl: string;           // `${SITE_URL}/unsubscribe/${token}`
  legalEntity: string;              // LEGAL_ENTITY
  legalAddress: string;             // LEGAL_ADDRESS
  boardNote: string | null;
  todayIso: string;
}
export interface Rendered { subject: string; text: string; html: string; attachments?: AttachmentSpec[] }
export interface AttachmentSpec { kind: "statement_pdf"; unitId: string; from: string; to: string; filename: string }

// index.ts
export function render(kind: EmailKind, templateKey: string, templateVersion: number, facts: unknown, ctx: RenderContext, extra?: { announcement?: { title: string; body: string; hasAttachment: boolean } }): Rendered;
// dues-reminder.ts, dues-upcoming.ts, late-fee-notice.ts, statement.ts, announcement.ts, layout.ts (footer, html shell)
// lib/email/sanitize.ts
export function cleanHeaderText(s: string, max = 200): string;      // removes CR, LF, NUL and other control characters, collapses spaces, trims, cuts to max
export function displayNameFor(associationName: string): string;    // `Walkup on behalf of ${clean(name)}`, max 78 chars, no quotes or angle brackets
export function fromHeader(associationName: string, address: string): string;   // `"Walkup on behalf of X" <address>`, backslash and quote escaped
export function escapeHtml(s: string): string;                       // & < > " ' escaped
export function safeFilename(s: string): string;                     // [A-Za-z0-9 ._-] only, 80 chars
```
Unknown `templateKey`/`templateVersion` throws `UnknownTemplateError` (the sender marks the message `failed`, not retryable).

HTML layout (all inline styles, one 560 px column, system font stack, no remote images, no tracking pixels, no click tracking, text part always present):
header line `{association name}` in the navy `#1B2A41` on a white page; content; footer block in 12 px grey with the lines in 7.7. Colours match the brand tokens; dark mode is the mail client's job.

### 4.3 `src/lib/email/resend.ts`

```ts
export interface ResendSend {
  from: string; to: string; replyTo: string; subject: string; text: string; html: string;
  headers: Record<string, string>;                        // List-Unsubscribe, List-Unsubscribe-Post
  attachments?: { filename: string; content: string /* base64 */ }[];
  tags: { name: string; value: string }[];                // kind, association (ids; ASCII letters, digits, _ and -)
  idempotencyKey: string;                                 // wk-{outbox id}
}
export type ResendResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; status: number; message: string; retryAfterMs?: number };
export async function sendViaResend(apiKey: string, msg: ResendSend, fetchImpl?: typeof fetch): Promise<ResendResult>;
```
`POST https://api.resend.com/emails`, headers `Authorization: Bearer`, `Content-Type: application/json`, `Idempotency-Key`. Body: `{ from, to: [to], subject, html, text, reply_to: [replyTo], headers, attachments, tags }` (one recipient per call; `to` allows 50 but a statement is private to one person). `AbortSignal.timeout(15_000)`.
Classification: network error / timeout / 5xx / 429 -> `retryable: true` (`retryAfterMs` from `retry-after`); 400, 401, 403, 404, 409 with a validation or key error, 422 -> `retryable: false`. A 409 for a repeated idempotency key with a different body is treated as `retryable: false` and logged (it signals a bug). Messages returned are Resend's `message` text cut to 300 characters, never logged with the body of the email.

Headers on every message:
```
List-Unsubscribe: <{unsubscribeUrl}>, <mailto:{unsubscribe address}?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```
(The mailto form needs an inbox; use `SUPPORT_EMAIL`. If that is unwanted, send the https form only; Gmail and Yahoo accept it.)

### 4.4 `src/lib/email/service-rpc.ts` (the only place the service key is read for email)

```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";

const ALLOWED = [
  "email_run_rules", "email_claim", "email_mark_sent", "email_mark_failed", "email_record_event", "email_purge",
] as const;
export type ServiceRpcName = (typeof ALLOWED)[number];

/** Calls one of six named functions with the service key. There is no way to read or write a table from here. */
export async function serviceRpc<T = unknown>(name: ServiceRpcName, args: Record<string, unknown>):
  Promise<{ data: T | null; error: { code?: string; message: string } | null }>;
```
It throws if `name` is not in `ALLOWED` (a runtime guard; the type already refuses it), creates the client per call with `{ auth: { persistSession: false, autoRefreshToken: false } }`, and is imported only by `src/app/api/cron/send-reminders/route.ts` and `src/app/api/webhooks/resend/route.ts`. A unit test greps `src/` and fails if any other file imports it or mentions `SUPABASE_SERVICE_ROLE_KEY` (the bank cron keeps its own).

### 4.5 `src/lib/email/send-batch.ts` (the worker loop)

```ts
export interface SenderDeps {
  rpc: <T>(name: "email_claim" | "email_mark_sent" | "email_mark_failed", args: Record<string, unknown>) => Promise<{ data: T | null; error: { code?: string; message: string } | null }>;
  loadAnnouncement: (id: string) => Promise<{ title: string; body: string; hasAttachment: boolean } | null>;
  loadStatementPdf: (unit: { unitId: string; from: string; to: string }) => Promise<Uint8Array | null>;
  send: (msg: ResendSend) => Promise<ResendResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}
export interface SenderOutcome { sent: number; failed: number; skipped: number; remaining: boolean; stoppedBecause: "empty" | "time" | "fatal" | null }

export async function runSender(opts: { batchId: string | null; deps: SenderDeps; config: Extract<SendConfig, { ok: true }>; budgetMs?: number; maxMessages?: number }): Promise<SenderOutcome>;
```
Algorithm (exact):
1. Loop until the budget or `maxMessages` is spent: `rows = rpc("email_claim", { p_batch_id, p_limit: CLAIM_BATCH_SIZE })`. Empty -> `stoppedBecause: "empty"`, stop. `skipped` is counted by comparing `queued` rows before and after in the caller (the SQL marks skips itself).
2. For each claimed row, in order: parse facts (`parseFacts`); a parse failure -> `email_mark_failed(retryable false, "The saved details for this email could not be read.")`.
3. Build `RenderContext` (token from the row, `hasLogin` from the row); `render(...)`. For `statement`/`annual_statement`, for each unit in facts call `loadStatementPdf`; a null -> `email_mark_failed(retryable true, "Could not build the statement PDF.")`; PDFs are attached as base64 (`safeFilename("Statement {unit} {period}.pdf")`).
4. `send(...)` with `idempotencyKey = row.idempotency_key`. On `ok` -> `email_mark_sent(outbox id, claim token, provider id, subject)`; if `mark_sent` itself errors, log `console.error("[walkup-email] sent but not recorded", id)` and continue (the webhook and the stuck-row release reconcile; the idempotency key prevents a second send).
5. On `retryable: false` -> `email_mark_failed(..., false)`. On `retryable: true` -> `email_mark_failed(..., true)` and honour `retryAfterMs` by sleeping (capped at 30 s; if longer, stop the loop with `stoppedBecause: "fatal"`; the cron or the Resume button continues).
6. A 401/403 from Resend (key rejected) stops the loop at once (`fatal`), marks nothing failed beyond the current row, and `console.error("[walkup-email] rejected_key")`.
7. `await deps.sleep(SEND_INTERVAL_MS)` between sends.
Never log message bodies, addresses or amounts.

### 4.6 `src/lib/statements/` (statements)

```ts
// period.ts (pure)
export type StatementPeriodKey = "last_month" | "last_quarter" | "year_to_date" | "last_year" | "custom";
export function statementPeriods(todayIso: string): { key: StatementPeriodKey; label: string; from: string; to: string }[];
// last_month: first to last day of the previous calendar month; last_quarter; year_to_date: Jan 1 to today; last_year: Jan 1 to Dec 31 of the previous year.
export function periodLabel(from: string, to: string): string;     // "October 2026" for a full month, "Q3 2026" for a full quarter, "2025" for a full year, else "Oct 1 to Oct 14, 2026" (the word "to", no dash)
export function isAnnual(from: string, to: string): boolean;        // full calendar year

// data.ts (server-only)
export interface StatementData {
  associationName: string; associationAddress: string | null;
  unit: { id: string; label: string };
  ownerNames: string[];                  // current owners; board only sees these (RLS on unit_owners/persons); an owner sees their own via viewer
  from: string; to: string; generatedOn: string;
  lines: StatementLine[];                // from unit_statement (0054)
  summary: UnitSummary;                  // from unit_statement_summary(unit, to)
  paymentNote: string | null;            // "To pay, sign in to Walkup and open How to pay." never an account number
}
export async function loadStatementData(supabase: Supabase, unitId: string, from: string, to: string): Promise<StatementData | null>;

// pdf-document.tsx (React-PDF; mirrors financial-statements/pdf-document.tsx)
export function OwnerStatementPdf(props: { data: StatementData; annual: boolean }): JSX.Element;
```

### 4.7 `src/lib/collections/` (pure)

```ts
export type Stage = "current" | "friendly" | "second" | "serious";
export interface CollectionUnit {
  unitId: string; label: string; ownerNames: string[];
  owedCents: number; overdueCents: number; oldestOverdueOn: string | null; daysOverdue: number;
  aging: { current: number; d1_30: number; d31_60: number; d60plus: number };       // cents
  lastReminderOn: string | null; remindersSent: number; lastResult: "delivered" | "bounced" | "complained" | "sent" | "by_hand" | null;
  hasEmail: boolean; optedOut: boolean; bounced: boolean; cappedUntil: string | null;
  openLateFeeChargeId: string | null; openLateFeeCents: number;
  suggestion: Suggestion;
}
export type Suggestion =
  | { action: "none"; why: string }
  | { action: "remind"; why: string }
  | { action: "late_fee_notice"; why: string }
  | { action: "call"; why: string }               // no email, bounced, or opted out
  | { action: "wait"; why: string };              // reminded this week

export function stageFor(daysOverdue: number): Stage;   // 0 current, 1..29 friendly, 30..59 second, 60+ serious
export function suggest(u: Omit<CollectionUnit, "suggestion">, todayIso: string): Suggestion;
```
`suggest` copy (exact `why`): none `Nothing is overdue.`; wait `Reminded {date}. Walkup sends at most one a week.`; call (no email) `No email on file. Call or write to the owner.`; call (bounced) `The last email bounced. Check the address or call the owner.`; call (opted out) `This owner opted out of email. Call or write to them.`; late_fee_notice `A late fee of {$x} is posted and unpaid. A notice can go with it.`; remind (friendly) `{n} days overdue. A friendly reminder is a good first step.`; remind (second) `{n} days overdue and {k} reminder(s) already sent. Send another.`; remind (serious) `{n} days overdue. Consider a call before another email.` Suggestions are advice about process, never legal advice, and never mention a fee that is not posted.

### 4.8 Money in templates

`formatMoney(text)`: from `-?\d+\.\d{2}` to `$1,234.56` using integer cents and `Intl.NumberFormat` on `cents / 100` for display only; a negative is `$12.50 credit` in prose or `-$12.50` in tables. Never `Number()` the text for sums; `toCents`/`fromCents` for anything summed (the reminder total is `fromCents(sum of toCents(u.owed))`, and `email_facts_current` has already verified each `owed` against the ledger).

---

## 5. The sending pipeline

### 5.1 Manual batch (the board presses Send)

1. **Prepare.** A board member picks units on the Collections page (reminders),
   a period on the Statements page, a posted late fee, or an announcement. The
   action calls `email_prepare_batch` and goes to `/dues/send/{batchId}`.
   People who cannot be emailed are already `skipped` with a reason (`no_email`,
   `opted_out`, `suppressed`, `weekly_cap`); the rest are `draft`.
2. **Review.** The page renders each draft with the real template. The board can
   add a note per message (500 characters, no links), leave a person out, or cancel the batch.
3. **Approve.** A board admin presses `Send these {n} emails from Walkup`.
   `approveBatch` calls `email_approve_batch` (re-checks every cap, queues what
   passes, marks the rest `skipped` with `daily_cap` or `address_changed` or
   `weekly_cap`), then starts the sender with `after()`.
4. **Send.** `runSender({ batchId, deps: boardSessionDeps })` loops the claim and
   send cycle (4.5) under the board admin's own session. The page shows live
   progress (3-second refresh): `Sending 12 of 40` with a bar, then
   `Sent 38. 2 skipped. 0 failed.`
5. **Resume.** If the request dies, the remaining rows stay `queued` or
   `sending`; `Resume sending` (a button, board admin) runs the sender again, and
   the next daily cron run picks the rest up. A `sending` row older than 10
   minutes is released by the next claim; older than 20 hours it is marked
   failed with `Outcome unknown. Check Resend before sending again.`
6. **Without Resend.** If `sendConfig()` is not ok, the review page offers no
   approve button. Each draft shows a `DraftEmail` (foundation kit) with the
   rendered text, `mailto:` / Gmail / Outlook buttons and `Mark as sent`
   (`email_mark_sent_by_hand`). Long statements: `The PDF can't ride along in a
   mail link. Download it and attach it.` with a download button for the PDF.

### 5.2 Standing rules (the cron)

`GET /api/cron/send-reminders` (`export const dynamic = "force-dynamic"; export const maxDuration = 300;`)

1. Same authorisation as the bank cron: 500 if `CRON_SECRET` unset; 401 unless `Authorization: Bearer $CRON_SECRET`.
2. `sendConfig()` not ok -> `200 { skipped: reason }` (nothing queued; rules wait).
3. `serviceRpc("email_run_rules", { p_today: buildingTodayIso() })` -> batches created.
4. `runSender({ batchId: null, deps: serviceDeps, budgetMs: 240_000, maxMessages: 150 })` (the `serviceDeps.rpc` is `serviceRpc`; `loadStatementPdf` is `async () => null`; rule emails have no attachments).
5. `serviceRpc("email_purge", { p_months: 24 })`.
6. Response `{ rules: [...], sent, failed, skipped, remaining, purged }` (counts only).

`vercel.json` adds `{ "path": "/api/cron/send-reminders", "schedule": "0 15 * * *" }` (15:00 UTC is 9 or 10 a.m. in Chicago; the same DST drift as #28, accepted). The cron claims `queued` rows of any approved batch, so it also finishes a manual batch whose sender died.

### 5.3 Resend webhook

`POST /api/webhooks/resend` (public path `/api/webhooks`; added to `PUBLIC_PATHS`):

1. Read the raw body with `await request.text()` (never `request.json()` first).
2. `RESEND_WEBHOOK_SECRET` unset -> 500.
3. Verify Svix: headers `svix-id`, `svix-timestamp`, `svix-signature` all present; timestamp within 5 minutes of now; secret is `whsec_` + base64: `key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")`; `expected = base64(HMAC_SHA256(key, `${id}.${timestamp}.${rawBody}`))`; the header is space-separated `v1,<sig>` entries; accept if any entry equals `expected` under `crypto.timingSafeEqual` (equal-length buffers first). Failure -> 400 `{ error: "Invalid signature" }`, no database call.
4. Parse JSON `{ type, data }`. For `email.delivered | email.bounced | email.complained | email.delivery_delayed | email.failed` call `serviceRpc("email_record_event", { p_provider_message_id: data.email_id, p_event: type, p_detail: short text (bounce message, cut to 200), p_svix_id: id, p_permanent: type !== "email.bounced" || data.bounce?.type === "Permanent" })`.
5. Always `200 { ok: true }` after a valid signature, even when the event was ignored or a duplicate (Resend retries on non-2xx).
Pure helper `verifySvix({ secret, id, timestamp, signature, body, now })` in `src/lib/email/svix.ts` (unit-tested with fixed vectors, including a tampered body, an old timestamp, a missing header, a wrong secret and a multi-signature header).

### 5.4 Unsubscribe

- `GET /unsubscribe/[token]` (server page, public, `export const metadata = { robots: "noindex", referrer: "no-referrer" }`, bare layout: add `/unsubscribe` to `BARE_PATHS` in `src/app/layout.tsx`). It calls `email_preference_for_token`. A wrong token shows `This link isn't valid. It may have been copied wrongly. Open the latest email and use the link at the bottom.` Showing the page never changes anything (mail scanners prefetch links).
- The page shows `{association}` and the masked address (`b***@example.test`) and four switches: `Dues reminders and late fee notices`, `Statements`, `Announcements`, and `Stop all email from {association}`; a `Save` button posts a server action that calls `email_unsubscribe(token, scope, subscribe)` per changed scope. Result copy: `You're unsubscribed from {what}. You won't get those from {association} through Walkup.` / `Saved.` With a note: `You'll still get account emails (sign-in links) and anything the board sends from its own email.`
- `POST /unsubscribe/[token]/one-click` (route handler): for the RFC 8058 header. Calls `email_unsubscribe(token, "all", false)`; returns `200 { ok: true }` (also for an invalid token, so the response does not reveal validity); `GET` on it redirects to the page. No cookies are read or set. `Cache-Control: no-store`.
- Both use the server Supabase client (anon key; no session needed).

### 5.5 Rate and retries summary

| Situation | Behaviour |
|---|---|
| Resend 429 | `email_mark_failed(retryable true)`; row returns to `queued` with `not_before = now + attempts x 10 min`; the loop sleeps `retry-after` up to 30 s |
| Resend 5xx / timeout | same |
| Resend 4xx validation | row `failed`, `last_error` has Resend's message; the board sees it in the log; `Try again` prepares a new draft |
| Third failure | `failed` (attempts cap in the check constraint is 5; `email_mark_failed` stops retrying at 3) |
| Key rejected (401/403) | loop stops; Home gets an "email key rejected" nudge (15.1); `console.error` for the operator |
| Sender dies mid-batch | rows stay `sending`; released after 10 minutes, same idempotency key inside 20 hours |
| Webhook replay | `email_log.svix_id` is unique; second delivery returns `duplicate` |

---

## 6. Server actions

`src/app/dues/email-actions.ts` (`"use server"`). Each begins with `createClient()`, `getViewer()` (owner-portal spec 2.3) and a role check; returns `{ ok: true, ... } | { error: string }`. Error strings are exact.

```ts
export async function prepareReminders(input: { unitIds: string[] }): Promise<{ ok: true; batchId: string; counts: Counts } | { error: string }>;
export async function prepareStatements(input: { unitIds: string[]; from: string; to: string }): Promise<...same>;
export async function prepareLateFeeNotice(input: { feeChargeId: string }): Promise<...same>;
export async function prepareAnnouncementEmail(input: { announcementId: string }): Promise<...same>;
// Counts = { drafts: number; skipped: { reason: string; n: number }[] }, read back from the outbox rows.

export async function saveDraftNote(outboxId: string, note: string): Promise<{ ok: true } | { error: string }>;
export async function leaveOut(outboxId: string): Promise<{ ok: true } | { error: string }>;
export async function cancelBatch(batchId: string): Promise<{ ok: true } | { error: string }>;
export async function approveBatch(batchId: string): Promise<{ ok: true; queued: number; skipped: number } | { error: string; hint?: "sending_off" | "no_reply_to" }>;
export async function resumeBatch(batchId: string): Promise<{ ok: true } | { error: string }>;
export async function markSentByHand(outboxId: string): Promise<{ ok: true } | { error: string }>;

export async function setSendingEnabled(enabled: boolean): Promise<{ ok: true } | { error: string }>;
export async function setDailyCap(cap: number): Promise<{ ok: true } | { error: string }>;
export async function saveReminderRule(input: RuleInput): Promise<{ ok: true } | { error: string; fieldErrors?: Partial<Record<keyof RuleInput, string>> }>;
export async function setRulePaused(ruleId: string, paused: boolean): Promise<{ ok: true } | { error: string }>;
export async function clearSuppression(email: string): Promise<{ ok: true } | { error: string }>;
```
Zod:
```ts
export const ruleInput = z.object({
  kind: z.enum(["dues_upcoming", "dues_overdue"]),
  days: z.number().int().min(1, "Use at least 1 day.").max(90, "Use 90 days or fewer."),
  minAmount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount like 25 or 25.00."),
  repeatEveryDays: z.number().int().min(7, "Reminders go out at most once a week.").max(60),
  maxReminders: z.number().int().min(1).max(6, "Six reminders is the most."),
  enabled: z.boolean(),
});
```
Mapping of database errors: `42501` -> `Only a board admin can do that.`; `22023` hint `sending_off` -> `Turn on sending first.`; hint `no_reply_to` -> `Add the board contact email on Building Info first. Replies go there.`; `53400` hint `weekly_cap` -> `This person already got this kind of email this week.`; other `22023` -> the function's message; anything else -> `Something went wrong. Try again.` (raw message to `console.error`, never to the page).

`approveBatch` additionally: `sendConfig()` not ok -> `{ error: notConfiguredCopy(reason) }` before any database call. After `email_approve_batch` succeeds: `after(() => runSender({ batchId, deps: boardSessionDeps(supabase) }))`, `revalidatePath("/dues/send/" + batchId)`, `revalidatePath("/delinquency")`, `revalidatePath("/dues/email")`.
`prepareReminders` etc. never check `sendConfig()` (drafts work without Resend).
`markSentByHand`: any board member; success revalidates the batch page and `/delinquency`.
Every action that changes a rule or the sending switch calls `revalidatePath("/dues/email")`.

---

## 7. The emails: exact copy

`{$x}` is `formatMoney`; `{date}` is `longDate` ("October 14, 2026"); `{short}` is `shortDate`. No em dashes. Line breaks are single newlines in the text part.

### 7.1 Dues reminder (`dues_reminder`, template `dues_reminder` v1)

Subject: one unit `Dues reminder: {unit} has a balance of {$owedNet}`; several units `Dues reminder: {$total} across {n} units` (`{$owedNet}` = open charges minus payments not yet applied, never below zero; the total adds the net figures).

```
Hi {first},

This is a reminder from {association}. As of {date}, the board's books show a balance of {$owedNet} for {unit}:

  {line label}   due {short}   {$balance}
  {line label}   due {short}   {$balance}
  Total          {$owed}                          (no unapplied payment)
  Total of open charges   {$owed}                (with an unapplied payment, then:)
  Payment not yet applied -{$credit}
  Balance                 {$owedNet}

{$overdueNet} of this was due on or before {oldest_overdue_on, date}.       (only when overdueNet > 0)

A note from the board: {board note}                                       (only when set)

{hasLogin:}  You can see your statement and how to pay when you sign in at {siteUrl}/owner
{!hasLogin:} To pay, use the details the board gave you, or reply to this email and we'll point you to them.
Payment details are never sent by email. Only use the ones the board gave you.

If you've already paid, thank you. Your payment may not be recorded yet.{hasLogin: You can tell the board on the same page.}

Thanks,
{replyToName}
{association}
```
Several units: one block per unit (`for {unit}:` list and a per-unit total) then `Total across your units  {$sum}`.

### 7.2 Upcoming (`dues_reminder`, template `dues_upcoming` v1; produced only by the rule)

Subject `Dues reminder: {$amount} due {short}`.
```
Hi {first},

A friendly heads-up from {association}: {unit} has {$amount} due on {date}.

{board note, if any}

{hasLogin / !hasLogin paragraph as above}

Thanks,
{replyToName}
{association}
```
`{$amount}` is the sum of `lines[].balance` whose `due_on` is the earliest upcoming date (facts carry only open lines).

### 7.3 Late fee notice (`late_fee_notice`, template `late_fee_notice` v1)

Subject `Late fee on {unit}`.
```
Hi {first},

{association} charged a late fee of {$fee_amount} to {unit} on {date}.

Your balance for {unit}, including that fee, is {$owed}.

{board note, if any}

If you think the fee was charged by mistake, reply to this email and tell us why.
{hasLogin/!hasLogin paragraph}

Thanks,
{replyToName}
{association}
```
Not said anywhere: why the fee was allowed, what law applies, or what happens next. The Collections page shows a one-line reminder to check the declaration and bylaws before sending (8.1).

### 7.4 Statement (`statement`, template `statement` v1) and annual (`annual_statement`, `statement` v1 with `annual` true)

Subject `Statement for {unit}, {period label}` / `Annual statement for {unit}, {year}`. One PDF attached per unit (`Statement {unit} {period}.pdf`).
```
Hi {first},

Your statement for {unit} for {period label} is attached as a PDF.

  Balance at the start   {$opening}
  Charged                {$charges}
  Paid                   {$payments}
  Waived or written off  {$adjustments}                     (only when not 0.00)
  Balance at the end     {$closing}

{closing > 0: "Balance at the end" is what is owed. closing < 0: shown as "{$x} credit".}
{annual only:} This is a record of your account with {association}. It is not a tax document.

{board note, if any}

{hasLogin: You can see this and your earlier statements when you sign in at {siteUrl}/owner/statement}

Thanks,
{replyToName}
{association}
```

### 7.5 Announcement (`announcement`, template `announcement` v1)

Subject `{association}: {title}`.
```
Hi {first},

{announcement body, exactly as the board wrote it}

{has attachment:} This notice has a file with it. Sign in at {siteUrl}/announcements to open it.      (without login: "Ask the board for the file.")
{no attachment, hasLogin:} You can read this and earlier notices at {siteUrl}/announcements

{replyToName}
{association}
```
The body is passed through `cleanHeaderText`-free plain handling: HTML part uses `escapeHtml` and `white-space: pre-wrap`; no auto-linking.

### 7.6 Subjects and headers

`subject` goes through `cleanHeaderText(subject, 200)` before the API call (control characters removed). `From`: `"Walkup on behalf of {association}" <notifications@walkuphoa.com>` built by `fromHeader`. `Reply-To`: `associations.board_contact_email` (validated by the SQL check and `email_address_ok`). `Headers`: `List-Unsubscribe`, `List-Unsubscribe-Post`. Tags: `kind`, `association` (the association uuid), `batch` (the batch uuid).

### 7.7 Footer (every email; text and HTML)

```
--
You're getting this because {the board of {association} has you down as an owner of {unit labels}}.
Reply to this email to reach {replyToName} at {association}.

Unsubscribe from {category}: {unsubscribeUrl}
Or change which emails you get: {unsubscribeUrl}

Sent by Walkup on behalf of {association}. Walkup is operated by {legalEntity}, {legalAddress}.
Walkup does not collect or move money. Payment details are never sent by email.
```
`{category}` per kind: `dues reminders` / `statements` / `announcements`.

---

## 8. Pages, with copy and states

Tokens and components as elsewhere (`Card`, `Answer`, pill tabs, `figures`). Board pages guard with `getViewer()`; non-board -> `BoardOnly` (owner-portal 2.4); accountants may read the Collections page but not prepare or send (buttons absent, one muted line `Preparing email is for the board.`).

### 8.1 `/delinquency` becomes "Collections"

Files: `src/app/delinquency/page.tsx` (rewritten), `collections-table.tsx` (client, row selection), `payment-form.tsx` (kept), `reminder-letter-button.tsx` (deleted; its job is the flow below).

H1 `Collections`; sub-line `Who is behind, for how long, and what has been sent.` (route and sidebar label `Who owes money` renamed `Collections`; `EXTRA_TITLES` prefix `/delinquency` label `Collections`.)

1. `Answer`: nobody behind -> good `Nobody is behind` / `Every unit is up to date.`; otherwise attention `{$total} is outstanding across {n} unit(s)` / `{$overdue} of it is past due.` Keep the existing explanation about the 60% test as a muted sentence beneath (it is true and useful): `Unpaid dues are money earned but not received. They also lower the income your tax eligibility depends on; see the Taxes page.`
2. Email status strip (board): `Email from Walkup: {Off | On | Suspended}` with a link `Set up` (to `/dues/email`). Off copy: `Reminders open in your own email app. Turn on sending to send them from Walkup after you approve them.`
3. Actions row (board): `Record a payment` (existing `PaymentForm`), `Prepare reminders for selected (n)`, `Statements` (link). Mobile: stacked full-width buttons.
4. Table `Card title="Overdue by unit"`: columns (desktop) checkbox, Unit and owner (with `no email`, `bounced`, `opted out` chips in `warning` tone), Not yet due, Up to a month, 1 to 2 months, Over 2 months, Total, Last reminder (`Oct 3 by email` / `Oct 3 by hand` / `Never`), Next step (the `suggest()` text with the action as a link). Below `sm`: each unit is a card: label and total on top, stage pill (`Friendly`, `Second notice`, `Serious`), aging as four small labelled figures, last reminder, next step, checkbox. Units with a suggestion `call` or `wait` have their checkbox disabled with a `title` explaining why.
5. Per-unit history: an expander `History` with the outbox rows for that unit (`email_outbox` where `unit_ids @> {unit}`, newest 20): date, kind label, status words (`Sent`, `Delivered`, `Bounced`, `Marked sent by hand`, `Skipped: opted out`), no body text.
6. Late fees: for units with a posted, unpaid `late_fee` charge (`openLateFeeChargeId`), a row button `Prepare a late fee notice`. A muted line above: `A late fee is only ever charged by the board, from the Dues page. A notice just tells the owner about a fee that is already posted. Check your declaration and bylaws before sending.`
7. Empty state (nobody behind): the `Answer` only. Loading: the existing skeleton. Error: `We couldn't load balances. Reload the page.`

Data: `delinquency_aging` (existing view), `unit_owners` + `persons` (board RLS), `email_outbox` (board RLS, `select unit_ids, kind, status, skip_reason, sent_at, created_at`), `email_suppressions`, `email_optouts()`, open late fees from `assessment_charges`/`charge_balances`.

### 8.2 `/dues/send/[batchId]` review

H1 by kind: `Review reminders`, `Review statements`, `Review the late fee notice`, `Review the announcement email`. Sub-line `Check each email before it goes. Nothing is sent until a board admin presses Send.`

- Summary `Answer`: `{n} emails ready` and detail `{k} people left out: {reason counts in words}` where reasons read `no email address (1)`, `opted out (1)`, `emailed this week already (2)`, `address bounced before (1)`. Zero ready: `Nobody to email` / `Everyone in this list was left out. See why below, or write to them yourself.`
- Sending line: `From: Walkup on behalf of {association} <notifications@walkuphoa.com>. Replies go to {name} <{email}>.`
- List of drafts (cards): recipient name and masked-free address, units, the subject, `Preview` expander showing the rendered text exactly (monospace `pre-wrap`), `Add a note` (textarea, 500, hint `Shown in the email. No links or email addresses.`), `Leave out`. Skipped people listed below under `Left out` with the reason; no actions.
- Footer actions (sticky bar on mobile): `Send these {n} emails from Walkup` (board admin; disabled with the reason when `sendConfig()` fails or sending is off: `Turn on sending on the Email page first.`), `Cancel`. Board members who are not admins see `Ask a board admin to approve this batch.` instead of the button.
- Not configured: replaced by 5.1 step 6 (drafts with mailto and `Mark as sent`).
- After approval: progress card (`Sending 12 of 40`, polled), then a result card `Sent 38. 2 skipped. 0 failed.` with `See the log` (to `/dues/email#log`), `Resume sending` when rows remain. Failures list: name, `last_error`.
- Batch already approved/cancelled when opened: read-only with its result.
- Errors: `We couldn't prepare these emails. Try again.`; batch not found: `This batch isn't available.`

### 8.3 `/dues/statements`

Files: `src/app/dues/statements/page.tsx`, `statements-form.tsx`.

H1 `Owner statements`; sub-line `A statement for each unit, as a PDF to download or an email from Walkup.`

- Period picker: pills (`Last month`, `Last quarter`, `This year so far`, `Last year`) and custom dates (GET params `from`, `to`; `statementPeriods`).
- Table (cards on mobile): unit, owner, balance at the start, charged, paid, balance at the end (from `unit_statement_core` through the board's `unit_statement` per unit; at most 40 units), `PDF` link per unit (`/statements/{unitId}/pdf?from&to`), checkbox.
- Buttons: `Send statements to all owners` (selects every unit that has an owner with an email and any activity or a non-zero balance; the button states the count: `Send statements to all owners (8)`), `Send to selected`. Both call `prepareStatements` and go to the review page. When the period is a full calendar year the page offers `Annual statements` (kind `annual_statement`).
- States: no units (`Add units on Building Info first.`), nobody has an email (`No owner has an email address yet. You can still download each statement.`), loading, error.

### 8.4 `/dues/email` (settings, rules, log)

H1 `Email from Walkup`; sub-line `Reminders, statements and notices, sent only after a board admin approves them.`

Anchor sections (single page, mobile stacked):

1. **Status** `Card`. Four states with exact copy:
   - Not set up (`sendConfig()` not ok): `Answer neutral` `Emails are drafts for now` / `{notConfiguredCopy(reason)}`.
   - Off (config ok, `sending_enabled` false): `Answer neutral` `Sending is off` / `Reminders and statements open in your own email app. Turn sending on to send them from Walkup after you approve them.` with `Turn on sending` (board admin). Requires the reply-to: if `board_contact_email` is empty, the button is replaced by `Add the board contact email` -> `/building#contact`.
   - On: `Answer good` `Sending is on` / `Walkup sends as "Walkup on behalf of {association}" and replies go to {email}. {Warm-up line when enabled less than 7 days ago: "For the first week, up to 20 emails a day."} Today: {used} of {limit} sent.` with `Turn off sending` (confirm: `Turn off sending? Waiting emails are cancelled and every rule is switched off.`).
   - Suspended: `Answer bad` `Sending is paused by Walkup` / `{suspended_reason or "Contact support."} Write to {SUPPORT_EMAIL}.`
2. **Daily limit** (board admin, when On): number input 1 to 200 with `Save`, help `Walkup never sends more than this many a day for your building, and no more than one email per person per week of each kind.`
3. **Reminder rules** `Card`: two rows (`Before dues are due`, `After dues are overdue`), each: switch (`On`/`Off`), the sentence `Send a reminder {days} days before a payment is due` / `Send a reminder when a unit is {days} days overdue, then every {repeat} days, up to {max} times`, `Only for balances of {minAmount} or more`, `Pause`/`Resume`, last run date, `Edit`. Turning a rule on shows an inline confirm: `Walkup will email owners on its own under this rule, once a day at about 9 a.m., without asking each time. You can pause it any time. Turn it on?` plus a plain list: `Never more than one email per owner per week. Never to anyone who unsubscribed. Never for a balance the ledger doesn't show.` Disabled with the reason while sending is off. A "Preview who would get one today" button (`Preview`) runs the same eligibility as a read-only count: `Today this would email 2 owners: Unit 2, Unit 5.` (implemented by `prepareReminders` into a draft batch that is shown and then cancelled; no new SQL).
4. **Blocked addresses**: list from `email_suppressions` (`ada@example.test`, `Bounced`/`Reported as spam`, date) with `Clear` (board admin) and the note `Clear only after you've fixed the address.`
5. **Opt-outs**: count and the unit labels from `email_optouts()` (`2 owners have opted out of some email: Unit 2 (reminders), Unit 4 (all)`). No addresses.
6. **Send log** (`id="log"`): filters (kind, status, unit), table of `email_outbox` newest first, 50 per page: date and time, to (name; address on hover/second line), kind, subject, status (`Sent`, `Delivered`, `Bounced`, `Spam report`, `Failed: {last_error}`, `Skipped: {reason words}`, `Marked sent by hand`), source (`Batch by {name}` / `Rule`), Resend id (monospace, truncated, copy). Mobile: cards. Empty: `Nothing has been sent yet.`

Reason words (`SKIP_REASON_WORDS`): `no_email` no email address; `suppressed` address blocked after a bounce; `opted_out` opted out; `weekly_cap` already emailed this week; `daily_cap` daily limit reached; `platform_cap` busy, try again later; `balance_changed` balance changed since you prepared it; `address_changed` address changed; `sending_off` sending was turned off; `left_out` you left them out; `cancelled` cancelled; `unknown_outcome` outcome unknown, check Resend.

### 8.5 Late fee notice flow

From Collections (`Prepare a late fee notice`) -> `prepareLateFeeNotice` -> the review page (8.2). Two exits: send from Walkup (when on) or `Download as a letter` (PDF: association letterhead line, date, owner name and mailing address, the two sentences of 7.3, board contact; no signature block; the footer line `Prepared by Walkup. Walkup does not give legal advice.`) built with `@react-pdf/renderer` at `/statements/late-fee/[chargeId]/pdf` (board). The letter is for mailing by hand.

### 8.6 Owner-facing pieces

- `GET /statements/[unitId]/pdf?from=&to=` (route handler, session): `loadStatementData` (RLS-backed definer functions: an owner gets their unit, the board any unit, anyone else 403 JSON `{ error: "Not authorized." }`); `renderToBuffer(<OwnerStatementPdf>)`; headers `Content-Type: application/pdf`, ASCII `Content-Disposition` as in `financial-statements/export/pdf/route.tsx`, `Cache-Control: private, no-store`. Dates validated (`^\d{4}-\d{2}-\d{2}$`, span at most 10 years). Flip `STATEMENT_PDF_ENABLED` to `true` in `src/lib/owner/flags.ts` when this ships.
- `src/app/owner/profile/email-preferences-slot.tsx` becomes the preferences card: `Card title="Email from your association"`, three switches `Dues reminders and late fee notices`, `Statements`, `Announcements`, and `Stop all email`, calling `set_my_email_preferences`; help `Account emails like sign-in links are separate and always sent.`; `Saved.` status; the address shown is read-only. Calls `my_email_preferences` (creates the row on first view).
- `/unsubscribe/*` (5.4).

### 8.7 Setup guide and Home

- `/dues/email` is reached from Collections, from HOA Dues header (`Email & reminders` link), and from the setup guide (15).
- Home "Worth a minute": see 15.1.

---

## 9. Statement PDF

`OwnerStatementPdf` (React-PDF, `Helvetica`, US Letter, same navy banner and footer as `financial-statements/pdf-document.tsx`):

1. Banner: kicker `STATEMENT` (or `ANNUAL STATEMENT`), title `{unit label}`, subtitle `{period label}`; right side `{association name}`.
2. Header block (two columns): `Prepared for {owner names}` / `Mailing address {persons.mailing_address of the first owner when the viewer is the board; for an owner their own}`; `Date prepared {longDate}`; `Statement period {from} to {to}`.
3. Summary strip: four boxes `Balance at the start`, `Charged`, `Paid`, `Balance at the end` (`Waived or written off` box only when not zero).
4. Table: Date, What, Charged, Paid, Balance with zebra rows, an opening line when `from` is set, rows paginated with a repeated header (`fixed` header row), money right-aligned, negative balance shown as `$x credit`.
5. A box `How to pay`: `To pay, sign in to Walkup and open How to pay.` plus `{siteUrl}/owner/pay`. No account numbers.
6. Footer on every page: `{association name} · Statement for {unit} · Page {n} of {N}` and `Prepared by Walkup, operated by {legalEntity}. Walkup does not hold or move money.` Annual statements add under the table: `This is a record of your account. It is not a tax document.`
Text is Latin-1 safe via the same ASCII fallback used in the P&L PDF (names with accents render; the filename is ASCII-folded).

---

## 10. Security review notes

| Threat | Control |
|---|---|
| **Header injection** (a name, subject or note containing CR/LF to add `Bcc:` or a body) | Nothing user-supplied reaches a header except through `cleanHeaderText` (control characters stripped) and `fromHeader` (quotes and backslashes escaped, angle brackets removed). `to` is a single address that passed `email_address_ok` (no whitespace, commas, angle brackets, line breaks) and equals the person's stored address. The JSON API takes `to` as an array of one string, so a comma cannot become a second recipient. Subject is cut to 200. Tags are limited to `[A-Za-z0-9_-]`. A unit test feeds CR/LF/`%0d%0a`/` ` through every field. |
| **Open relay** (using Walkup to email anyone) | No free-form recipient exists. Recipients are `persons` rows of the association; the outbox check ties `to_email` to the person; `email_prepare_batch` takes unit ids, not addresses; the claim re-checks the address; there is no "send a test to this address" feature. |
| **Compromised board admin** (phishing owners, spam, fraud) | Only admins approve (MFA is mandatory for everyone, #26). Content is template plus facts; the note has no links or addresses; no account numbers or payment handles in any email, so changing the Zelle handle does not make reminders carry it. Caps: 20 a day for the first week, daily limit at most 200, one per person per week per kind, 300 an hour platform-wide. Every approval is in `audit_log` (`email_batches`, `email_settings`, `reminder_rules`) and in the log; a platform admin can suspend. Residual risk (an admin who writes a misleading 500-character note to everyone once a week) is accepted; announcements by email are the same size of risk. Recommended and not built: email all board admins when email sending is turned on, a rule is enabled, or payment instructions change (16). |
| **Compromised board member (not admin)** | Can prepare drafts and mark sent by hand; cannot approve, enable, or create rules. |
| **Webhook forgery / replay** | Svix signature over the raw body, 5-minute window, constant-time compare, unique `svix_id`. Forged events cannot suppress an address without the secret; `email_record_event` is service-key only, so the route is the only way in. |
| **Cron abuse** | `CRON_SECRET` bearer, 500 if unset (as #28). Hitting the route twice the same day sends nothing new: rules run once per day (`last_run_on`), claims are one-shot. |
| **Service key exposure** | Used only in `service-rpc.ts`, imported by two routes; closed allowlist of six functions; no table access; the unit test fails on any other import or mention of `SUPABASE_SERVICE_ROLE_KEY` outside the bank cron. |
| **Unsubscribe token leakage / guessing** | 48 bytes of randomness; wrong token returns nothing; the page sets `referrer: no-referrer`, `noindex`; GET never changes state; the only power of a token is to change that person's email preferences. Tokens are never logged by the app; Vercel's request path logs include them (accepted: the token only toggles preferences). |
| **Unsubscribe as a denial of service** (someone unsubscribes others) | Needs the 48-byte token. |
| **Privacy: PII in logs** | The app logs ids and counts only. `email_outbox.facts` holds balances; `email_log.to_email` holds addresses; both are board-only by RLS, purged at 24 months and cleared by `redact_person`. Provider tags carry ids, not names. |
| **Double send** | Claim token, state machine, unique idempotency key, provider idempotency header; a crash window of up to 20 hours is covered; beyond it the row is marked "outcome unknown" rather than resent. |
| **Wrong amount sent** | Facts read from the ledger in SQL; `email_facts_current` re-verifies each balance at claim time; mismatch -> skipped `balance_changed`. |
| **Bounce loops / reputation** | Hard bounces and complaints suppress the address at once; complaints also opt the person out of everything. Warm-up and caps limit the blast radius while reputation is new. |
| **SSRF / injection into the PDF or HTML** | HTML escapes every interpolated value; no remote resources; PDF text is plain strings. |
| **Timing / enumeration on `email_preference_for_token`** | Returns zero rows for any invalid token; fixed length check (96) first. |
| **Content-Security-Policy** | No change: the unsubscribe page uses no inline script or third-party host; Resend is called server-side. |

---

## 11. CAN-SPAM checklist

Most of these messages are transactional or relationship messages (a notice about the recipient's own account with an association they belong to), which the Act treats lightly. Walkup follows the commercial-message rules anyway, because the cost is small and the habit is right.

| Requirement | How |
|---|---|
| Not false or misleading headers | `From` names Walkup and the association; the domain is the verified sender; no spoofed reply-to |
| Not deceptive subject lines | Subjects are templates that state the content (`Dues reminder: Unit 2 has a balance of $750.00`) |
| Identify as an advertisement | Not advertising; no promotion appears in any template. A unit test fails the build if a template contains marketing words from a short list (`offer`, `sale`, `discount`, `upgrade`, `pricing`) |
| Tell recipients where you are located | Footer: DS Collective LLC and its postal address (`LEGAL_ADDRESS`) and the association's name |
| Tell recipients how to opt out | Link in the footer and the `List-Unsubscribe` one-click header |
| Honor opt-out promptly (10 business days at most) | Immediately: `email_unsubscribe` writes at once; `email_skip_reason` and `email_claim` consult it before every send |
| Monitor what others do on your behalf | Single sender (Walkup via Resend); the log shows every message |

This is a design checklist, not legal advice; the Terms and Privacy text below
should be read by Doug's lawyer (the existing Terms say they have not been).

---

## 12. Privacy page and Terms text

### 12.1 `src/app/terms/page.tsx`

Header note: the comment above `TermsPage` says "it never moves money, never sends email on its own"; update it to "never moves money, sends email only when a board administrator has approved it". `Last updated` becomes the build date.

Section 3 ("What Walkup does, and what it doesn't"), replace the second bullet:

> `Walkup sends email only after a board administrator has approved it, either by pressing Send on a batch they reviewed or by switching on a standing reminder rule that they can pause at any time. Each email says who it is from, can be unsubscribed from, and is recorded in a log the board can read. Walkup does not send email to anyone who has unsubscribed, and never puts bank account details in an email. Everything else, such as messages to contractors or insurance agents, opens as a draft in your own email app.`

Section 5 ("Automated features and outside services"), after the Anthropic sentence add:

> `Resend delivers the emails a board administrator approves, and the account emails Walkup sends.`

Section 4, add a bullet:

> `Your board is responsible for what it sends through Walkup and for having a reason to contact each person. Owners can unsubscribe from any email in one click.`

Section 3's first bullet (never holds or moves money) stays as is.

### 12.2 `src/app/privacy/page.tsx`

"What we collect", add:

> `A record of each email Walkup sends for your board: who it went to, which kind it was, its subject, when it was sent and whether it was delivered, bounced or reported as spam. We keep it for 24 months. The email address of a person whose address bounces or who reports spam is kept on a block list for that association so Walkup does not write to it again.`
> `Your choices about email: which kinds of email you accept, and whether you unsubscribed.`

"Who we share it with", change the Resend entry from `Resend (account emails)` to `Resend (account emails, and the reminders, statements and notices a board administrator approves)`, and replace the sentence near the address lookup, `Confirmation and password-reset emails are sent through Resend.`, with:

> `Confirmation and password-reset emails, and the reminders, statements and notices a board administrator approves, are sent through Resend. Resend receives the recipient's name and email address and the text of the message, including a statement PDF when one is attached, and tells Walkup whether each message was delivered.`

New short block "Email from Walkup":

> `Walkup sends an email only when a board administrator has approved it. Every message has an unsubscribe link that works without signing in, and we stop sending as soon as you use it. Emails never contain bank account or routing numbers. If you think a message was sent in error, write to {SUPPORT_EMAIL}.`

`tests/unit/privacy-page.test.ts`: keep the Resend assertion (the first sharing paragraph still names Google, Photon and Resend) and add: mentions "unsubscribe", "24 months", and does not contain "never sends email for you" (that sentence in the foundation's AI block, `Walkup never sends email for you; you edit each draft and send it from your own mail app`, is about drafted emails to contractors and agents and stays true; reword to `Drafts to contractors and agents open in your own mail app; Walkup does not send those for you` to avoid a reader taking it as a general promise).

### 12.3 `/policies/data-retention`

Add a row: `Email history (who, which kind, when, delivery result)` -> `24 months, then removed`.

---

## 13. Test plan

### 13.1 DB: `tests/db/email-reminders.test.ts` (PGlite, `asUser`, plus a `asService(db, fn)` helper that sets `request.jwt.claims` to `{"role":"service_role"}` and `set role service_role`; add it to `harness.ts` as an additive export)

Setup (`beforeEach`): fixture seed; Cy sets `board_contact_email`; Cy `email_set_sending(true)`.

Settings and approval
1. `email_set_sending(true)` without a board contact email raises `22023` hint `no_reply_to`; with it, succeeds and stamps `enabled_at`/`enabled_by`.
2. Ada (owner) and a board_member cannot call `email_set_sending`, `email_set_daily_cap`, `email_save_rule`, `email_approve_batch` (`42501`).
3. `email_suspend` works for a platform admin only; a suspended association cannot approve (`22023`) and a queued message is skipped `sending_off` at claim.
4. `email_set_daily_cap` rejects 0 and 201.
5. Switching sending off cancels draft and queued rows (`sending_off`) and disables every rule.

Prepare
6. `email_prepare_batch('dues_reminder', [unit1, unit2])` creates one draft per current owner with `facts.units[].owed` equal to `unit_statement_summary(...).owed`.
7. A unit with nothing overdue yields no row; a person owning two behind units gets one row with two units.
8. Units from another association raise `42501`; more than 100 units raise `22023`.
9. A person without an email, with a suppressed address, with `unsubscribed_all`, with `dues_reminders = false` is created as `skipped` with the right reason; `statements = false` does not block a reminder.
10. Statement batch: `facts.units[].closing` equals the last running balance of `unit_statement` for the period; a period needs both dates.
11. Late fee notice: refuses a waived, written-off or fully paid fee (`fee_not_open`); includes `fee_amount`.
12. Announcement batch: refuses a draft announcement; recipients are the audience's current owners (a targeted announcement reaches only that unit's owners).
13. Ended ownership (`effective_to` in the past) is not emailed.
14. `email_edit_draft`: sets a note; a note containing `http://`, `www.` or `@` violates the check; 501 characters violates the check; editing after approval raises; leaving out moves to `cancelled/left_out`.

Approve, claim, send
15. `email_approve_batch` queues eligible rows, skips `weekly_cap` for a person with a `sent` row of the same kind in the last 7 days, and writes `queued`/`skipped` log events.
16. Approve stops at the daily remainder: with `daily_cap = 1`, the first queues and the second is skipped `daily_cap`; warm-up: with `enabled_at` now, remaining is `min(cap, 20)`; with `enabled_at` 8 days ago it is the cap.
17. A board member (non-admin) cannot approve; a board admin of another association cannot approve.
18. `email_claim` as the board admin returns the row with the reply-to, the unsubscribe token and `has_login`; as a different association's admin raises; as an owner raises.
19. Claim skips and records `address_changed` when the person's email changed after approval.
20. Claim skips `balance_changed` when a charge was added after preparation (and does not send); a payment that clears the balance also skips.
21. Claim skips `opted_out` / `suppressed` that happened after approval.
22. `email_mark_sent` needs the claim token (wrong token -> `22023`); is idempotent for the same provider id; stores `sent_at`.
23. `email_mark_failed(retryable true)` returns the row to `queued` with `not_before`; claim ignores it until then; third failure ends `failed`; `retryable false` ends `failed`.
24. A `sending` row older than 10 minutes is released by the next claim; older than 20 hours becomes `failed` with the "Outcome unknown" text and is never reclaimed.
25. Two concurrent claims never return the same row (`skip locked`): simulate by claiming twice and asserting disjoint ids.
26. The weekly backstop trigger: forcing a second row for the same person and kind to `sending` raises `53400` even if the application skipped the check.
27. The state machine: `sent -> queued`, `failed -> queued`, `skipped -> queued` and editing `facts` of a queued row all raise `42501`.
28. Platform hourly cap: with 300 `sent` rows in the last hour (insert as superuser), claim skips `platform_cap`.
29. `email_mark_sent_by_hand`: any board member; only on a draft; records `manual:` id; counts toward the weekly cap and the daily count; an owner cannot.

Rules and cron
30. `email_save_rule` requires sending on; `repeat_every_days` below 7 violates the check; `max_reminders` above 6 violates.
31. `email_run_rules` as a user raises (permission denied); as service creates an `approved` rule batch with `approved_by` = the enabling admin and `queued` rows; a second run the same day returns nothing.
32. `dues_overdue` with `days = 7`: a unit 5 days overdue is not included, 8 days is; below `min_amount` is not included; after `max_reminders` queued/sent it stops; within `repeat_every_days` it waits.
33. `dues_upcoming` includes a unit whose next charge is within `days` and not overdue; excludes overdue units.
34. A paused rule and a rule in an association with sending off are skipped.
35. Rule rows respect opt-out, suppression and the weekly cap; the batch is not created when nobody qualifies.

Events and preferences
36. `email_record_event` as a user raises; as service: `delivered` moves `sent` to `delivered`; permanent `bounced` moves to `bounced` and inserts a suppression; transient bounce logs `delayed` only; `complained` suppresses and sets `unsubscribed_all`; an unknown provider id returns `ignored`; a repeated `svix_id` returns `duplicate` and adds no second log row.
37. `email_clear_suppression`: admin only.
38. Owners read only their own `email_preferences` row (token included, their own); another owner's and the board's table reads return nothing; `email_optouts` gives the board person ids and flags only (no token column).
39. `set_my_email_preferences` and `my_email_preferences` work for the caller; a person with no person row gets nothing.
40. `email_unsubscribe`: anon with a valid token sets the flag and writes an `unsubscribed` log row; wrong token returns false; wrong scope raises; `p_subscribe = true` re-enables; a 95-character token is rejected; `email_preference_for_token` returns the masked address and nothing else.
41. Anon cannot read any table (`email_*`, `reminder_rules`) and cannot execute any function except the two unsubscribe ones.

Isolation, lint, redaction
42. Zara (Hoyne) reads zero rows from every new table; Cy cannot prepare for a Hoyne unit; direct inserts into any new table by any role are refused (RLS).
43. Same-association triggers: superuser insert of an outbox row whose person or unit is from another association raises `42501`.
44. `redact_person` after the change: the person's outbox addresses become `removed@invalid.invalid`, facts cleared, log addresses null, preferences deleted, the suppression for the address removed, and the original function's checks still hold (cannot redact an owner of a live unit).
45. `email_purge(24)` deletes log and outbox rows older than 24 months and leaves recent; refuses under 12; service only.
46. Lint: `migrations.test.ts` exception lists updated (below) and the other tests pass: floats, numeric scales, `association_id` everywhere, RLS on every table, search paths pinned, no cascades, anon exception list equals `["email_preference_for_token(text)", "email_unsubscribe(text,text,boolean)", "join_state_waitlist(text,text,text)"]`.
47. Service-only functions are not executable by `authenticated` or `anon`: `email_run_rules`, `email_record_event`, `email_purge`; internal helpers not executable by `authenticated`.
48. Migration path: 0055 on top of seeded data leaves existing rows; `redact_person` still passes the 0037 tests (`access-reviews-redaction.test.ts`).

### 13.2 Unit tests (`tests/unit/`)

- `email-sanitize.test.ts`: `cleanHeaderText`, `displayNameFor`, `fromHeader` with CR/LF/NUL/` `/quotes/angle brackets/backslashes/very long names/accents; `escapeHtml`; `safeFilename`.
- `email-templates.test.ts`: every template renders exact text for fixed facts (golden strings from section 7), with and without note, with and without login, one vs several units, annual flag, announcement with attachment; HTML escapes `<script>` in a name and in an announcement body; every output has the footer lines, the unsubscribe URL, the legal entity and address; none contains `$` amounts absent from the facts; no em dash; no marketing words; no account/routing/Zelle strings even when the association has them (the renderer never receives them, and the test passes a context with them in unrelated fields).
- `email-facts.test.ts`: zod accepts a SQL-shaped row, rejects bad money text (`"12"`, `"12.5"`, `"1e3"`).
- `email-resend.test.ts`: request shape (headers incl. `Idempotency-Key`, body fields, one recipient, reply_to array), success, 429 with `retry-after`, 5xx, 422, network error, timeout; the response message cut to 300 chars; no email body in thrown errors.
- `email-send-batch.test.ts`: fake deps; sends in order with the interval; mark_sent after send; `mark_sent` failure does not resend; retryable vs not; 401 stops the loop; budget and `maxMessages` stop; statements attach one PDF per unit; a null PDF fails retryably; a facts parse error fails non-retryably; no address or amount appears in `console` output (spy).
- `email-svix.test.ts`: valid, tampered body, old timestamp, future timestamp, missing header, wrong secret, two signatures where the second is valid.
- `email-service-rpc.test.ts`: allowlist enforced; the file-scan test described in 4.4.
- `email-config.test.ts`: `sendConfig` for each reason; placeholder legal address fails closed; `notConfiguredCopy`.
- `statement-period.test.ts`: `statementPeriods` for a mid-month, January and December date; `periodLabel` for a full month, full quarter, full year, odd range; `isAnnual`.
- `collections-suggest.test.ts`: `stageFor` boundaries (0, 1, 29, 30, 59, 60); each `suggest` branch and copy; a late fee is only suggested when `openLateFeeChargeId` is set; "wait" inside the 7-day window.
- `statement-pdf.test.ts`: renders to a non-empty buffer starting `%PDF` for zero lines, one line, 120 lines (pagination), a negative closing balance and an annual statement; ASCII filename helper.
- `money-copy.test.ts`: asserts the Terms page no longer contains "never sends email on your behalf", the Privacy page mentions "unsubscribe" and "24 months", `tour-steps` and the new pages contain no em dash.
- `email-actions.test.ts`: `ruleInput` messages; error mapping table; `approveBatch` refuses before any database call when not configured (spy on the client); `saveDraftNote` rejects links.

### 13.3 Manual checks before "General Kenobi"

1. On the dev project with a Resend test key: send a reminder batch to two mailboxes you own; check headers (`List-Unsubscribe`, `List-Unsubscribe-Post`, `From`, `Reply-To`), the footer, the PDF attachment, and that Gmail shows the one-click unsubscribe.
2. Click the unsubscribe link in the real email; confirm the person drops out of the next batch with `opted out`.
3. Send to an address that bounces (Resend's test address) and confirm the webhook marks it and suppresses it.
4. Kill the dev server mid-batch; reopen; `Resume sending`; confirm no duplicate arrives.
5. Unset `RESEND_API_KEY`: every page still works; drafts open in mail apps; `Mark as sent` records.
6. A phone: Collections cards, the review page, the unsubscribe page.
7. Mail-tester or a similar spam check on one rendered email (SPF, DKIM, DMARC pass).

### 13.4 Lint-test edits (`tests/db/migrations.test.ts`, owned by Integration)

- "never let the anon role execute a SECURITY DEFINER function": expected list becomes `["email_preference_for_token(text)", "email_unsubscribe(text,text,boolean)", "join_state_waitlist(text,text,text)"]`, with the comment extended: `0055 (DECISIONS #36): the signed-out unsubscribe page, behind a 48-byte token.`
- No other exception list changes (new tables all carry `association_id`; new numerics are `(14,2)`).

---

## 14. Build order

1. Migration 0055 and `tests/db/email-reminders.test.ts` (13.1) green, with the lint-test edit (13.4) and the harness `asService` helper.
2. Pure code: `facts.ts`, `sanitize.ts`, templates, `svix.ts`, `config.ts`, `statements/period.ts`, `collections/*`, with their unit tests. `site-config.ts`: add `LEGAL_ADDRESS` (`TODO(doug)` placeholder).
3. `resend.ts`, `send-batch.ts`, `service-rpc.ts` with unit tests (fake fetch, fake deps).
4. Statement data and PDF; the statement PDF route; flip `STATEMENT_PDF_ENABLED` (owner-portal spec).
5. Server actions (`email-actions.ts`) with unit tests.
6. Pages: `/dues/email`, `/dues/send/[batchId]`, `/dues/statements`, Collections rewrite, unsubscribe pages and route, owner preferences card.
7. Routes: cron and webhook; `vercel.json`; `.env.local.example`; `PUBLIC_PATHS` (`/unsubscribe`, `/api/webhooks`) and `BARE_PATHS` (`/unsubscribe`).
8. Integration (15), Terms and Privacy text (12), DECISIONS #36.
9. Full run: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, the manual checks (13.3), then Resend DNS (2.2) before production. Production waits for "General Kenobi".

---

## 15. Integration tasks

| File | Change |
|---|---|
| `docs/DECISIONS.md` | Append #36 (1.1). Add to #22 a line `(No automatic sending is relaxed by #36.)` and to #28 `(Two further narrow entry points: #36.)` and to #34 `(Two further anon functions: #36.)` |
| `src/lib/supabase/proxy.ts` | `PUBLIC_PATHS` add `"/unsubscribe"` and `"/api/webhooks"`. (`"/api/cron"` is already there.) |
| `src/app/layout.tsx` | `BARE_PATHS` add `"/unsubscribe"`. |
| `vercel.json` | Add the second cron (5.2). |
| `.env.local.example` | Add the four variables (2.1). |
| `src/lib/site-config.ts` | `export const LEGAL_ADDRESS = "TODO(doug): DS Collective LLC postal address";` with the same placeholder behaviour as `LEGAL_ENTITY`. |
| `src/components/sidebar/config.tsx` | `EXTRA_TITLES`: `{ prefix: "/delinquency", label: "Collections" }`, `{ prefix: "/dues/send", label: "Review emails" }`, `{ prefix: "/dues/statements", label: "Owner statements" }`, `{ prefix: "/dues/email", label: "Email from Walkup" }` (placed before the generic `/dues` match because `pageTitleFor` finds nav items first: `/dues` is a nav item, so add these prefixes to the nav item check or special-case them above it). The HOA Dues nav label stays. |
| `src/app/dues/page.tsx` (board view header) | Add three links under the heading: `Collections`, `Owner statements`, `Email & reminders`. |
| `src/lib/home/urgent-items.ts` + `src/app/page.tsx` | New keys (board admins only): `email_key_rejected` (severity 1, bad): title `Walkup couldn't send your last email`, why `The email service rejected Walkup's key. Reminders are paused until it's fixed.`, action `Check` -> `/dues/email`; set when the newest `email_outbox` failure has `last_error` starting `rejected_key`. `email_failed` (severity 2, warning): `{n} email(s) failed to send in the last 7 days`, why `Check the address or try again.`, action `See the log` -> `/dues/email#log`. `email_bounced` (severity 2): `{n} owner(s) didn't get an email (bounced)`, why `Their address may be wrong. Fix it so reminders reach them.`, action `See who` -> `/dues/email`. Update the `delinquent` item action label to `Open Collections` (`/delinquency`). Update `tests/unit/urgent-items*.test.ts`. |
| `src/lib/home/setup-guide.ts` | Section `money`, after `dues_payment`: `{ key: "email_sending", name: "Turn on email from Walkup (optional)", detail: enabled ? "Sending is on." : "So reminders and statements can go out after you approve them.", href: "/dues/email", done: sendingEnabled, informational: true, instructions: ["Add the board contact email on Building Info first; replies go there.", "On Email & reminders, turn sending on. Nothing is sent until a board admin approves it."] }`; add `emailSendingEnabled: boolean` to `SetupInputs` (read `email_settings`, board only). Update `tests/unit/setup-guide.test.ts`. |
| `src/lib/tour/steps.ts` | `duesBoard.body`: `Who owes what, reminders you review and send, and statements for every owner.` (no em dash). |
| `src/app/terms/page.tsx`, `src/app/privacy/page.tsx`, `src/app/policies/data-retention/page.tsx` | Section 12. |
| `src/app/delinquency/*` | Rewritten by Money (8.1); delete `reminder-letter-button.tsx`; `src/app/dues/needs-you.tsx` keeps its mailto buttons (they remain the not-configured path) but its `behind` item gains a second action `Prepare reminder` -> `/delinquency?select={unitId}`. |
| `tests/db/migrations.test.ts`, `tests/db/harness.ts` | 13.4 and `asService`. |
| `README` / `docs/SECURITY_POLICY.md` | Add a paragraph `Outbound email` listing the controls in section 10 and the three service-role/anon entry points; update the vulnerability-management policy's list of secrets with `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` (rotate on suspicion; the key is scoped to sending). |

---

## 16. Deliberately left out

- **Sending money, collecting payments, ACH, card links.** #22/#24 stand. Emails link to a page that explains how to pay at the bank.
- **Model-written reminders.** The brief says model text needs board review; we avoided the problem. Templates plus a 500-character note cover the need and cannot invent a number.
- **Per-owner free-text emails ("write to Bo from Walkup").** That is an open mailbox with a better logo. Board-to-owner one-offs stay in the board's own email app (`DraftEmail`).
- **Open and click tracking.** No pixels, no wrapped links: reminders do not need them and they erode trust.
- **SMS and push.**
- **Scheduling a batch for later; rules for statements and late fees.** A statement or late-fee email always needs a human press. Monthly auto-statements are the obvious next rule, after a season of using batches.
- **Attachments other than a statement PDF** (no announcement files by email; the owner signs in to open them).
- **Email bounce handling for addresses outside Walkup's own log** (Supabase Auth's account emails).
- **Notifying all board admins when sending is enabled, a rule is switched on, or payment instructions change.** Recommended hardening; deferred only because it is itself an email feature that wants its own template and cap. Record it in the first follow-up.
- **Dispute workflow, payment plans, collection letters through certified mail, attorney referral.** Not software Walkup should pretend to offer; the late-fee letter PDF is for printing and posting by hand.
- **Importing email history from the board's mailbox.**
- **Multiple reply-to contacts per rule.** One board contact per association.
- **Resend webhook for `email.opened` / `email.clicked`.** Not subscribed.
