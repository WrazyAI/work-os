-- A person may stop and restart work on the same local day. Keep each interval
-- as its own auditable session instead of reopening and overwriting a closed
-- interval. The partial active-session index still guarantees one live session.

drop index if exists work_sessions_person_day_uidx;

create index if not exists work_sessions_person_day_history_idx
  on work_sessions(organization_id, person_id, shift_date, created_at desc);
