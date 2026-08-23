-- 0020: preserve daily-goal authorship while Tasks replaces Plan in the employee UI.

alter table work_daily_plans
  add column if not exists goal_provenance text,
  add column if not exists suggestion_task_ids jsonb not null default '[]'::jsonb;

update work_daily_plans
set goal_provenance = 'employee'
where freeform_intent is not null
  and btrim(freeform_intent) <> ''
  and goal_provenance is null;

alter table work_daily_plans drop constraint if exists work_daily_plans_goal_provenance_check;
alter table work_daily_plans add constraint work_daily_plans_goal_provenance_check
  check (goal_provenance is null or goal_provenance in ('employee', 'suggested', 'accepted_suggestion'));

alter table work_daily_plans drop constraint if exists work_daily_plans_suggestion_task_ids_check;
alter table work_daily_plans add constraint work_daily_plans_suggestion_task_ids_check
  check (jsonb_typeof(suggestion_task_ids) = 'array');
