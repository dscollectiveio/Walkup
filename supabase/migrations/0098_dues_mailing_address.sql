-- Walkup migration 0098: where owners mail a dues check.
-- Small associations still get paper checks; the "How owners pay" card gets a mailing address.
-- RLS: nothing new. associations_select lets members read it, associations_update is board_admin only (0002, 0033).

alter table associations add column dues_mailing_address text;

comment on column associations.dues_mailing_address is
  'Where owners mail a dues check. Shown on the owner pay page and the HOA Dues tab.';

-- Zelle: dues_zelle_handle now holds the Zelle email. A phone number and the name Zelle shows
-- to the sender are separate; only one of email or phone is required.
alter table associations
  add column dues_zelle_phone text,
  add column dues_zelle_name  text;

update associations
   set dues_zelle_phone = dues_zelle_handle,
       dues_zelle_handle = null
 where dues_zelle_handle is not null and position('@' in dues_zelle_handle) = 0;

comment on column associations.dues_zelle_handle is 'The email the association receives Zelle at.';
comment on column associations.dues_zelle_phone is 'The U.S. mobile number the association receives Zelle at.';
comment on column associations.dues_zelle_name is 'The name Zelle shows an owner before they send, so they can confirm the recipient.';
