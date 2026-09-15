-- 0040: record why a work session started 30+ minutes after its scheduled start.

alter table work_sessions
  add column if not exists late_reason text,
  add column if not exists late_reason_provided_at timestamptz;

alter table work_sessions drop constraint if exists work_sessions_late_reason_check;
alter table work_sessions add constraint work_sessions_late_reason_check
  check (late_reason is null or (char_length(late_reason) between 1 and 1000));
