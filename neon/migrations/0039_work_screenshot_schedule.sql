-- 0039: per-employee scheduling for the Worktivity screenshot analysis.
-- Additive only. A null window means "derive from the shift": hourly runs from
-- shift start, plus an end-of-day pass one lead ahead of shift end.

alter table work_schedules
  add column if not exists screenshot_analysis_enabled boolean not null default true,
  add column if not exists screenshot_analysis_interval_minutes integer not null default 60,
  add column if not exists screenshot_analysis_start time,
  add column if not exists screenshot_analysis_end time,
  add column if not exists screenshot_analysis_eod_lead_minutes integer not null default 30;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_schedules_screenshot_interval_check') then
    alter table work_schedules
      add constraint work_schedules_screenshot_interval_check
      check (screenshot_analysis_interval_minutes between 15 and 240);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_schedules_screenshot_eod_lead_check') then
    alter table work_schedules
      add constraint work_schedules_screenshot_eod_lead_check
      check (screenshot_analysis_eod_lead_minutes between 0 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_schedules_screenshot_window_check') then
    alter table work_schedules
      add constraint work_schedules_screenshot_window_check
      check ((screenshot_analysis_start is null) = (screenshot_analysis_end is null));
  end if;
end $$;

analyze work_schedules;
