-- ============================================================================
-- Walkup — migration 0058: let the Plaid webhook flag a connection for attention
--
-- WHY. Plaid tells us, by webhook, when a bank connection needs a person
-- (login required, pending disconnect, permission revoked). The webhook has no
-- signed-in user, so the usual board-admin RPCs cannot run for it. The route
-- (src/app/api/plaid/webhook/route.ts) verifies Plaid's signature first, then
-- calls this one function with the service role. DECISIONS #28 allowed exactly
-- one service-role path (the cron); this is a second, equally narrow one
-- (proposed DECISIONS entry in docs/specs/progress/PL3-plaid-webhook-and-sync.md).
--
-- WHAT. flag_bank_item_for_attention(p_item_id): sets status 'active' ->
-- 'error' on the connection with that Plaid item id, and nothing else. It
-- reads no token, writes no ledger row, never touches a disconnected row, and
-- is idempotent (a repeat finds no 'active' row and changes nothing). Returns
-- how many rows changed (0 for an unknown item or a repeat) so the route can
-- log it. Execute is granted to service_role only; anon and authenticated
-- cannot call it, so a signed-in user cannot flip another building's bank.
-- The existing audit trigger on bank_connections records the change.
-- ============================================================================

create or replace function public.flag_bank_item_for_attention(p_item_id text)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rows integer;
begin
  if p_item_id is null or length(p_item_id) = 0 then
    return 0;
  end if;

  update public.bank_connections
     set status = 'error'
   where plaid_item_id = p_item_id
     and status = 'active';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

revoke all on function public.flag_bank_item_for_attention(text) from public, anon, authenticated;
grant execute on function public.flag_bank_item_for_attention(text) to service_role;
