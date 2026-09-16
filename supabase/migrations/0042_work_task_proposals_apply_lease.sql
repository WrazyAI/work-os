-- 0042: fence proposal application so a recovered (stalled) attempt can never
-- be overwritten by the worker it recovered from, and heartbeats keep a live
-- worker's lease fresh.

alter table work_task_proposals add column if not exists apply_attempt uuid;
