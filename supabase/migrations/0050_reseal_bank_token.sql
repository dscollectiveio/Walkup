-- ============================================================================
-- Walkup — migration 0050: seal Plaid access tokens at rest
--
-- WHY. bank_connection_secrets.plaid_access_token held the Plaid token as
-- plain text, and get_bank_access_token() (board admins, 0016) hands it to
-- the caller — so anyone who steals an admin's session, or a copy of the
-- database, gets a live bank token. The app now seals the token with
-- AES-256-GCM using BANK_TOKEN_KEY, which exists only in the server's
-- environment (src/lib/security/secret-box.ts). The token in the database
-- is ciphertext; get_bank_access_token() returns ciphertext; only the
-- server can open it.
--
-- WHAT. One function, reseal_bank_access_token(connection, sealed): the app
-- calls it the first time it uses a token that was stored before sealing was
-- switched on, replacing the plain value with its sealed form. It accepts
-- the swap only when (a) the caller is a board admin of that association
-- (has_role_in, which also requires MFA), (b) the stored value is still
-- plain, and (c) the new value is sealed — so it can never be used to
-- overwrite a good token with junk, or to read anything.
-- No data changes here; existing tokens are sealed lazily on next use, and
-- by the daily sync job, which uses the service role.
-- ============================================================================

create or replace function public.reseal_bank_access_token(
  p_connection_id uuid,
  p_sealed        text
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_assoc uuid;
begin
  select association_id into v_assoc from public.bank_connections where id = p_connection_id;
  if v_assoc is null then
    raise exception 'bank connection not found' using errcode = 'no_data_found';
  end if;
  if not public.has_role_in(v_assoc, array['board_admin']::public.app_role[]) then
    raise exception 'not authorized to change this bank connection' using errcode = '42501';
  end if;
  if p_sealed is null or p_sealed not like 'enc:v1:%' then
    raise exception 'only a sealed value can be stored here' using errcode = 'check_violation';
  end if;

  update public.bank_connection_secrets
     set plaid_access_token = p_sealed
   where bank_connection_id = p_connection_id
     and plaid_access_token not like 'enc:v1:%';
end $$;

revoke all on function public.reseal_bank_access_token(uuid, text) from public, anon;
grant execute on function public.reseal_bank_access_token(uuid, text) to authenticated;
