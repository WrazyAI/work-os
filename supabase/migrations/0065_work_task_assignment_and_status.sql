alter table public.work_tasks
  add column if not exists workflow_status text not null default 'pending'
    check (workflow_status in ('pending', 'in_progress')),
  add column if not exists assigned_by_person_id uuid references public.work_people (id) on delete set null;

-- A legacy row with no assigner and exactly one assignee records that person as
-- its assigner, which is the control they already had. The person must still
-- exist in the row's organization: an orphaned id would violate the new foreign
-- key and abort the whole migration, so it stays assigner-less (admin-only).
update public.work_tasks t
set assigned_by_person_id = t.assignee_person_ids[1]
where t.assigned_by_person_id is null
  and coalesce(array_length(t.assignee_person_ids, 1), 0) = 1
  and exists (
    select 1 from public.work_people p
    where p.id = t.assignee_person_ids[1]
      and p.organization_id = t.organization_id
  );

create index if not exists work_tasks_assigned_by_idx
  on public.work_tasks (organization_id, assigned_by_person_id);
