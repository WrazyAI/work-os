-- 0039: distinguish AI-drafted daily goals from employee-typed intent.

alter table work_daily_plans drop constraint if exists work_daily_plans_goal_provenance_check;
alter table work_daily_plans add constraint work_daily_plans_goal_provenance_check
  check (goal_provenance is null or goal_provenance in ('employee', 'suggested', 'accepted_suggestion', 'ai_draft'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'work_daily_plans' and column_name = 'focus_summary'
  ) then
    update work_daily_plans
    set goal_provenance = 'ai_draft'
    where focus_summary is not null
      and btrim(focus_summary) <> ''
      and goal_provenance = 'employee';
  end if;
end $$;
