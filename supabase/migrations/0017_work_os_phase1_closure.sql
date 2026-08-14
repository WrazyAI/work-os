-- Phase 1 closure: server-owned prompt cadence and reviewable plan removal.

alter table work_sessions add column if not exists first_follow_up_at timestamptz;
alter table work_sessions add column if not exists next_fallback_at timestamptz;
alter table work_sessions add column if not exists last_prompt_kind text;
alter table work_sessions add column if not exists last_prompt_at timestamptz;

alter table work_sessions drop constraint if exists work_sessions_last_prompt_kind_check;
alter table work_sessions add constraint work_sessions_last_prompt_kind_check
  check(last_prompt_kind is null or last_prompt_kind in ('follow_up','hourly_fallback','eod'));

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_disposition_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_disposition_check
  check(disposition in ('selected','deferred','removal_proposed','removed'));

alter table work_task_proposals drop constraint if exists work_task_proposals_operation_check;
alter table work_task_proposals add constraint work_task_proposals_operation_check
  check(operation in ('create_task','update_task','log_progress','add_blocker','resolve_blocker','link_evidence','complete_task','remove_from_plan'));

create index if not exists work_sessions_prompt_idx
  on work_sessions(organization_id,person_id,next_fallback_at)
  where state in ('clocked_in','active','paused','eod_due');
