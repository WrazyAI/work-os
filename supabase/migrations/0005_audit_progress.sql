-- 0005: live per-day progress for long (day-by-day) vision audits. Additive/idempotent.
alter table audit_runs add column if not exists progress text;
