-- 0043: drop the plan-item kind/task consistency check.
--
-- work_daily_plan_items.task_id references work_tasks(id) on delete set null.
-- When a task row is ever deleted, the FK's SET NULL produces a task-kind item
-- with a null task_id, which violated
--   (item_kind = 'nifty_task' and task_id is not null) or item_kind = 'outcome'
-- and made the delete fail outright. A null task_id is a legitimate tombstone
-- state: no workspace surface renders an item whose task cannot be resolved
-- (they filter on a truthy task_id), so the check protected nothing the app
-- relies on. The item_kind value set is still constrained (0041).

alter table work_daily_plan_items drop constraint if exists work_daily_plan_items_kind_task_check;
