-- ============================================================================
-- Walkup — migration 0031: manual overrides for bank feed transaction tags
--
-- The bank feed shows Plaid's own category per transaction (raw_category,
-- 0016), but that's whatever Plaid guessed — sometimes wrong, sometimes just
-- not how the board actually thinks about it. And nothing on a transaction
-- says which unit's dues payment it is, which is the single most common
-- thing a board member actually wants to know when scanning the feed.
--
-- Both are pure labels on the read-only feed itself — neither writes to the
-- ledger, neither is inferred or auto-applied, and neither changes what
-- "read-only, not part of the books" (0016/0024) means. The existing
-- bank_transactions_update policy (board_admin) already covers writing
-- these; no new policy or RPC needed.
-- ============================================================================

alter table bank_transactions
  add column category_override text,
  add column matched_unit_id uuid references units(id) on delete set null;

comment on column bank_transactions.category_override is
  'Board-set label overriding Plaid''s own raw_category for display. Never read by anything else — purely a bank-feed display preference.';
comment on column bank_transactions.matched_unit_id is
  'Board-tagged "this transaction is this unit''s dues payment" — informational only, does not touch assessment_charges/payments or the ledger.';
