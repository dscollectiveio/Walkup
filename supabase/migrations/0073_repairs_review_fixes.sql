-- Two repairs fixes found in review.
--
-- 1. close_out_ticket now keeps ticket_expenses (0071) and
--    ticket_board_details.expense_id in step. Closing a problem with no payment chosen
--    used to write expense_id = null and leave ticket_expenses behind, so the problem page
--    said "Not linked" while the Problems tab still showed the payments. Now: a payment
--    chosen in the dialog becomes the problem's one linked payment, and none chosen leaves
--    what is linked alone. Anything closed out since 0071 is backfilled below.
-- 2. set_ticket_priority writes the one-word urgency labels (Low, Normal, Urgent) into the
--    note the reporter reads, matching the rest of the app.

insert into public.ticket_expenses (ticket_id, expense_id, association_id)
select d.ticket_id, d.expense_id, d.association_id
  from public.ticket_board_details d
 where d.expense_id is not null
on conflict do nothing;

create or replace function public.close_out_ticket(
  p_ticket_id       uuid,
  p_status          text,
  p_actual_cost     numeric,
  p_expense_id      uuid,
  p_resolution_note text,
  p_log_upkeep      boolean)
returns table (upkeep_logged boolean, task_next_due_on date)
language plpgsql security invoker set search_path = ''
as $$
declare
  v        public.tickets%rowtype;
  v_logged boolean := false;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can mark a problem fixed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('resolved', 'closed') then
    raise exception 'choose fixed or closed' using errcode = '22023';
  end if;
  if p_actual_cost is not null and p_actual_cost < 0 then
    raise exception 'the cost can''t be negative' using errcode = '22023';
  end if;
  if p_resolution_note is not null and char_length(p_resolution_note) > 2000 then
    raise exception 'keep what was done under 2,000 characters' using errcode = '22023';
  end if;

  update public.tickets
     set status = p_status::public.ticket_status,
         resolution_note = coalesce(nullif(btrim(coalesce(p_resolution_note, '')), ''), resolution_note)
   where id = p_ticket_id;

  -- Payments tied to the problem live in ticket_expenses (0071); expense_id mirrors the first.
  -- A payment chosen here becomes the one linked payment. No payment chosen leaves whatever is
  -- already linked alone (closing a problem must not unlink what the Problems tab tied to it).
  if p_expense_id is not null then
    delete from public.ticket_expenses where ticket_id = p_ticket_id;
    insert into public.ticket_expenses (ticket_id, expense_id, association_id)
    values (p_ticket_id, p_expense_id, v.association_id);
  end if;

  insert into public.ticket_board_details (ticket_id, association_id, actual_cost, expense_id)
  values (
    p_ticket_id, v.association_id, round(p_actual_cost, 2),
    coalesce(p_expense_id, (select e.expense_id from public.ticket_expenses e where e.ticket_id = p_ticket_id order by e.created_at, e.expense_id limit 1))
  )
  on conflict (ticket_id) do update
    set actual_cost = excluded.actual_cost, expense_id = excluded.expense_id;

  if coalesce(p_log_upkeep, false) and v.upkeep_task_id is not null then
    if not exists (select 1 from public.upkeep_log l where l.ticket_id = p_ticket_id) then
      perform public.mark_upkeep_done(
        v.upkeep_task_id, (now() at time zone 'America/Chicago')::date, round(p_actual_cost, 2),
        v.assigned_vendor_id, 'From problem #' || v.reference, p_ticket_id);
      v_logged := true;
    else
      -- Closed again with a corrected cost (REVIEW-4 #9): the history follows the ticket,
      -- so the task page and the problem never show two different costs.
      update public.upkeep_log set cost = round(p_actual_cost, 2) where ticket_id = p_ticket_id;
    end if;
  end if;

  return query
    select v_logged, (select k.next_due_on from public.upkeep_tasks k where k.id = v.upkeep_task_id);
end $$;


create or replace function public.set_ticket_priority(p_ticket_id uuid, p_priority text, p_reason text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v public.tickets%rowtype;
  v_rank_old int;
  v_rank_new int;
  v_reporter_is_board boolean;
begin
  select * into v from public.tickets t where t.id = p_ticket_id for update;
  if not found or not public.is_board(v.association_id) then
    raise exception 'only a board member can change the urgency' using errcode = '42501';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'urgent') then
    raise exception 'choose an urgency' using errcode = '22023';
  end if;
  if p_priority = v.priority::text then
    return;
  end if;
  v_rank_old := case v.priority::text when 'urgent' then 0 when 'normal' then 1 else 2 end;
  v_rank_new := case p_priority      when 'urgent' then 0 when 'normal' then 1 else 2 end;
  v_reporter_is_board := v.reported_by is null or exists (
    select 1 from public.role_grants g
     where g.person_id = v.reported_by and g.association_id = v.association_id
       and g.role in ('board_admin', 'board_member') and g.revoked_at is null
       and (g.expires_on is null or g.expires_on >= current_date));

  if v_rank_new > v_rank_old and not v_reporter_is_board
     and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why, so the person who reported it understands' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_reason is not null and char_length(p_reason) > 300 then
    raise exception 'keep the reason under 300 characters' using errcode = '22023';
  end if;

  update public.tickets set priority = p_priority::public.ticket_priority where id = p_ticket_id;

  if nullif(btrim(coalesce(p_reason, '')), '') is not null then
    insert into public.ticket_comments (association_id, ticket_id, body, is_internal)
    values (v.association_id, p_ticket_id,
            'Urgency changed to "' ||
            case p_priority when 'urgent' then 'Urgent' when 'normal' then 'Normal' else 'Low' end
            || '": ' || btrim(p_reason), false);
  end if;
end $$;


revoke all on function public.close_out_ticket(uuid, text, numeric, uuid, text, boolean) from public, anon;
grant execute on function public.close_out_ticket(uuid, text, numeric, uuid, text, boolean) to authenticated;

revoke all on function public.set_ticket_priority(uuid, text, text) from public, anon;
grant execute on function public.set_ticket_priority(uuid, text, text) to authenticated;
