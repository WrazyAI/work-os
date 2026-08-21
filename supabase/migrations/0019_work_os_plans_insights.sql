-- 0019: resumable daily plans and outcome-aware personal insights.

alter table work_daily_plans alter column session_id drop not null;
alter table work_daily_plans add column if not exists revision integer not null default 1;

alter table work_daily_plan_items add column if not exists item_kind text not null default 'nifty_task';
alter table work_daily_plan_items add column if not exists completion_state text not null default 'open';
alter table work_daily_plan_items add column if not exists completed_at timestamptz;

update work_daily_plan_items
set item_kind = case when task_id is null then 'outcome' else 'nifty_task' end
where item_kind not in ('nifty_task', 'outcome')
   or (task_id is null and item_kind = 'nifty_task');

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_item_kind_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_item_kind_check
  check (item_kind in ('nifty_task', 'outcome'));

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_completion_state_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_completion_state_check
  check (completion_state in ('open', 'completed'));

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_kind_task_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_kind_task_check
  check ((item_kind = 'nifty_task' and task_id is not null) or item_kind = 'outcome');

-- Earlier builds could create a plan for more than one session on the same local
-- workday. Consolidate those rows before enforcing the employee/day invariant.
do $$
declare
  duplicate record;
  canonical uuid;
begin
  for duplicate in
    select organization_id, person_id, shift_date
    from work_daily_plans
    group by organization_id, person_id, shift_date
    having count(*) > 1
  loop
    select id into canonical
    from work_daily_plans
    where organization_id = duplicate.organization_id
      and person_id = duplicate.person_id
      and shift_date = duplicate.shift_date
    order by
      case status when 'confirmed' then 0 when 'draft' then 1 else 2 end,
      updated_at desc,
      created_at desc
    limit 1;

    delete from work_daily_plan_items losing
    using work_daily_plan_items keeping, work_daily_plans losing_plan
    where losing.plan_id = losing_plan.id
      and losing_plan.organization_id = duplicate.organization_id
      and losing_plan.person_id = duplicate.person_id
      and losing_plan.shift_date = duplicate.shift_date
      and losing_plan.id <> canonical
      and keeping.plan_id = canonical
      and losing.task_id is not null
      and keeping.task_id = losing.task_id;

    update work_daily_plan_items item
    set plan_id = canonical
    from work_daily_plans losing_plan
    where item.plan_id = losing_plan.id
      and losing_plan.organization_id = duplicate.organization_id
      and losing_plan.person_id = duplicate.person_id
      and losing_plan.shift_date = duplicate.shift_date
      and losing_plan.id <> canonical;

    delete from work_daily_plans
    where organization_id = duplicate.organization_id
      and person_id = duplicate.person_id
      and shift_date = duplicate.shift_date
      and id <> canonical;
  end loop;
end $$;

create unique index if not exists work_daily_plans_person_day_uidx
  on work_daily_plans(organization_id, person_id, shift_date);
create index if not exists work_daily_plan_items_kind_state_idx
  on work_daily_plan_items(organization_id, person_id, item_kind, completion_state);
