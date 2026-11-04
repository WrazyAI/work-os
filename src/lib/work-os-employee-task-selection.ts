import { getPool } from "@/lib/db/pool";
import { createAdminClient } from "@/lib/supabase/admin";
import { hydrateTaskAssignees, isTaskAssignedToPerson } from "@/lib/work-os-tasks";
import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";

type Row = Record<string, any>;

/** Resolve ownership and dated historical evidence BEFORE fetching full rows.
 * There is deliberately no organization-wide candidate limit. The assigner
 * predicate used by management lists is not a personal-work predicate. */
export async function loadEmployeeWorkspaceTasks(
  access: WorkOsAccess, niftyMemberId: string | null, from: string, through: string,
  opts: { completedOnly?: boolean } = {},
) {
  const ownerId = workOsOrganizationOwnerId(access);
  const selected = await getPool().query<{ id: string }>(`
    with eligible as (
      select t.id, t.provider_task_id, t.parent_task_id, t.parent_provider_task_id
      from work_tasks t
      where t.organization_id = $1::uuid and t.user_id = $2::uuid
        and t.status not in ('archived', 'deleted')
        and (
          t.assignee_person_ids @> array[$3::uuid]
          or ($4::text is not null and (
            t.assignee_provider_ids @> array[$4::text]
            or t.raw->>'created_by' = $4::text
            or t.raw->'subscribers' @> to_jsonb(array[$4::text])
          ))
          or exists (select 1 from work_task_day_events e
            where e.organization_id = $1::uuid and e.person_id = $3::uuid
              and e.task_id = t.id and e.local_date between $5::date and $6::date)
          or exists (select 1 from work_daily_plans p join work_daily_plan_items i on i.plan_id = p.id
            where p.organization_id = $1::uuid and p.person_id = $3::uuid
              and p.shift_date between $5::date and $6::date and i.disposition <> 'removed'
              and i.task_id = t.id)
        )
        and (not $7::boolean or (
          t.completed = true
          and (
            t.due_date between $5::date and $6::date
            or t.created_at >= $5::date and t.created_at < $6::date + 1
            or t.provider_created_at >= $5::date and t.provider_created_at < $6::date + 1
            or t.completed_at >= $5::date and t.completed_at < $6::date + 1
            or exists (select 1 from work_task_day_events e
              where e.organization_id = $1::uuid and e.person_id = $3::uuid and e.task_id = t.id
                and e.event_type = 'completed' and e.local_date between $5::date and $6::date)
            or exists (select 1 from work_daily_plans p join work_daily_plan_items i on i.plan_id = p.id
              where p.organization_id = $1::uuid and p.person_id = $3::uuid
                and p.shift_date between $5::date and $6::date and i.disposition <> 'removed'
                and i.task_id = t.id)
          )
        ))
    ), family as (
      select id from eligible
      union
      select p.id from work_tasks p
      where p.organization_id = $1::uuid and p.user_id = $2::uuid and p.status not in ('archived', 'deleted')
        and (p.id in (select parent_task_id from eligible where parent_task_id is not null)
          or p.provider_task_id in (select parent_provider_task_id from eligible where parent_task_id is null and parent_provider_task_id is not null))
      union
      select c.id from work_tasks c
      where c.organization_id = $1::uuid and c.user_id = $2::uuid and c.status not in ('archived', 'deleted')
        and cardinality(c.assignee_person_ids) = 0 and cardinality(c.assignee_provider_ids) = 0
        and (c.parent_task_id in (select id from eligible)
          or (c.parent_task_id is null and c.parent_provider_task_id in (select provider_task_id from eligible)))
    ) select id from family order by id
  `, [access.organizationId, ownerId, access.personId, niftyMemberId?.trim() || null, from, through, opts.completedOnly === true]);
  const rows: Row[] = [];
  // Bound parameter lists, not completeness. Every selected ID is fetched.
  for (let offset = 0; offset < selected.rows.length; offset += 500) {
    const result = await createAdminClient().from("work_tasks")
      .select("*,project:work_projects(id,name,provider_project_id)")
      .eq("organization_id", access.organizationId).eq("user_id", ownerId)
      .not("status", "in", "(archived,deleted)")
      .in("id", selected.rows.slice(offset, offset + 500).map((row) => row.id));
    if (result.error) throw new Error(`load employee workspace tasks: ${result.error.message}`);
    rows.push(...(result.data ?? []));
  }
  return await hydrateTaskAssignees(ownerId, rows, access.organizationId) as Row[];
}

/** Historical ownership is date-bound: a reassigned task's personal event or
 * saved plan must not make it appear on every other day in an insight range. */
export function employeeWorkspaceTasksForDay(
  tasks: Row[], personId: string | null, niftyMemberId: string | null, events: Row[], plan: Row | null,
) {
  const recorded = new Set(events.filter((event) => event.person_id === personId).map((event) => String(event.task_id)));
  for (const item of Array.isArray(plan?.items) ? plan.items : []) {
    if (item.task_id && item.disposition !== "removed") recorded.add(String(item.task_id));
  }
  const own = tasks.filter((task) => isTaskAssignedToPerson(task, personId, niftyMemberId)
    || recorded.has(String(task.id)) || recorded.has(String(task.provider_task_id)));
  const ownIds = new Set(own.map((task) => String(task.id)));
  const ownProviderIds = new Set(own.map((task) => String(task.provider_task_id)));
  const parentIds = new Set(own.map((task) => String(task.parent_task_id ?? "")));
  const parentProviderIds = new Set(own.map((task) => String(task.parent_provider_task_id ?? "")));
  return tasks.filter((task) => ownIds.has(String(task.id))
    || parentIds.has(String(task.id)) || parentProviderIds.has(String(task.provider_task_id))
    || ((!task.assignee_person_ids?.length && !task.assignee_provider_ids?.length)
      && (ownIds.has(String(task.parent_task_id)) || ownProviderIds.has(String(task.parent_provider_task_id)))));
}

export async function loadEmployeeWorkspaceEvents(access: WorkOsAccess, tasks: Row[], from: string, through: string) {
  const events: Row[] = [];
  for (let offset = 0; offset < tasks.length; offset += 500) {
    const result = await createAdminClient().from("work_task_day_events").select("*")
      .eq("organization_id", access.organizationId).gte("local_date", from).lte("local_date", through)
      .in("task_id", tasks.slice(offset, offset + 500).map((task) => task.id))
      .order("observed_at", { ascending: true }).order("id", { ascending: true });
    if (result.error) throw new Error(`load employee workspace events: ${result.error.message}`);
    events.push(...(result.data ?? []));
  }
  return events;
}
