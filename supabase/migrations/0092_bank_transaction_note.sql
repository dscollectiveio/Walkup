-- ============================================================================
-- 0092: a note on a bank transaction ("what was this for?")
-- ============================================================================
-- The next treasurer will ask why a payment was filed the way it was. A short note written when the transaction is
-- sorted answers that without digging through emails. Free text, board-written, optional. Display only: nothing
-- reads it for categorization, posting or the payee tally. It lives on the bank row, so it survives a reconnect
-- (adoption copies the row) and stays with the transaction when it is posted or unposted. RLS is per row and already
-- covers a new column: only a board admin can update bank_transactions, and everyone who can read the feed can read it.

alter table public.bank_transactions
  add column if not exists note text check (note is null or char_length(note) <= 500);

comment on column public.bank_transactions.note is
  'Optional board note on what the transaction was for (max 500 characters). Display only.';
