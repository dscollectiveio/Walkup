-- ============================================================================
-- 0091: keep the bank's own wording of each transaction
-- ============================================================================
-- bank_transactions.description holds Plaid's cleaned name ("ComEd"). The line the bank actually printed
-- ("COMED 8841 PAYMENT 10/03 ACH") is more useful to a treasurer deciding what a row is than Plaid's consumer
-- category ("Food and Drink"), which is noise for an association. Plaid sends the bank's text only when the sync asks
-- for it (options.include_original_description); the sync now does, and stores it here. Existing rows stay null until
-- Plaid next sends them. Display only: nothing reads this for categorization, posting or the payee tally.
-- RLS is per row and already covers a new column, so no policy changes.

alter table public.bank_transactions
  add column if not exists original_description text;

comment on column public.bank_transactions.original_description is
  'The description exactly as the bank printed it (Plaid original_description), when the sync has received it. Display only.';
