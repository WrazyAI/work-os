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

-- Local rows created before assignment provenance existed recorded no assigner,
-- and legacy inline subtasks were created with an empty assignee list, which
-- left their own creator with no control over them. The creation audit entry is
-- the only reliable creator record: restore that person only when the actor maps
-- to a person in the row's organization, so a creator is never invented. A
-- subtask also regains the assignee it lost; a top-level task keeps its empty
-- assignee list (an unassigned backlog item is not retroactively claimed as the
-- creator's own work) and only gains the creator as its assigner. Provider rows
-- keep provider ownership and are never rewritten here.
with creators as (
  select distinct on (t.id) t.id as task_id, p.id as person_id
  from public.work_tasks t
  join public.work_audit_log a
    on a.organization_id = t.organization_id
   and a.target_type = 'work_os_task'
   and a.target_id = t.provider_task_id
   and a.action in ('task.created', 'task.subtask_created', 'agent.task.created')
  join public.work_people p
    on p.organization_id = t.organization_id
   and p.auth_user_id = a.actor_user_id
  where t.provider = 'local'
    and t.assigned_by_person_id is null
    and coalesce(array_length(t.assignee_person_ids, 1), 0) = 0
  order by t.id, a.created_at, a.id
)
update public.work_tasks t
set assigned_by_person_id = creators.person_id,
    assignee_person_ids = case
      when t.parent_task_id is null then t.assignee_person_ids
      else array[creators.person_id]
    end
from creators
where t.id = creators.task_id;

-- A local subtask with no creator audit entry inherits the ownership its parent
-- already had. Only a sole, same-organization parent assignee is copied, so the
-- migration never expands a shared task's assignees or invents a person.
with inherited as (
  select
    child.id as task_id,
    parent.assigned_by_person_id as assigner_id,
    case
      when coalesce(array_length(parent.assignee_person_ids, 1), 0) = 1
        and exists (
          select 1 from public.work_people p
          where p.id = parent.assignee_person_ids[1]
            and p.organization_id = child.organization_id
        )
      then parent.assignee_person_ids[1]
    end as assignee_id
  from public.work_tasks child
  join public.work_tasks parent on parent.id = child.parent_task_id
  where child.provider = 'local'
    and child.assigned_by_person_id is null
    and coalesce(array_length(child.assignee_person_ids, 1), 0) = 0
    and parent.organization_id = child.organization_id
    and (
      parent.assigned_by_person_id is not null
      or (
        coalesce(array_length(parent.assignee_person_ids, 1), 0) = 1
        and exists (
          select 1 from public.work_people p
          where p.id = parent.assignee_person_ids[1]
            and p.organization_id = child.organization_id
        )
      )
    )
)
update public.work_tasks t
set assigned_by_person_id = coalesce(
      (
        select p.id from public.work_people p
        where p.id = inherited.assigner_id
          and p.organization_id = t.organization_id
      ),
      inherited.assignee_id
    ),
    assignee_person_ids = case
      when inherited.assignee_id is null then t.assignee_person_ids
      else array[inherited.assignee_id]
    end
from inherited
where t.id = inherited.task_id
  and coalesce(
    (
      select p.id from public.work_people p
      where p.id = inherited.assigner_id
        and p.organization_id = t.organization_id
    ),
    inherited.assignee_id
  ) is not null;

create index if not exists work_tasks_assigned_by_idx
  on public.work_tasks (organization_id, assigned_by_person_id);
