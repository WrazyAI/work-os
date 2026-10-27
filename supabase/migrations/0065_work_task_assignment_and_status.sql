alter table public.work_tasks
  add column if not exists workflow_status text not null default 'pending'
    check (workflow_status in ('pending', 'in_progress')),
  add column if not exists assigned_by_person_id uuid references public.work_people (id) on delete set null;

update public.work_tasks
set assigned_by_person_id = assignee_person_ids[1]
where assigned_by_person_id is null
  and coalesce(array_length(assignee_person_ids, 1), 0) = 1;

create index if not exists work_tasks_assigned_by_idx
  on public.work_tasks (organization_id, assigned_by_person_id);
