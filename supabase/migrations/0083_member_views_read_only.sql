-- The member views are for reading. Supabase's default privileges can leave INSERT/UPDATE/DELETE on a new
-- view for the signed-in role, and a simple one-table view is writable (as the view's owner, past row security),
-- so take them away explicitly. (vendors_manager, 0081, is closed the same way in its own migration.)
revoke insert, update, delete, truncate, references, trigger on public.upkeep_tasks_member from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.upkeep_log_member from public, anon, authenticated;
grant select on public.upkeep_tasks_member to authenticated;
grant select on public.upkeep_log_member to authenticated;
