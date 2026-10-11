-- ============================================================================
-- Walkup — migration 0047: drop a redundant index on bank_payee_history
--
-- 0046 created bank_payee_history_lookup_idx on (association_id, payee_key,
-- direction). The table's unique constraint already backs a btree index whose
-- leading columns are exactly those three, and every reader — the tally
-- trigger's UPDATE/DELETE, the rule suggestion's lookup, the page's read —
-- filters on a prefix of it. The extra index served no query and cost a
-- second index write on every categorization.
-- ============================================================================

drop index if exists public.bank_payee_history_lookup_idx;
