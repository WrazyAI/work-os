-- 0018: preserve Nifty source chronology and parent/subtask relationships.
alter table work_tasks add column if not exists provider_created_at timestamptz;
alter table work_tasks add column if not exists provider_updated_at timestamptz;
alter table work_tasks add column if not exists parent_provider_task_id text;
alter table work_tasks add column if not exists parent_task_id uuid references work_tasks(id) on delete set null;

create index if not exists work_tasks_provider_created_idx on work_tasks(organization_id, provider_created_at desc, completed);
create index if not exists work_tasks_parent_idx on work_tasks(organization_id, parent_task_id);
