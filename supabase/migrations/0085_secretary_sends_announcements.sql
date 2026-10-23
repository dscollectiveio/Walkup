-- ============================================================================
-- 0085: the Secretary can finish what they approve
-- ============================================================================
-- 0076 let the Secretary approve an announcement email (email_approve_batch), but the three functions the sender
-- calls next (email_claim, email_mark_sent, email_mark_failed) still needed a board admin, so a batch the Secretary
-- approved stayed queued until an admin pressed "Resume sending" (workflow guide, Appendix A).
--
-- Each is the function in force today with named pieces of text swapped, taken from the catalog so nothing is
-- retyped. If a piece is not found the migration stops, so a later change to one of them can never be silently
-- skipped. The Secretary gets this for announcement batches and announcement messages only: dues reminders,
-- statements and late-fee notices still need a board admin.

do $$
declare
  r     record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.email_claim(uuid, integer)',
       $f$or public.has_role_in(v_assoc, array['board_admin']::public.app_role[]))$f$,
       $t$or public.has_role_in(v_assoc, array['board_admin']::public.app_role[])
         or (public.has_position(v_assoc, 'secretary')
             and exists (select 1 from public.email_batches sb where sb.id = p_batch_id and sb.kind = 'announcement')))$t$),
      ('public.email_mark_sent(uuid, uuid, text, text)',
       $f$public.has_role_in(o.association_id, array['board_admin']::public.app_role[])$f$,
       $t$public.has_role_in(o.association_id, array['board_admin']::public.app_role[])
                                     or (o.kind = 'announcement' and public.has_position(o.association_id, 'secretary'))$t$),
      ('public.email_mark_failed(uuid, uuid, text, boolean)',
       $f$public.has_role_in(o.association_id, array['board_admin']::public.app_role[])$f$,
       $t$public.has_role_in(o.association_id, array['board_admin']::public.app_role[])
                                     or (o.kind = 'announcement' and public.has_position(o.association_id, 'secretary'))$t$)
    ) as t(sig, from_text, to_text)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.from_text in v_def) = 0 then
      raise exception '0085: % no longer contains the text this migration replaces: %', r.sig, r.from_text;
    end if;
    execute replace(v_def, r.from_text, r.to_text);
  end loop;
end $$;
