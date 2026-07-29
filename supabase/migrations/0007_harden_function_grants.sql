-- ============================================================================
-- Walkup — migration 0007: revoke API access to internal functions
--
-- Found by Supabase's own database linter after applying 0001-0006 to a real
-- project. PGlite has no PostgREST, so the local test suite could not have
-- caught this: every function in `public` is automatically published as an RPC
-- endpoint at /rest/v1/rpc/<name>, and Postgres grants EXECUTE to PUBLIC by
-- default.
--
-- That exposed public.tg_audit() — the audit trigger, SECURITY DEFINER — to
-- the `anon` role over HTTP. Calling a trigger function directly raises
-- "trigger functions can only be called as triggers", so the practical
-- exposure was small, but a SECURITY DEFINER function reachable by anonymous
-- callers is not something to leave standing.
--
-- Revoking EXECUTE does NOT stop triggers firing. Postgres checks EXECUTE
-- privilege when a trigger is CREATED, not each time it fires.
--
-- The helper functions (has_role_in, is_board, owned_unit_ids, ...) keep their
-- grants deliberately: RLS policies call them, and each one is scoped to
-- auth.uid(), so a signed-in caller can only ever learn facts about
-- themselves. post_journal_entry and the seed functions are likewise
-- intentionally callable and perform their own authorization.
-- ============================================================================

revoke all on function public.tg_audit()                        from public, anon, authenticated;
revoke all on function public.tg_lines_balanced()               from public, anon, authenticated;
revoke all on function public.tg_entry_balanced()               from public, anon, authenticated;
revoke all on function public.tg_entry_immutable()              from public, anon, authenticated;
revoke all on function public.tg_line_immutable()               from public, anon, authenticated;
revoke all on function public.tg_period_open()                  from public, anon, authenticated;
revoke all on function public.tg_fiscal_year_close_is_final()   from public, anon, authenticated;
revoke all on function public.tg_ownership_sums_to_100()        from public, anon, authenticated;
revoke all on function public.tg_allocation_within_payment()    from public, anon, authenticated;
revoke all on function public.check_entry_balanced(uuid)        from public, anon, authenticated;

-- Any function added to `public` later inherits the same default. Rather than
-- rely on remembering, deny by default and grant explicitly.
alter default privileges in schema public revoke execute on functions from public;
