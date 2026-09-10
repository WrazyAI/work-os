-- 0036: query indexes for the Work OS dashboard/tasks fast paths.
-- Additive only: every statement is guarded with "if not exists" so the file is
-- safe to re-run. Indexes target the exact filters used by the day view, task
-- lists, task details, the tombstone sweep, and the insights rollup.

-- work_tasks ---------------------------------------------------------------
-- Person-scoped task lists filter with JSONB containment on person ids.
create index if not exists work_tasks_assignee_person_ids_gin_idx
  on work_tasks using gin (assignee_person_ids);

-- Subtask lookups and archive/delete cascades filter by provider parent id.
create index if not exists work_tasks_org_parent_provider_idx
  on work_tasks (organization_id, parent_provider_task_id);

-- Day-event hydration and evidence joins look tasks up by provider id per org.
create index if not exists work_tasks_org_provider_task_idx
  on work_tasks (organization_id, provider_task_id);

-- The daily workspace scans live tasks for one org+user, newest first.
create index if not exists work_tasks_org_user_live_idx
  on work_tasks (organization_id, user_id)
  where status not in ('archived', 'deleted');

-- work_task_day_events -----------------------------------------------------
-- Attribution reads a whole org day ordered by observation time.
create index if not exists work_task_day_events_org_date_observed_idx
  on work_task_day_events (organization_id, local_date, observed_at);

-- work_daily_plan_items ----------------------------------------------------
-- Tombstone sweep and plan-item hydration look items up by task id.
create index if not exists work_daily_plan_items_task_idx
  on work_daily_plan_items (task_id);

-- work_evidence ------------------------------------------------------------
-- Evidence queue filters one org and person set, newest first.
create index if not exists work_evidence_org_person_created_idx
  on work_evidence (organization_id, person_id, created_at desc);

-- work_check_ins -----------------------------------------------------------
-- Insights read substantive check-ins across a date range per person.
create index if not exists work_check_ins_org_person_shift_idx
  on work_check_ins (organization_id, person_id, shift_date);

-- work_audit_log -----------------------------------------------------------
-- Goal metadata lookup reads one org, target type, and target id.
create index if not exists work_audit_log_org_target_idx
  on work_audit_log (organization_id, target_type, target_id);

analyze work_tasks;
analyze work_task_day_events;
analyze work_daily_plan_items;
analyze work_evidence;
analyze work_check_ins;
analyze work_audit_log;
