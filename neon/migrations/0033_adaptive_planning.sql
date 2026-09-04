-- Neon/Lakebase Postgres migration: retain the employee's raw intent separately
-- from an accepted planning interpretation and daily commitment details.
alter table work_daily_plans
  add column if not exists focus_summary text,
  add column if not exists interpretation_metadata jsonb not null default '{}'::jsonb;

alter table work_daily_plan_items
  add column if not exists objective text,
  add column if not exists success_criteria jsonb not null default '[]'::jsonb,
  add column if not exists estimate_minutes integer,
  add column if not exists source_refs jsonb not null default '[]'::jsonb,
  add column if not exists clarification_state text;

alter table work_daily_plan_items
  drop constraint if exists work_daily_plan_items_estimate_minutes_check;
alter table work_daily_plan_items
  add constraint work_daily_plan_items_estimate_minutes_check
  check (estimate_minutes is null or estimate_minutes between 1 and 720);

alter table work_daily_plan_items
  drop constraint if exists work_daily_plan_items_clarification_state_check;
alter table work_daily_plan_items
  add constraint work_daily_plan_items_clarification_state_check
  check (clarification_state is null or clarification_state in ('none', 'needs_clarification', 'resolved'));
