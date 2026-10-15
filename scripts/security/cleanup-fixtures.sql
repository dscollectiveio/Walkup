-- scripts/security/cleanup-fixtures.sql
--
-- attack-rls.mjs seeds a few fixture rows through legitimate RPCs/inserts to
-- exercise real code paths, and cleans most of them up through the API when
-- it's done. Three tables have NO delete policy for any role, by design
-- (tickets/ticket_comments: "tickets are never deleted" — 0013/0053;
-- bank_connections: retired via status='disconnected', never hard-deleted —
-- 0016), so their fixture rows can only be removed with direct SQL access
-- to the branch, same as this file. Everything here is scoped to rows this
-- harness itself creates (title/body/institution_name prefixed
-- "SECURITY-TEST", or the join_state_waitlist baseline probe's fixed email),
-- never to real seed data.
--
-- Run this against the `security-test` branch (project ref
-- brwauxmdjgfrdqfbgezg) after a run of attack-rls.mjs, via the Supabase MCP
-- execute_sql tool or the SQL editor. Safe to re-run; every delete is a
-- no-op once the rows are gone.

delete from ticket_comments where body ilike '%SECURITY-TEST%';
delete from tickets where title ilike 'SECURITY-TEST%';

delete from bank_connection_secrets
 where bank_connection_id in (
   select id from bank_connections where institution_name ilike 'SECURITY-TEST%'
 );
delete from bank_connections where institution_name ilike 'SECURITY-TEST%';

delete from state_waitlist where email ilike 'security-test-%';

-- role_grants rows the harness revokes (revoked_at set) rather than deletes
-- — role_grants has no delete policy for any role, by design (0002: "grants
-- are revoked by setting revoked_at, never removed"). They are inert
-- (every RLS check filters on revoked_at is null) but can be purged here
-- for a fully clean branch between runs.
delete from role_grants
 where revoked_at is not null
   and id not in (
     -- keep this empty exclusion list if there's ever a real revoked grant
     -- worth preserving; today there is none in the seed.
     select '00000000-0000-0000-0000-000000000000'::uuid
   );
