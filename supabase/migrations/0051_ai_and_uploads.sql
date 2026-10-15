-- ============================================================================
-- Walkup — migration 0051: AI usage log, direct uploads, ticket photos
--
-- Shared ground for the insurance and repairs overhaul
-- (docs/specs/insurance-repairs-overhaul.md, docs/specs/foundation-spec.md).
--
-- 1. AI_CALLS. Every model call is written down (kind, model, tokens, web
--    searches, ok or not, why not). The daily limit is enforced here, not in
--    the app: claim_ai_call() takes an advisory lock per building and kind,
--    counts, and inserts an 'in_flight' row before the model is called, so
--    ten simultaneous clicks cannot all pass. finish_ai_call() fills the row
--    in afterwards. Only the board may spend the scarce kinds; any member may
--    trigger problem triage, capped per person. Counting is SECURITY DEFINER
--    per DECISIONS #23. Nothing about the prompt or the answer is stored. A
--    log, so not audited.
--
-- 2. PENDING UPLOADS. Files go from the browser straight to Storage with a
--    signed upload URL, then a server action registers the documents row.
--    Between those two steps the object has no row, and the 0020 read policy
--    makes it unreadable, so the server could not re-check its bytes. Narrow
--    policies let the person who uploaded it (owner_id) read it for a day,
--    and delete it only for hub-document paths. Photo paths are never
--    deletable by the uploader: that closed a delete-and-replace swap between
--    the server's byte check and registration.
--
-- 3. TICKET PHOTOS. The board, and owners on their own unit's or a
--    shared-area open problem, may add photos. attach_ticket_photo() checks
--    the stored object itself (owner, size, type), files the photo under
--    Maintenance, pins its visibility to the ticket's audience, and links it.
--    ticket_photos() is the narrow reader owners need, and never shows an
--    owner another person's name. remove_ticket_photo() lets an uploader take
--    their own photo back while the problem is open.
--
-- 4. DOCUMENT LINKS get the same-association guard every other
--    association-scoped FK has.
--
-- can_see_ticket() is written correctly here (members only), independent of
-- the tickets_select policy that 0053 repairs.
-- ============================================================================

-- ============================================================================
-- 1. AI USAGE LOG
-- ============================================================================

create table public.ai_calls (
  id                uuid primary key default gen_random_uuid(),
  association_id    uuid not null references public.associations(id) on delete restrict,
  -- What the call was for. Text plus a check rather than an enum, so adding a
  -- kind is a constraint swap, not `alter type ... add value`.
  kind              text not null check (kind in (
                      'insurance_read', 'insurance_summary', 'insurance_market', 'insurance_draft',
                      'ticket_triage', 'contractor_search', 'contractor_draft', 'bid_read',
                      'coi_read', 'document_classify')),
  -- 'main' is the call a person asked for: claimed before, finished after.
  -- 'followup' is a second call made on its behalf (web research's
  -- structuring step), logged for cost and never counted against a limit.
  step              text not null default 'main' check (step in ('main', 'followup')),
  parent_id         uuid references public.ai_calls(id) on delete restrict,
  -- The model that answered (a refusal fallback can answer with another one).
  -- Null while in flight.
  model             text check (model is null or length(model) between 1 and 100),
  ok                boolean not null default false,
  -- in_flight: claimed, not finished. not_started: claimed, then released
  -- without a model call. Otherwise an AiErrorCode (src/lib/ai/errors.ts).
  error_code        text check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  error             text check (error is null or length(error) <= 500),
  input_tokens      integer not null default 0 check (input_tokens >= 0),
  output_tokens     integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  web_searches      integer not null default 0 check (web_searches >= 0),
  duration_ms       integer check (duration_ms is null or duration_ms >= 0),
  fell_back         boolean not null default false,
  called_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  check ((step = 'main') = (parent_id is null))
);

create index ai_calls_quota_idx
  on public.ai_calls (association_id, kind, created_at desc)
  where step = 'main';

create index ai_calls_person_idx
  on public.ai_calls (called_by, kind, created_at desc)
  where step = 'main';

create index ai_calls_recent_idx
  on public.ai_calls (association_id, created_at desc);

create index ai_calls_parent_idx
  on public.ai_calls (parent_id)
  where parent_id is not null;

comment on table public.ai_calls is
  'One row per model call: what for, which model answered, tokens, web searches, success or the reason it failed. No prompt or answer content. main rows are claimed by claim_ai_call() before the call and finished by finish_ai_call(); followup rows come from record_ai_call(). Board-readable.';

alter table public.ai_calls enable row level security;

-- Board reads. No insert, update or delete policy: rows arrive and change
-- only through the functions below.
create policy ai_calls_select on public.ai_calls
  for select to authenticated
  using (public.is_board(association_id));

-- ----------------------------------------------------------------------------
-- Limits. Mirrors AI_DAILY_LIMITS in src/lib/ai/usage.ts; a unit test parses
-- this function and compares (12.2). Unknown kind: 22023.
-- ----------------------------------------------------------------------------
create or replace function public.ai_daily_limit(p_kind text)
returns integer
language plpgsql immutable set search_path = '' as $$
begin
  return case p_kind
    when 'insurance_read'    then 20
    when 'insurance_summary' then 20
    when 'insurance_market'  then 6
    when 'insurance_draft'   then 40
    when 'ticket_triage'     then 60
    when 'contractor_search' then 12
    when 'contractor_draft'  then 40
    when 'bid_read'          then 25
    when 'coi_read'          then 25
    when 'document_classify' then 200
    else null
  end;
end $$;

comment on function public.ai_daily_limit(text) is
  'Per-association daily limit for one AI kind. Mirrors AI_DAILY_LIMITS in src/lib/ai/usage.ts.';

-- Owners and accountants: at most this many triage calls each per day.
create or replace function public.ai_person_triage_limit()
returns integer
language sql immutable set search_path = '' as $$ select 10 $$;

-- Midnight in Chicago (Walkup is Illinois-only; associations has no time
-- zone column).
create or replace function public.ai_day_start()
returns timestamptz
language sql stable set search_path = '' as $$
  select (date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago')
$$;

-- ----------------------------------------------------------------------------
-- Counting rule, in one place.
--   used     = what counts against the limit: successful calls, failures the
--              request itself caused (refused, too_long, bad_request), and
--              calls still in flight (less than 330 s old). Platform failures
--              (busy, timeout, unreachable, bad_output, ...) do not count.
--   attempts = every main row today, however it was released. Capped at twice
--              the limit, which bounds cost when the service keeps failing.
--              not_started counts here on purpose (REVIEW-1 #2): the caller
--              picks the error code in finish_ai_call, so a code that refunds
--              the claim would let a hostile board account call
--              finish_ai_call(id, false, 'not_started') while the model call
--              runs and claim again without limit. Ceiling: 2x the daily limit
--              (refunding with 'timeout' is the best a caller can do); a hard
--              limit would need the release to be a service-side act.
-- Not SECURITY DEFINER: called from the definer functions below, which run as
-- the table owner. Called directly it runs under the caller's RLS (board
-- only) and reveals nothing.
-- ----------------------------------------------------------------------------
create or replace function public.ai_usage_counts(p_association_id uuid, p_kind text)
returns table (used integer, attempts integer)
language sql stable set search_path = '' as $$
  select
    (count(*) filter (where c.ok
                         or c.error_code in ('refused', 'too_long', 'bad_request')
                         or (c.error_code = 'in_flight'
                             and c.created_at > now() - interval '330 seconds')))::integer,
    (count(*))::integer
    from public.ai_calls c
   where c.association_id = p_association_id
     and c.kind = p_kind
     and c.step = 'main'
     and c.created_at >= public.ai_day_start()
$$;

revoke all on function public.ai_usage_counts(uuid, text) from public, anon;
grant execute on function public.ai_usage_counts(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- claim_ai_call: the only way a main row gets in, and the quota gate.
-- Raises P0001 with hint ai_quota (building limit), ai_attempts (too many
-- failed attempts today) or ai_quota_person (an owner's own triage cap);
-- detail carries "used/limit" for the message. 42501 for non-members and for
-- non-board callers asking for anything but ticket_triage.
-- ----------------------------------------------------------------------------
create or replace function public.claim_ai_call(p_association_id uuid, p_kind text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_limit    integer;
  v_board    boolean;
  v_used     integer;
  v_attempts integer;
  v_mine     integer;
  v_id       uuid;
begin
  if p_association_id is null or not public.is_member(p_association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_limit := public.ai_daily_limit(p_kind);
  if v_limit is null then
    raise exception 'unknown AI kind %', p_kind using errcode = '22023';
  end if;

  v_board := public.is_board(p_association_id);
  if not v_board and p_kind <> 'ticket_triage' then
    raise exception 'only the board can use this' using errcode = '42501';
  end if;

  -- Serialise claims for this building and kind until commit, so the count
  -- below and the insert after it are one step.
  perform pg_advisory_xact_lock(hashtextextended(p_association_id::text || ':' || p_kind, 0));

  select u.used, u.attempts into v_used, v_attempts
    from public.ai_usage_counts(p_association_id, p_kind) u;

  if v_used >= v_limit then
    raise exception 'daily AI limit reached'
      using errcode = 'P0001', hint = 'ai_quota', detail = v_used || '/' || v_limit;
  end if;

  if v_attempts >= 2 * v_limit then
    raise exception 'too many AI attempts today'
      using errcode = 'P0001', hint = 'ai_attempts', detail = v_attempts || '/' || (2 * v_limit);
  end if;

  if not v_board then
    select count(*)::integer into v_mine
      from public.ai_calls c
     where c.association_id = p_association_id
       and c.kind = p_kind
       and c.step = 'main'
       and c.called_by = auth.uid()
       and c.created_at >= public.ai_day_start();
    if v_mine >= public.ai_person_triage_limit() then
      raise exception 'personal AI limit reached'
        using errcode = 'P0001', hint = 'ai_quota_person',
              detail = v_mine || '/' || public.ai_person_triage_limit();
    end if;
  end if;

  insert into public.ai_calls (association_id, kind, step, ok, error_code)
  values (p_association_id, p_kind, 'main', false, 'in_flight')
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.claim_ai_call(uuid, text) from public, anon;
grant execute on function public.claim_ai_call(uuid, text) to authenticated;

comment on function public.claim_ai_call(uuid, text) is
  'Quota gate. Under an advisory lock per association and kind: refuses at the daily limit (hint ai_quota), at twice the limit in attempts (ai_attempts), or at an owner''s own triage cap (ai_quota_person); otherwise inserts an in_flight main row and returns its id. Board only, except ticket_triage.';

-- ----------------------------------------------------------------------------
-- finish_ai_call: fills in a claimed row once. Only the claimer, only while
-- in_flight. Returns false when nothing matched (already finished, not
-- yours, unknown id).
-- ----------------------------------------------------------------------------
create or replace function public.finish_ai_call(
  p_id                uuid,
  p_ok                boolean,
  p_error_code        text    default null,
  p_error             text    default null,
  p_model             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_web_searches      integer default 0,
  p_duration_ms       integer default null,
  p_fell_back         boolean default false
)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(p_error_code), '') = 'in_flight' then
    raise exception 'a finished call can''t be in flight' using errcode = '22023';
  end if;

  update public.ai_calls c
     set ok                = coalesce(p_ok, false),
         -- ok rows may carry a note code (web research that hit max_tokens
         -- but kept its evidence records too_long with ok = true).
         error_code        = case when coalesce(p_ok, false)
                                  then nullif(btrim(p_error_code), '')
                                  else coalesce(nullif(btrim(p_error_code), ''), 'unknown') end,
         error             = left(nullif(btrim(p_error), ''), 500),
         model             = left(nullif(btrim(p_model), ''), 100),
         input_tokens      = greatest(coalesce(p_input_tokens, 0), 0),
         output_tokens     = greatest(coalesce(p_output_tokens, 0), 0),
         cache_read_tokens = greatest(coalesce(p_cache_read_tokens, 0), 0),
         web_searches      = greatest(coalesce(p_web_searches, 0), 0),
         duration_ms       = case when p_duration_ms is null then null else greatest(p_duration_ms, 0) end,
         fell_back         = coalesce(p_fell_back, false),
         finished_at       = now()
   where c.id = p_id
     and c.step = 'main'
     and c.called_by = auth.uid()
     and c.error_code = 'in_flight';

  return found;
end $$;

revoke all on function public.finish_ai_call(
  uuid, boolean, text, text, text, integer, integer, integer, integer, integer, boolean)
  from public, anon;
grant execute on function public.finish_ai_call(
  uuid, boolean, text, text, text, integer, integer, integer, integer, integer, boolean)
  to authenticated;

comment on function public.finish_ai_call(
  uuid, boolean, text, text, text, integer, integer, integer, integer, integer, boolean) is
  'Record the outcome of a claimed call. Only the caller who claimed it, only once.';

-- ----------------------------------------------------------------------------
-- record_ai_call: a followup row under a main row the caller claimed in the
-- last 15 minutes. Association and kind come from the parent, so this can't
-- be used to write rows for anything the caller didn't start. At most three
-- followups per parent.
-- ----------------------------------------------------------------------------
create or replace function public.record_ai_call(
  p_parent_id         uuid,
  p_model             text,
  p_ok                boolean,
  p_error_code        text    default null,
  p_error             text    default null,
  p_input_tokens      integer default 0,
  p_output_tokens     integer default 0,
  p_cache_read_tokens integer default 0,
  p_web_searches      integer default 0,
  p_duration_ms       integer default null,
  p_fell_back         boolean default false
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_parent record;
  v_id     uuid;
begin
  select c.id, c.association_id, c.kind
    into v_parent
    from public.ai_calls c
   where c.id = p_parent_id
     and c.step = 'main'
     and c.called_by = auth.uid()
     and c.created_at > now() - interval '15 minutes';

  if not found or not public.is_member(v_parent.association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if (select count(*) from public.ai_calls f where f.parent_id = p_parent_id) >= 3 then
    raise exception 'too many follow-up calls' using errcode = 'P0001', hint = 'ai_followups';
  end if;

  insert into public.ai_calls (
    association_id, kind, step, parent_id, model, ok, error_code, error,
    input_tokens, output_tokens, cache_read_tokens, web_searches,
    duration_ms, fell_back, finished_at
  ) values (
    v_parent.association_id,
    v_parent.kind,
    'followup',
    v_parent.id,
    left(coalesce(nullif(btrim(p_model), ''), 'unknown'), 100),
    coalesce(p_ok, false),
    nullif(btrim(p_error_code), ''),
    left(nullif(btrim(p_error), ''), 500),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    greatest(coalesce(p_cache_read_tokens, 0), 0),
    greatest(coalesce(p_web_searches, 0), 0),
    case when p_duration_ms is null then null else greatest(p_duration_ms, 0) end,
    coalesce(p_fell_back, false),
    now()
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.record_ai_call(
  uuid, text, boolean, text, text, integer, integer, integer, integer, integer, boolean)
  from public, anon;
grant execute on function public.record_ai_call(
  uuid, text, boolean, text, text, integer, integer, integer, integer, integer, boolean)
  to authenticated;

comment on function public.record_ai_call(
  uuid, text, boolean, text, text, integer, integer, integer, integer, integer, boolean) is
  'Append a followup ai_calls row under a main row the caller claimed in the last 15 minutes (at most 3 per parent). Never counted against a limit.';

-- ----------------------------------------------------------------------------
-- ai_calls_today: how many calls of this kind count against today's limit
-- (the "used" rule above). Members, so an owner's triage sees the true count.
-- ----------------------------------------------------------------------------
create or replace function public.ai_calls_today(p_association_id uuid, p_kind text)
returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_association_id is null or not public.is_member(p_association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select u.used from public.ai_usage_counts(p_association_id, p_kind) u);
end $$;

revoke all on function public.ai_calls_today(uuid, text) from public, anon;
grant execute on function public.ai_calls_today(uuid, text) to authenticated;

comment on function public.ai_calls_today(uuid, text) is
  'Calls of one kind that count against today''s (America/Chicago) limit for one association: successes, request-caused failures, and calls in flight. Members only.';

-- ----------------------------------------------------------------------------
-- ai_quota_status: every kind's used / attempts / limit, for the board's
-- "3 web searches left today" lines.
-- ----------------------------------------------------------------------------
create or replace function public.ai_quota_status(p_association_id uuid)
returns table (kind text, used integer, attempts integer, daily_limit integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_association_id is null or not public.is_board(p_association_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select k.kind, u.used, u.attempts, public.ai_daily_limit(k.kind)
      from unnest(array[
             'insurance_read', 'insurance_summary', 'insurance_market', 'insurance_draft',
             'ticket_triage', 'contractor_search', 'contractor_draft', 'bid_read',
             'coi_read', 'document_classify']) as k(kind)
      cross join lateral public.ai_usage_counts(p_association_id, k.kind) u;
end $$;

revoke all on function public.ai_quota_status(uuid) from public, anon;
grant execute on function public.ai_quota_status(uuid) to authenticated;

comment on function public.ai_quota_status(uuid) is
  'Board only: today''s used, attempts and limit for every AI kind.';

-- ============================================================================
-- 2. TICKET VISIBILITY, PHOTO PERMISSION, STORAGE PATHS
-- ============================================================================

-- Who may SEE a ticket, members only. 0013's tickets_select lets anyone read
-- unit_id-is-null tickets in every association; 0053 fixes that policy.
-- Everything in this migration uses this function instead of the policy.
create or replace function public.can_see_ticket(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.tickets t
     where t.id = p_ticket_id
       and (
         public.can_read_financials(t.association_id)
         or (t.unit_id is null and public.is_member(t.association_id))
         or t.unit_id in (select public.owned_unit_ids(t.association_id))
       )
  )
$$;

revoke all on function public.can_see_ticket(uuid) from public, anon;
grant execute on function public.can_see_ticket(uuid) to authenticated;

comment on function public.can_see_ticket(uuid) is
  'True when the caller may see this ticket: board or accountant of its association, any member for a shared-area ticket, the owner for a unit ticket.';

-- Who may ADD a photo. Narrower than seeing: the board on any ticket; an
-- owner on their own unit's ticket or a shared-area ticket, while it is not
-- resolved or closed. Accountants read; they never write here.
create or replace function public.can_add_ticket_photo(p_ticket_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.tickets t
     where t.id = p_ticket_id
       and (
         public.is_board(t.association_id)
         or (
           t.status not in ('resolved', 'closed')
           and (
             (t.unit_id is null
              and public.has_role_in(t.association_id, array['owner']::public.app_role[]))
             or t.unit_id in (select public.owned_unit_ids(t.association_id))
           )
         )
       )
  )
$$;

revoke all on function public.can_add_ticket_photo(uuid) from public, anon;
grant execute on function public.can_add_ticket_photo(uuid) to authenticated;

comment on function public.can_add_ticket_photo(uuid) is
  'True when the caller may add a photo: board on any ticket; an owner on their own unit''s or a shared-area ticket that is not resolved or closed.';

-- The reason, for friendly copy: 'ok', 'closed' (could add if it were open),
-- or 'no' (can't see it, or may only read it).
create or replace function public.ticket_photo_permission(p_ticket_id uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select case
    when public.can_add_ticket_photo(p_ticket_id) then 'ok'
    when exists (
      select 1 from public.tickets t
       where t.id = p_ticket_id
         and t.status in ('resolved', 'closed')
         and (
           (t.unit_id is null
            and public.has_role_in(t.association_id, array['owner']::public.app_role[]))
           or t.unit_id in (select public.owned_unit_ids(t.association_id))
         )
    ) then 'closed'
    else 'no'
  end
$$;

revoke all on function public.ticket_photo_permission(uuid) from public, anon;
grant execute on function public.ticket_photo_permission(uuid) to authenticated;

-- The ticket's association, only for a caller who can see the ticket; null
-- otherwise. createUploadTarget builds photo paths from this, never from
-- "the first association I can see".
create or replace function public.ticket_association_id(p_ticket_id uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  select t.association_id
    from public.tickets t
   where t.id = p_ticket_id
     and public.can_see_ticket(t.id)
$$;

revoke all on function public.ticket_association_id(uuid) from public, anon;
grant execute on function public.ticket_association_id(uuid) to authenticated;

-- Parse a storage object name in the documents bucket. Mirrors
-- src/lib/documents/upload-paths.ts parseStoragePath(); keep both in step.
--   document:      <association_uuid>/<13-digit ms>-<6 [a-z0-9]>-<safe name>
--   ticket photo:  <association_uuid>/tickets/<ticket_uuid>/<same file part>
-- Anything else returns no row (legacy hub paths included, which is fine:
-- they always have a documents row).
create or replace function public.storage_path_kind(p_name text)
returns table (kind text, association_id uuid, ticket_id uuid)
language plpgsql immutable set search_path = '' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_uuid  constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_file  constant text := '^[0-9]{13}-[a-z0-9]{6}-[A-Za-z0-9_.-]{1,120}$';
begin
  if array_length(v_parts, 1) = 2
     and v_parts[1] ~ v_uuid and v_parts[2] ~ v_file then
    return query select 'document'::text, v_parts[1]::uuid, null::uuid;
  elsif array_length(v_parts, 1) = 4
     and v_parts[1] ~ v_uuid and v_parts[2] = 'tickets'
     and v_parts[3] ~ v_uuid and v_parts[4] ~ v_file then
    return query select 'ticket_photo'::text, v_parts[1]::uuid, v_parts[3]::uuid;
  end if;
  return;
end $$;

comment on function public.storage_path_kind(text) is
  'Classifies a documents-bucket object name as a hub document or a ticket photo path; no row for anything else. Pure.';

-- Unregistered ticket-photo objects the caller uploaded in this building in
-- the last day. The photo upload policy refuses a 31st within any 24 hours.
-- That is a rate limit, NOT a bound on storage (REVIEW-1 #16): the window
-- slides, so one account can leave up to 30 unregistered objects a day, and
-- an uploader cannot delete a photo-path object itself. The bound needs a
-- cleanup job running as service role that deletes unregistered photo-path
-- objects older than a day (not built; see docs/specs/progress/FX1-db-fixes.md).
-- 0 where there is no storage schema (PGlite).
create or replace function public.ticket_photo_pending_count(p_association_id uuid)
returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if to_regclass('storage.objects') is null or auth.uid() is null then
    return 0;
  end if;
  execute
    'select count(*)::integer
       from storage.objects o
      where o.bucket_id = ''documents''
        and o.owner_id = $1
        and o.created_at > now() - interval ''1 day''
        and o.name like $2
        and not exists (select 1 from public.documents d where d.storage_path = o.name)'
    into v_count
    using auth.uid()::text, p_association_id::text || '/tickets/%';
  return coalesce(v_count, 0);
end $$;

revoke all on function public.ticket_photo_pending_count(uuid) from public, anon;
grant execute on function public.ticket_photo_pending_count(uuid) to authenticated;

-- May the caller upload this ticket-photo path? The ticket must exist, be in
-- the association named by the first segment, accept photos from the caller,
-- have no documents row at that path yet, and the caller must have fewer than
-- 30 unregistered photo uploads in the last day.
create or replace function public.ticket_photo_upload_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.storage_path_kind(p_name) k
      join public.tickets t
        on t.id = k.ticket_id
       and t.association_id = k.association_id
     where k.kind = 'ticket_photo'
       and public.can_add_ticket_photo(t.id)
  )
  and not exists (select 1 from public.documents d where d.storage_path = p_name)
  and coalesce((select public.ticket_photo_pending_count(k.association_id)
                    from public.storage_path_kind(p_name) k), 0) < 30
$$;

revoke all on function public.ticket_photo_upload_allowed(text) from public, anon;
grant execute on function public.ticket_photo_upload_allowed(text) to authenticated;

comment on function public.ticket_photo_upload_allowed(text) is
  'Backs the documents_write_ticket_photo storage policy: a well-formed photo path for a ticket the caller may add photos to, not registered yet, under the 30-a-day unregistered cap.';

-- May the caller read (and, for hub paths, delete) this object while it has
-- no documents row? Hub document paths: board of that association. Ticket
-- photo paths: a caller who may add photos to that ticket. The storage
-- policies add owner_id = the caller, so only the uploader ever matches.
create or replace function public.pending_upload_allowed(p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.documents d where d.storage_path = p_name)
     and exists (
       select 1
         from public.storage_path_kind(p_name) k
        where (k.kind = 'document' and public.is_board(k.association_id))
           or (k.kind = 'ticket_photo' and exists (
                 select 1 from public.tickets t
                  where t.id = k.ticket_id
                    and t.association_id = k.association_id
                    and public.can_add_ticket_photo(t.id)))
     )
$$;

revoke all on function public.pending_upload_allowed(text) from public, anon;
grant execute on function public.pending_upload_allowed(text) to authenticated;

comment on function public.pending_upload_allowed(text) is
  'True when the object has no documents row yet and the caller could have uploaded it. Backs documents_read_pending and documents_delete_pending, which also require owner_id = the caller.';

-- ============================================================================
-- 3. STORAGE POLICIES (Supabase only; PGlite has no storage schema)
-- ============================================================================

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'no storage schema — skipping 0051 storage policies (expected under PGlite)';
    return;
  end if;

  drop policy if exists documents_write_ticket_photo on storage.objects;
  drop policy if exists documents_read_pending       on storage.objects;
  drop policy if exists documents_delete_pending     on storage.objects;

  -- Owners may upload to an open problem they may add photos to. The board
  -- already can, through documents_write (0019). Evaluated when the signed
  -- upload URL is created and on any direct upload.
  create policy documents_write_ticket_photo on storage.objects
    for insert to authenticated
    with check (
      bucket_id = 'documents'
      and public.ticket_photo_upload_allowed(name)
    );

  -- Lets registerUpload() download the caller's own just-uploaded object to
  -- re-check its bytes before any row exists. Uploader only, one day.
  create policy documents_read_pending on storage.objects
    for select to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and created_at > now() - interval '1 day'
      and public.pending_upload_allowed(name)
    );

  -- Lets registerUpload() throw away a rejected or duplicate HUB upload.
  -- Never a ticket-photo path: deleting and re-uploading at the same path
  -- between the byte check and registration would swap the bytes. Rejected
  -- photos stay as orphans readable only by their uploader for a day.
  create policy documents_delete_pending on storage.objects
    for delete to authenticated
    using (
      bucket_id = 'documents'
      and owner_id = (select auth.uid())::text
      and exists (select 1 from public.storage_path_kind(name) k where k.kind = 'document')
      and public.pending_upload_allowed(name)
    );
end $$;

-- ============================================================================
-- 4. DOCUMENT LINKS: same-association guard
-- ============================================================================

create or replace function public.tg_document_links_same_association()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.documents d
     where d.id = new.document_id
       and d.association_id = new.association_id
  ) then
    raise exception 'document belongs to a different association' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function public.tg_document_links_same_association() from public, anon;
grant execute on function public.tg_document_links_same_association() to authenticated;

create trigger document_links_same_association
  before insert or update on public.document_links
  for each row execute function public.tg_document_links_same_association();

-- Existing rows are not re-checked by a trigger. Report any that would fail,
-- without failing the migration (the build checks the notice on dev and prod).
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
    from public.document_links l
    join public.documents d on d.id = l.document_id
   where d.association_id <> l.association_id;
  if v_bad > 0 then
    raise warning '0051: % document_links rows point at another association''s document', v_bad;
  end if;
end $$;

-- ============================================================================
-- 5. TICKET PHOTOS
-- ============================================================================

-- Register an uploaded photo. Result columns:
--   document_id, storage_path  the document the photo is now (or already
--                              was), or null when the caller may not see it
--   duplicate                  the bytes were already stored; the caller's
--                              upload is redundant
--   linked                     a photo link to this ticket exists after the call
--   narrower_audience          the identical bytes the caller can already see
--                              are filed for fewer people than this ticket
--                              reaches (a unit photo re-used on a shared-area
--                              problem), so nothing was linked; the UI says
--                              so instead of failing silently
-- Cases: new photo (id, false, path, true, false); retried registration of
-- the same path (id, false, path, true, false); already a photo on this
-- ticket (id or null, true, path or null, true, false); identical bytes
-- stored elsewhere with the same audience and visible to the caller, now
-- linked here too (id, true, its path, true, false); identical bytes visible
-- to the caller but with a narrower audience (null, true, null, false,
-- true); identical bytes stored anywhere else (null, true, null, false,
-- false): nothing is linked and nothing about the other document is
-- returned.
create or replace function public.attach_ticket_photo(
  p_ticket_id    uuid,
  p_storage_path text,
  p_filename     text,
  p_mime_type    text,
  p_byte_size    bigint,
  p_checksum     text,
  p_title        text default null
)
returns table (document_id uuid, duplicate boolean, storage_path text, linked boolean,
               narrower_audience boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_ticket   record;
  v_existing record;
  v_category uuid;
  v_doc      uuid;
  v_stored   boolean;
  v_visible  boolean;
  v_count    integer;
  v_perm     text;
begin
  select t.id, t.association_id, t.unit_id, t.status
    into v_ticket
    from public.tickets t
   where t.id = p_ticket_id;

  -- Same answer for "no such ticket" and "not yours", so this can't be used
  -- to probe for tickets in other buildings.
  if not found then
    raise exception 'you can''t add photos to this problem' using errcode = '42501';
  end if;
  v_perm := public.ticket_photo_permission(p_ticket_id);
  if v_perm = 'no' then
    raise exception 'you can''t add photos to this problem' using errcode = '42501';
  end if;
  if v_perm = 'closed' then
    raise exception 'this problem is closed' using errcode = '42501', hint = 'ticket_closed';
  end if;

  if not exists (
    select 1 from public.storage_path_kind(p_storage_path) k
     where k.kind = 'ticket_photo'
       and k.association_id = v_ticket.association_id
       and k.ticket_id = v_ticket.id
  ) then
    raise exception 'that photo was not uploaded to this problem' using errcode = '22023';
  end if;

  if p_mime_type is null or p_mime_type not in ('image/jpeg', 'image/png', 'image/heic') then
    raise exception 'only JPEG, PNG and HEIC photos can be attached' using errcode = '22023';
  end if;
  if p_byte_size is null or p_byte_size < 1 or p_byte_size > 15728640 then
    raise exception 'photos must be 15 MB or smaller' using errcode = '22023';
  end if;
  if p_checksum is null or p_checksum !~ '^[0-9a-f]{64}$' then
    raise exception 'missing checksum' using errcode = '22023';
  end if;
  if p_filename is null or length(btrim(p_filename)) = 0 or length(p_filename) > 255 then
    raise exception 'missing file name' using errcode = '22023';
  end if;

  -- One registration at a time per ticket: the 20-photo count and the
  -- dedupe below can't race each other.
  perform pg_advisory_xact_lock(hashtextextended('ticket_photos:' || v_ticket.id::text, 0));

  -- A retried registration of this very path (response lost on the way
  -- back). Only the uploader gets it back.
  select d.id, d.uploaded_by into v_existing
    from public.documents d
   where d.association_id = v_ticket.association_id
     and d.storage_path = p_storage_path;
  if found then
    if v_existing.uploaded_by is distinct from auth.uid() then
      raise exception 'that photo was not uploaded to this problem' using errcode = '22023';
    end if;
    insert into public.document_links (association_id, document_id, target_table, target_id, relation)
    values (v_ticket.association_id, v_existing.id, 'tickets', v_ticket.id, 'photo')
    on conflict (document_id, target_table, target_id, relation) do nothing;
    return query select v_existing.id, false, p_storage_path, true, false;
    return;
  end if;

  -- The stored object must be the caller's, and its size and type must be
  -- what is being registered. Never trust the caller's word for it. Skipped
  -- where there is no storage schema (PGlite without the test stub).
  if to_regclass('storage.objects') is not null then
    execute
      'select exists (
         select 1 from storage.objects o
          where o.bucket_id = ''documents''
            and o.name = $1
            and o.owner_id = $2
            and (o.metadata->>''size'')::bigint = $3
            and lower(btrim(split_part(o.metadata->>''mimetype'', '';'', 1))) = $4)'
      into v_stored
      using p_storage_path, auth.uid()::text, p_byte_size, p_mime_type;
    if not coalesce(v_stored, false) then
      raise exception 'that photo hasn''t finished uploading' using errcode = '22023', hint = 'not_uploaded';
    end if;
  end if;

  -- Live photos only; binned ones don't count. SECURITY DEFINER count (#23).
  select count(*) into v_count
    from public.document_links l
    join public.documents d
      on d.id = l.document_id
     and d.deleted_at is null
   where l.association_id = v_ticket.association_id
     and l.target_table = 'tickets'
     and l.target_id = v_ticket.id
     and l.relation = 'photo';
  if v_count >= 20 then
    raise exception 'this problem already has 20 photos' using errcode = 'P0001', hint = 'photo_limit';
  end if;

  -- Identical bytes are one document (0020's documents_checksum_key).
  select d.id, d.storage_path, d.restricted_to_unit_id, d.visibility
    into v_existing
    from public.documents d
   where d.association_id = v_ticket.association_id
     and d.checksum = p_checksum
     and d.deleted_at is null;

  if found then
    -- documents_select (0020), restated because this function bypasses RLS.
    v_visible := public.can_read_financials(v_ticket.association_id)
      or (v_existing.restricted_to_unit_id is not null
          and v_existing.restricted_to_unit_id in (select public.owned_unit_ids(v_ticket.association_id)))
      or (v_existing.restricted_to_unit_id is null
          and v_existing.visibility = 'all_owners'
          and public.is_member(v_ticket.association_id));

    if exists (
      select 1 from public.document_links l
       where l.document_id = v_existing.id
         and l.target_table = 'tickets'
         and l.target_id = v_ticket.id
         and l.relation = 'photo'
    ) then
      return query select case when v_visible then v_existing.id end, true,
                          case when v_visible then v_existing.storage_path end, true, false;
      return;
    end if;

    -- Same audience as this ticket and visible to the caller: linking it here
    -- shows it to nobody new.
    if v_visible
       and v_existing.restricted_to_unit_id is not distinct from v_ticket.unit_id
       and (v_ticket.unit_id is not null or v_existing.visibility = 'all_owners') then
      insert into public.document_links (association_id, document_id, target_table, target_id, relation)
      values (v_ticket.association_id, v_existing.id, 'tickets', v_ticket.id, 'photo')
      on conflict (document_id, target_table, target_id, relation) do nothing;
      return query select v_existing.id, true, v_existing.storage_path, true, false;
      return;
    end if;

    -- Anything else: link nothing. Only a caller who can already see the
    -- stored photo learns why (it is filed for fewer people than this
    -- ticket reaches: a unit photo on a shared-area problem, or a board-only
    -- document on a unit problem); everyone else learns nothing about it.
    return query select null::uuid, true, null::text, false,
      v_visible
      and (
        (v_ticket.unit_id is null
         and not (v_existing.restricted_to_unit_id is null and v_existing.visibility = 'all_owners'))
        or (v_ticket.unit_id is not null
            and v_existing.restricted_to_unit_id is null
            and v_existing.visibility = 'board_only')
      );
    return;
  end if;

  select c.id into v_category
    from public.document_categories c
   where c.association_id = v_ticket.association_id
     and c.slug = 'maintenance';
  if v_category is null then
    raise exception 'the Maintenance document category is missing' using errcode = 'P0001';
  end if;

  begin
    insert into public.documents (
      association_id, storage_path, filename, title, mime_type, byte_size, checksum,
      category_id, tag_source, review_state, visibility, restricted_to_unit_id,
      source, extraction_state, extraction_error
    ) values (
      v_ticket.association_id,
      p_storage_path,
      left(btrim(p_filename), 255),
      nullif(left(btrim(coalesce(p_title, '')), 200), ''),
      p_mime_type,
      p_byte_size,
      p_checksum,
      v_category,
      'manual',
      'ok',
      -- Shared-area problem: every owner may see it. Unit problem: that
      -- unit's owner and the board, exactly like the ticket itself.
      case when v_ticket.unit_id is null then 'all_owners' else 'board_only' end,
      v_ticket.unit_id,
      'upload',
      'skipped',
      'Photos attached to a problem aren''t read automatically.'
    )
    returning id into v_doc;
  exception when unique_violation then
    -- Identical bytes registered on another ticket in the same instant.
    return query select null::uuid, true, null::text, false, false;
    return;
  end;

  insert into public.document_links (association_id, document_id, target_table, target_id, relation)
  values (v_ticket.association_id, v_doc, 'tickets', v_ticket.id, 'photo');

  return query select v_doc, false, p_storage_path, true, false;
end $$;

revoke all on function public.attach_ticket_photo(uuid, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.attach_ticket_photo(uuid, text, text, text, bigint, text, text) to authenticated;

comment on function public.attach_ticket_photo(uuid, text, text, text, bigint, text, text) is
  'Register the caller''s uploaded photo for a ticket they may add photos to. Checks the stored object''s owner, size and type; files it under Maintenance with visibility pinned to the ticket''s audience; links it. Identical bytes: links an existing visible same-audience document, otherwise links nothing and returns no id (narrower_audience = true when the caller can see that document and it reaches fewer people than the ticket). At most 20 live photos per ticket.';

-- Take a photo off a problem. The board at any time; the person who uploaded
-- it while the problem is open. Removes the link; bins the document when
-- nothing else links to it (it stays in the board's Document Hub trash).
create or replace function public.remove_ticket_photo(p_ticket_id uuid, p_document_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
begin
  select t.id as ticket_id, t.association_id, t.status, l.id as link_id, d.uploaded_by
    into v_row
    from public.tickets t
    join public.document_links l
      on l.association_id = t.association_id
     and l.target_table = 'tickets'
     and l.target_id = t.id
     and l.relation = 'photo'
     and l.document_id = p_document_id
    join public.documents d
      on d.id = l.document_id
     and d.deleted_at is null
   where t.id = p_ticket_id;

  if not found
     or not public.can_see_ticket(p_ticket_id)
     or not (
       public.is_board(v_row.association_id)
       or (v_row.uploaded_by = auth.uid() and v_row.status not in ('resolved', 'closed'))
     ) then
    raise exception 'you can''t remove this photo' using errcode = '42501';
  end if;

  delete from public.document_links where id = v_row.link_id;

  if not exists (select 1 from public.document_links l where l.document_id = p_document_id) then
    update public.documents set deleted_at = now() where id = p_document_id;
  end if;
end $$;

revoke all on function public.remove_ticket_photo(uuid, uuid) from public, anon;
grant execute on function public.remove_ticket_photo(uuid, uuid) to authenticated;

comment on function public.remove_ticket_photo(uuid, uuid) is
  'Remove a photo from a ticket: board any time, the uploader while the ticket is open. Bins the document when no other link remains.';

-- The photos on one ticket, filtered to what the caller may see. Owners need
-- this because document_links is readable only by board and accountant.
-- Names follow persons_select (0002): board and accountant see the
-- uploader's name; everyone else sees only "you", "board" or "owner".
create or replace function public.ticket_photos(p_ticket_id uuid)
returns table (
  document_id    uuid,
  link_id        uuid,
  title          text,
  filename       text,
  mime_type      text,
  byte_size      bigint,
  storage_path   text,
  uploaded_at    timestamptz,
  added_by_kind  text,      -- 'you' | 'board' | 'owner'
  added_by_name  text,      -- null unless the caller is board or accountant
  can_remove     boolean
)
language sql stable security definer set search_path = '' as $$
  select d.id,
         l.id,
         d.title,
         d.filename,
         d.mime_type,
         d.byte_size,
         d.storage_path,
         d.uploaded_at,
         case
           when d.uploaded_by = auth.uid() then 'you'
           when exists (
             select 1
               from public.role_grants g
               join public.persons p on p.id = g.person_id
              where p.auth_user_id = d.uploaded_by
                and g.association_id = d.association_id
                and g.role in ('board_admin', 'board_member')
                and g.revoked_at is null
                and (g.expires_on is null or g.expires_on >= current_date)
           ) then 'board'
           else 'owner'
         end,
         case when public.can_read_financials(d.association_id) then
           (select p.full_name
              from public.persons p
             where p.auth_user_id = d.uploaded_by
               and p.association_id = d.association_id
             limit 1)
         end,
         public.is_board(t.association_id)
           or (d.uploaded_by = auth.uid() and t.status not in ('resolved', 'closed'))
    from public.tickets t
    join public.document_links l
      on l.association_id = t.association_id
     and l.target_table = 'tickets'
     and l.target_id = t.id
     and l.relation = 'photo'
    join public.documents d
      on d.id = l.document_id
     and d.association_id = t.association_id
   where t.id = p_ticket_id
     and public.can_see_ticket(t.id)
     and d.deleted_at is null
     -- documents_select (0020), restated because this function bypasses RLS.
     and (
       public.can_read_financials(d.association_id)
       or (d.restricted_to_unit_id is not null
           and d.restricted_to_unit_id in (select public.owned_unit_ids(d.association_id)))
       or (d.restricted_to_unit_id is null
           and d.visibility = 'all_owners'
           and public.is_member(d.association_id))
     )
   order by d.uploaded_at, d.id
$$;

revoke all on function public.ticket_photos(uuid) from public, anon;
grant execute on function public.ticket_photos(uuid) to authenticated;

comment on function public.ticket_photos(uuid) is
  'Photos linked to a ticket that the caller may see, oldest first. Uploader names only for board and accountant; others get added_by_kind only.';

-- ----------------------------------------------------------------------------
-- Helper functions that were created without a revoke (REVIEW-1 #12). PUBLIC
-- (and so anon) can execute any function by default, and 0007's default
-- privileges are schema-scoped, so every function needs its own revoke. They
-- are pure and leak nothing, but they were callable at /rest/v1/rpc without a
-- session. The storage policies call storage_path_kind as authenticated.
-- ----------------------------------------------------------------------------
revoke all on function public.ai_daily_limit(text), public.ai_person_triage_limit(),
  public.ai_day_start(), public.storage_path_kind(text) from public, anon;
grant execute on function public.ai_daily_limit(text), public.ai_person_triage_limit(),
  public.ai_day_start(), public.storage_path_kind(text) to authenticated;
