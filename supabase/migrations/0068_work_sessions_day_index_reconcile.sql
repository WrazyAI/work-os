-- Work OS keeps every Worktivity interval as its own session, so an employee
-- can stop and restart work on the same local day. Migration 0027 removed the
-- original one-session-per-day index, but some environments still carry it
-- because that drop never reached them. The leftover index rejects the second
-- interval, leaving attendance unmirrored and the check-in cadence stopped.
drop index if exists work_sessions_person_day_uidx;

create index if not exists work_sessions_person_day_history_idx
  on work_sessions(organization_id, person_id, shift_date, created_at desc);
