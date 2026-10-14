-- ============================================================================
-- Walkup — migration 0049: the other-states waitlist
--
-- WHY. Walkup supports Illinois associations today. The landing page lets a
-- visitor from another state leave an email and their state, so they can be
-- told when Walkup works there. These are people with no account, so this
-- is the one place a signed-out visitor writes to the database.
--
-- WHAT.
--   * public.state_waitlist (email, state_code, ip_hash, created_at). Global:
--     it belongs to no association. RLS is on with NO policies, so nobody
--     reads or writes it through the API — not visitors, not boards.
--   * public.join_state_waitlist(email, state, ip_hash): the only way in. It
--     validates both values, ignores a repeat of the same email + state
--     (so it can't be used to learn who has signed up), refuses more than
--     5 sign-ups an hour from the same hashed address and more than 200 an
--     hour in total. Callable by anon — the one SECURITY DEFINER function
--     that is, listed as an exception in tests/db/migrations.test.ts and
--     recorded in DECISIONS #34.
--   * ip_hash is a SHA-256 of the visitor's IP and the day, computed by the
--     server action — never the IP itself. Anyone calling the function
--     directly can send any value, so the per-address limit only slows the
--     website's own form; the hourly total is the real ceiling. Per-visitor
--     limits that can't be bypassed belong in a Vercel Firewall rule.
--
-- Reading the list: a platform admin, by SQL, until there's a reason for a
-- screen. Removal on request: delete the row by hand (Privacy Policy).
-- ============================================================================

create table public.state_waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (
                length(email) <= 254
                and email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  state_code  text not null check (state_code ~ '^[A-Z]{2}$' and state_code <> 'IL'),
  ip_hash     text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now()
);

create unique index state_waitlist_email_state on public.state_waitlist (lower(email), state_code);
create index state_waitlist_recent on public.state_waitlist (created_at);

alter table public.state_waitlist enable row level security;
-- No policies on purpose: see the header.

comment on table public.state_waitlist is
  'Visitors from states Walkup does not support yet, asking to be told when it does. Global, no API access; written only through join_state_waitlist().';

create or replace function public.join_state_waitlist(
  p_email   text,
  p_state   text,
  p_ip_hash text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_state text := upper(btrim(coalesce(p_state, '')));
  v_hash  text := nullif(btrim(coalesce(p_ip_hash, '')), '');
begin
  if length(v_email) > 254 or v_email !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then
    raise exception 'enter a valid email address' using errcode = 'check_violation';
  end if;
  if v_state !~ '^[A-Z]{2}$' or v_state = 'IL' then
    raise exception 'choose your state' using errcode = 'check_violation';
  end if;
  if v_hash is not null and v_hash !~ '^[0-9a-f]{64}$' then
    v_hash := null;
  end if;

  if v_hash is not null and (
    select count(*) from public.state_waitlist
     where ip_hash = v_hash and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too many sign-ups from here; try again later' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  if (select count(*) from public.state_waitlist where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'too many sign-ups right now; try again later' using errcode = 'P0001', hint = 'rate_limited';
  end if;

  insert into public.state_waitlist (email, state_code, ip_hash)
  values (v_email, v_state, v_hash)
  on conflict (lower(email), state_code) do nothing;
end $$;

revoke all on function public.join_state_waitlist(text, text, text) from public;
grant execute on function public.join_state_waitlist(text, text, text) to anon, authenticated;
