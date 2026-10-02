-- Recap-approved next steps.
--
-- When an employee confirms or amends an Activity Interval Review, the review
-- may produce task suggestions through the existing proposal pipeline. Two
-- pieces of bookkeeping keep that generation bounded and honest:
--
-- 1. `next_steps_status` on the interval records whether a generation pass ran
--    for the current recap revision (and its outcome), so an approved recap is
--    analyzed at most once and a failed pass can retry without duplicates.
-- 2. `source_interval_id` on the proposal row is the provenance anchor: the
--    companion labels the suggestion "From your <recap> recap" and the server
--    dedupes and suppresses re-suggestions from the same evidence.

alter table work_activity_intervals
  add column if not exists next_steps_status text
    check (next_steps_status in ('pending', 'generating', 'ready', 'skipped', 'failed')),
  add column if not exists next_steps_at timestamptz,
  add column if not exists next_steps_error text;

create index if not exists work_activity_intervals_next_steps_pending_idx
  on work_activity_intervals (organization_id, created_at)
  where next_steps_status = 'pending';

alter table work_task_proposals
  add column if not exists source_interval_id uuid references work_activity_intervals(id) on delete set null;

create index if not exists work_task_proposals_source_interval_idx
  on work_task_proposals (source_interval_id)
  where source_interval_id is not null;
