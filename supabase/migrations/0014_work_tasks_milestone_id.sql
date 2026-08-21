alter table work_tasks add column if not exists milestone_id text;

create index if not exists work_tasks_milestone_idx on work_tasks (milestone_id);
