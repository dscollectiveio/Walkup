-- Problems list: a status the board sets by hand on each line, separate from
-- the ticket's own lifecycle (open, in progress, fixed, closed), because it
-- also tracks payment: Not Started, Quotes Sent, Contractor Selected, Work in
-- Progress, Issue / Problem, Completed - Not Paid, Completed - Paid. Null = nothing chosen yet;
-- the list then shows a default worked out from where the problem is.
-- Board-only like the rest of ticket_board_details (RLS from 0053).

alter table public.ticket_board_details
  add column work_status text
  check (work_status is null or work_status in
    ('not_started', 'quotes_sent', 'contractor_selected', 'work_in_progress', 'issue', 'completed_unpaid', 'completed_paid'));

comment on column public.ticket_board_details.work_status is
  'The board''s own tracker for a problem: not_started, quotes_sent, contractor_selected, work_in_progress, issue, completed_unpaid, completed_paid. Null = none chosen. Does not change tickets.status.';
