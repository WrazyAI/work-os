-- Structured EOD composition.
--
-- The deterministic report stays the full record and the fallback document.
-- The employee's own words (summary, completed, in progress, next), the
-- server-prepared suggestions and evidence snapshot, and the optional Loom
-- share link live beside it so the web composer, the admin review and the
-- employee's submitted view all read one contract.

alter table work_reports
  add column if not exists structured_report jsonb not null default '{}'::jsonb;

alter table work_reports
  add column if not exists loom_url text;

alter table work_reports
  add column if not exists prepared_at timestamptz;

alter table work_report_versions
  add column if not exists structured_report jsonb not null default '{}'::jsonb;
