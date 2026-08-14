-- Guided onboarding drafts and Worktivity-authoritative attendance projection.

alter table work_employee_onboarding add column if not exists catalog_version text;
alter table work_employee_onboarding add column if not exists draft_step text;
alter table work_employee_onboarding add column if not exists draft_updated_at timestamptz;

alter table work_sessions alter column scheduled_starts_at drop not null;
alter table work_sessions alter column scheduled_ends_at drop not null;
alter table work_sessions add column if not exists attendance_status text
  check(attendance_status is null or attendance_status in ('clock_in','working','break','idle','clock_out','yet_to_start','unknown'));
alter table work_sessions add column if not exists attendance_observed_at timestamptz;

alter table work_sessions drop constraint if exists work_sessions_check;
alter table work_sessions drop constraint if exists work_sessions_schedule_window_check;
alter table work_sessions add constraint work_sessions_schedule_window_check
  check(scheduled_starts_at is null or scheduled_ends_at is null or scheduled_ends_at > scheduled_starts_at);

alter table work_sessions drop constraint if exists work_sessions_source_check;
alter table work_sessions add constraint work_sessions_source_check
  check(source in ('web','desktop','agent','system','worktivity','work_os_fallback'));
