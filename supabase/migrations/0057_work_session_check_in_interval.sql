-- Record the check-in cadence (minutes) that produced the pending
-- next_fallback_at deadline, so a per-person cadence edit can be told apart
-- from the companion's delivery lag and rebased immediately.
alter table if exists work_sessions
  add column if not exists check_in_interval_minutes integer;
