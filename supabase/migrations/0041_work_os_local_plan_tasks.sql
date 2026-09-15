-- 0041: plan items can link to Work OS-native tasks created from the plan
-- (SOD goals materialized on confirm), alongside Nifty-mirrored tasks.

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_item_kind_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_item_kind_check
  check (item_kind in ('nifty_task', 'outcome', 'local_task'));

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_kind_task_check;
alter table work_daily_plan_items add constraint work_daily_plan_items_kind_task_check
  check ((item_kind in ('nifty_task', 'local_task') and task_id is not null) or item_kind = 'outcome');
