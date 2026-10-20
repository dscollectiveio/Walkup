-- Setup guide: let a board admin tick a step by hand (or untick one that
-- ticked itself). The guide is still derived from real rows; this only records
-- the exceptions, as { "step_key": "done" | "not_done" }. A step with no entry
-- follows the data. associations_update already restricts writes to board_admin.

alter table public.associations
  add column setup_overrides jsonb not null default '{}'::jsonb
  check (jsonb_typeof(setup_overrides) = 'object');

comment on column public.associations.setup_overrides is
  'Manual setup-guide ticks: {step_key: "done" | "not_done"}. No entry = the step follows the data.';
