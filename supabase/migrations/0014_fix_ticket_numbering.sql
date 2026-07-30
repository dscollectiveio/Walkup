-- ============================================================================
-- Walkup — migration 0014: ticket numbering must not depend on who is looking
--
-- tg_ticket_reference computed `max(reference) + 1` as SECURITY INVOKER, so the
-- SELECT inside it was filtered by RLS.
--
-- An owner sees shared-area problems and their own, but not a neighbour's. With
-- tickets 1 (shared), 2 (Ada's) and 3 (Bo's), Ada's view of the table stops at
-- 2 — so reporting a problem assigned her ticket number 3, colliding with Bo's
-- and failing on the unique constraint.
--
-- The failure mode is the interesting part: the more private data a building
-- accumulates, the more often an owner is simply unable to report a problem,
-- with a unique-constraint error that says nothing about why. It would have
-- looked like a random bug in production and been very hard to attribute.
--
-- This is the third instance of the same shape — logic that assumed it could
-- see every row, running under RLS that does not (DECISIONS #17, #21). Anything
-- computing a maximum, a count or a sequence across a table needs to be
-- SECURITY DEFINER, or it silently means something different per caller.
-- ============================================================================

create or replace function public.tg_ticket_reference()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.reference is null then
    select coalesce(max(reference), 0) + 1 into new.reference
      from public.tickets
     where association_id = new.association_id;
  end if;
  return new;
end $$;

revoke all on function public.tg_ticket_reference() from public, anon;

-- Supabase's own default privileges grant EXECUTE on public functions to
-- `authenticated`, so `revoke ... from public` above is not enough — the role
-- holds a direct grant. Revoking it explicitly removes /rest/v1/rpc/
-- tg_ticket_reference from the API surface. Trigger firing does not check
-- EXECUTE, so the trigger is unaffected (DECISIONS #21).
revoke all on function public.tg_ticket_reference() from authenticated;
