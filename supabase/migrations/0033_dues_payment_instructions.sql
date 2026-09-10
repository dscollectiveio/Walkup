-- ============================================================================
-- Walkup — migration 0033: how owners push their dues payment
--
-- The HOA Dues page tells an owner exactly where to send money — payee name,
-- account/routing (or a Zelle handle), and any notes the board wants
-- attached (e.g. "bill pay only, we don't accept Zelle over $500"). This is
-- the association's OWN receiving-payment info, the same kind of thing a
-- paper coupon book or an email from the treasurer would say — not a
-- financial credential of anyone's, and not sensitive in the way a login or
-- card number is. It belongs on the association row alongside legal_name/EIN
-- (0001): governance-adjacent profile data, not ledger data.
--
-- RLS: no new policy needed. associations_select (0002) already lets every
-- member read it — owners are exactly who needs to see this — and
-- associations_update is already board_admin-only.
-- ============================================================================

alter table associations
  add column dues_payee_name     text,
  add column dues_bank_name      text,
  add column dues_account_number text,
  add column dues_routing_number text,
  add column dues_zelle_handle   text,
  add column dues_payment_notes  text;

comment on column associations.dues_payee_name is
  'Payee name for bill pay — e.g. "2158 N Damen Ave HOA". Shown to owners on the HOA Dues page.';
comment on column associations.dues_account_number is
  'The association''s own receiving account number, given to owners so they can push a payment via bill pay. Not a credential — nothing is authenticated with this.';
comment on column associations.dues_routing_number is
  'Routing number paired with dues_account_number for bill pay setup.';
comment on column associations.dues_zelle_handle is
  'Email or phone the association receives Zelle payments at, if it accepts them.';
comment on column associations.dues_payment_notes is
  'Freeform board notes shown alongside the payment details — e.g. memo instructions, a per-payment limit, which methods are accepted.';
