-- App usage is report context, never an hours input. It is frozen with the
-- analysis revision so an audit keeps the distribution it was reviewed with.
begin;
alter table public.work_payroll_analysis_revisions
  add column if not exists apps_summary jsonb not null default '{}'::jsonb;
commit;
