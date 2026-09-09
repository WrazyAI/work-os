import {
  listNiftyMembers,
  listNiftyProjects,
  listNiftyTasks,
  type NiftyTaskSummary,
} from "@/lib/integrations/nifty";
import { localDateForTimezone } from "@/modules/work-os/companion";
import {
  dateOnly,
  db,
  ensureNoError,
  niftyForOwner,
  niftyIdentity,
  selectFirst,
  section,
  type Db,
  type Json,
} from "@/lib/work-os-internal";
import { ensureWorkOsDefaults } from "@/lib/work-os-bootstrap";
import { sweepTombstonedPlanItems } from "@/lib/work-os-plan-ghosts";

async function mapAssigneePeople(supabase: Db, userId: string, assigneeIds: string[]) {
  if (!assigneeIds.length) return [];
  const people = await ensureNoError(
    supabase.from("work_people").select("id,nifty_member_id").eq("user_id", userId).in("nifty_member_id", assigneeIds),
    "map task assignees",
  );
  return (people ?? []).map((person: { id: string }) => person.id);
}

export async function upsertNiftyProject(userId: string, project: { id: string; name: string; archived?: boolean; raw: Json }) {
  return selectFirst(
    db().from("work_projects").upsert({
      user_id: userId,
      provider: "nifty",
      provider_project_id: project.id,
      name: project.name,
      archived: project.archived ?? null,
      raw: project.raw,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,provider_project_id" }).select("*"),
    "upsert Nifty project",
  );
}

export async function upsertNiftyMember(userId: string, member: { id: string; name: string; email?: string | null; raw: Json }) {
  const supabase = db();
  const email = member.email?.trim() || null;
  if (email) {
    const existing = await ensureNoError(
      supabase
        .from("work_people")
        .select("*")
        .eq("user_id", userId)
        .ilike("email", email)
        .maybeSingle(),
      "find existing Nifty member by email",
    );
    if (existing) {
      return selectFirst(
        supabase.from("work_people").update({
          display_name: existing.display_name || member.name,
          email,
          nifty_member_id: member.id,
          raw: { ...(existing.raw ?? {}), nifty: member.raw },
          active: true,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*"),
        "merge Nifty member by email",
      );
    }
  }

  return selectFirst(
    supabase.from("work_people").upsert({
      user_id: userId,
      display_name: member.name,
      email,
      nifty_member_id: member.id,
      raw: { nifty: member.raw },
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,nifty_member_id" }).select("*"),
    "upsert Nifty member",
  );
}

async function mirrorMappedTaskFields(userId: string, taskId: string, rawTask: Json) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load mapped task organization: ${organizationError.message}`);
  if (!organization) return;
  const { data: mappings, error: mappingError } = await db().from("work_provider_field_mappings")
    .select("semantic_field,provider_field_id").eq("organization_id", organization.id).eq("provider", "nifty");
  if (mappingError) throw new Error(`load mapped Nifty task fields: ${mappingError.message}`);
  if (!mappings?.length) return;
  const candidates = [rawTask.custom_fields, rawTask.customFields, rawTask.fields, rawTask.task_fields]
    .find(Array.isArray) as Json[] | undefined;
  if (!candidates) return;
  const values = new Map(candidates.map((field) => [
    String(field.id ?? field.field_id ?? field.fieldId ?? ""),
    field.value ?? field.selected_value ?? field.selectedValue ?? null,
  ]));
  const patch: Json = {};
  for (const mapping of mappings) {
    if (!values.has(mapping.provider_field_id)) continue;
    const rawValue = values.get(mapping.provider_field_id);
    const value = rawValue && typeof rawValue === "object"
      ? (rawValue as Json).name ?? (rawValue as Json).label ?? (rawValue as Json).value ?? (rawValue as Json).id ?? null
      : rawValue;
    if (mapping.semantic_field === "estimated_effort_minutes") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) patch.estimated_effort_minutes = numeric;
    } else {
      patch[mapping.semantic_field] = value == null ? null : String(value);
    }
    if (mapping.semantic_field === "blocked_reason") patch.blocked = typeof value === "string" && !!value.trim();
  }
  if (Object.keys(patch).length) {
    const { error } = await db().from("work_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", taskId);
    if (error) throw new Error(`mirror mapped Nifty task fields: ${error.message}`);
  }
}

export async function upsertNiftyTask(userId: string, task: NiftyTaskSummary) {
  const supabase = db();
  const previous = await ensureNoError(
    supabase.from("work_tasks").select("id,completed").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.id).maybeSingle(),
    "load previous Nifty task state",
  );
  let projectId: string | null = null;
  if (task.projectId) {
    const project = await ensureNoError(
      supabase.from("work_projects").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_project_id", task.projectId).maybeSingle(),
      "load task project",
    );
    projectId = project?.id ?? null;
  }

  const assigneePersonIds = await mapAssigneePeople(supabase, userId, task.assignees);
  const saved = await selectFirst(
    supabase.from("work_tasks").upsert({
      user_id: userId,
      provider: "nifty",
      provider_task_id: task.id,
      provider_project_id: task.projectId ?? null,
      project_id: projectId,
      title: task.name,
      description: task.description ?? null,
      task_group_id: task.taskGroupId ?? null,
      milestone_id: task.milestoneId ?? null,
      priority: task.priority ?? null,
      labels: task.labels,
      story_points: task.storyPoints,
      dependency_provider_ids: task.dependencyIds,
      parent_provider_task_id: task.parentTaskId ?? null,
      expected_outcome: section(task.description, "Expected outcome"),
      definition_of_done: section(task.description, "Definition of done"),
      status: task.status ?? (task.completed ? "completed" : "open"),
      completed: task.completed === true,
      assignee_provider_ids: task.assignees,
      assignee_person_ids: assigneePersonIds,
      due_date: dateOnly(task.dueDate),
      start_date: dateOnly(task.startDate),
      ...(task.completedAt ? { completed_at: task.completedAt } : {}),
      provider_created_at: task.createdAt,
      provider_updated_at: task.updatedAt,
      raw: task.raw,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,provider_task_id" }).select("*"),
    "upsert Nifty task",
  );
  await mirrorMappedTaskFields(userId, (saved as Json).id as string, task.raw);
  await mirrorNiftyTaskDayEvents(supabase, saved as Json, task, assigneePersonIds, previous?.completed === true);
  if (task.parentTaskId) {
    const parent = await ensureNoError(
      supabase.from("work_tasks").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.parentTaskId).maybeSingle(),
      "load Nifty parent task",
    );
    if (parent) await ensureNoError(
      supabase.from("work_tasks").update({ parent_task_id: parent.id, updated_at: new Date().toISOString() }).eq("id", (saved as Json).id as string).select("id"),
      "mirror Nifty parent task",
    );
  }
  return saved;
}

export function canonicalNiftyEventTimestamp(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Nifty event timestamp must be a valid instant");
  return instant.toISOString();
}

export function niftyTaskEventIdempotencyKey(eventType: "created" | "completed" | "reopened", providerTaskId: string, timestamp: string) {
  return `nifty:${eventType}:${providerTaskId}:${canonicalNiftyEventTimestamp(timestamp)}`;
}

async function mirrorNiftyTaskDayEvents(supabase: Db, saved: Json, task: NiftyTaskSummary, assigneePersonIds: string[], wasCompleted: boolean) {
  const organizationId = typeof saved.organization_id === "string" ? saved.organization_id : null;
  if (!organizationId) return;
  let personId = assigneePersonIds[0] ?? null;
  if (!personId) {
    const raw = task.raw as Record<string, unknown>;
    const identities = [niftyIdentity(raw.created_by), niftyIdentity(raw.creator), ...(Array.isArray(raw.subscribers) ? raw.subscribers.map(niftyIdentity) : [])].filter((value): value is string => !!value);
    if (identities.length) {
      const people = await ensureNoError(supabase.from("work_people").select("id").eq("organization_id", organizationId).in("nifty_member_id", [...new Set(identities)]).limit(1), "resolve Nifty task event person");
      personId = people?.[0]?.id ?? null;
    }
  }
  if (!personId) {
    const existingEvent = await ensureNoError(supabase.from("work_task_day_events").select("person_id").eq("organization_id", organizationId).eq("task_id", saved.id).order("observed_at", { ascending: true }).limit(1).maybeSingle(), "resolve existing Nifty task event person");
    personId = existingEvent?.person_id ?? null;
  }
  if (!personId) return;
  const onboarding = await ensureNoError(supabase.from("work_employee_onboarding").select("timezone").eq("organization_id", organizationId).eq("person_id", personId).maybeSingle(), "load Nifty task event timezone");
  const timezone = onboarding?.timezone || "UTC";
  const snapshot = { title: task.name, completed: task.completed, status: task.status, dueDate: dateOnly(task.dueDate) };
  const events: Json[] = [];
  if (task.createdAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.createdAt), timezone), event_type: "creation_observed", provenance: "provider_observed", exact_at: task.createdAt, observed_at: task.createdAt, task_snapshot: snapshot, metadata: { sourceField: "provider_created_at" }, idempotency_key: niftyTaskEventIdempotencyKey("created", task.id, task.createdAt) });
  if (task.completed && task.completedAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.completedAt), timezone), event_type: "completed", provenance: "nifty_exact", exact_at: task.completedAt, observed_at: task.completedAt, task_snapshot: { ...snapshot, completed: true }, metadata: { sourceField: "raw.completed_on" }, idempotency_key: niftyTaskEventIdempotencyKey("completed", task.id, task.completedAt) });
  if (wasCompleted && !task.completed && task.updatedAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.updatedAt), timezone), event_type: "reopened", provenance: "provider_observed", exact_at: null, observed_at: task.updatedAt, task_snapshot: { ...snapshot, completed: false }, metadata: { sourceField: "provider_updated_at" }, idempotency_key: niftyTaskEventIdempotencyKey("reopened", task.id, task.updatedAt) });
  if (!events.length) return;
  const { error } = await supabase.from("work_task_day_events").upsert(events, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(`mirror Nifty task day events: ${error.message}`);
}

export async function syncNifty(userId: string) {
  await ensureWorkOsDefaults(userId);
  const pageSize = 100;
  const projects = [] as Awaited<ReturnType<typeof listNiftyProjects>>["projects"];
  const tasks = [] as Awaited<ReturnType<typeof listNiftyTasks>>["tasks"];
  const seenProjects = new Set<string>();
  const seenTasks = new Set<string>();
  const { members } = await niftyForOwner(userId, () => listNiftyMembers());
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyProjects({ limit: String(pageSize), offset: String(offset), archived: "false" }));
    const fresh = page.projects.filter((project) => !seenProjects.has(project.id));
    fresh.forEach((project) => seenProjects.add(project.id));
    projects.push(...fresh);
    if (page.projects.length < pageSize || !fresh.length) break;
  }

  for (const project of projects) await upsertNiftyProject(userId, project);
  for (const member of members) await upsertNiftyMember(userId, member);

  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyTasks({ limit: String(pageSize), offset: String(offset), include_subtasks: "true", include_archived: "false" }));
    const fresh = page.tasks.filter((task) => !seenTasks.has(task.id));
    fresh.forEach((task) => seenTasks.add(task.id));
    tasks.push(...fresh);
    if (page.hasMore === false || (page.hasMore !== true && page.tasks.length < pageSize) || !fresh.length) break;
  }
  for (const task of tasks) await upsertNiftyTask(userId, task);
  // Tasks tombstoned outside the plan flow (e.g. archived directly in Nifty)
  // leave their plan items pointing at dead rows; heal them on every sync.
  await sweepTombstonedPlanItems(userId);
  for (const task of tasks.filter((item) => item.parentTaskId)) {
    const parent = await db().from("work_tasks").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.parentTaskId as string).maybeSingle();
    if (parent.error) throw new Error(`map Nifty parent task: ${parent.error.message}`);
    if (parent.data) {
      const { error } = await db().from("work_tasks").update({ parent_task_id: parent.data.id, parent_provider_task_id: task.parentTaskId, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider_task_id", task.id);
      if (error) throw new Error(`mirror Nifty parent relationship: ${error.message}`);
    }
  }
  for (const task of tasks.filter((item) => item.dependencyIds.length)) {
    const { data: dependencies, error: dependencyError } = await db().from("work_tasks").select("id")
      .eq("user_id", userId).eq("provider", "nifty").in("provider_task_id", task.dependencyIds);
    if (dependencyError) throw new Error(`map Nifty task dependencies: ${dependencyError.message}`);
    const { error: taskError } = await db().from("work_tasks").update({
      dependency_task_ids: (dependencies ?? []).map((dependency: any) => dependency.id),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.id);
    if (taskError) throw new Error(`mirror Nifty task dependencies: ${taskError.message}`);
  }

  const syncedAt = new Date().toISOString();
  const { error: syncStateError } = await db().from("work_organizations").update({ nifty_synced_at: syncedAt, nifty_sync_error: null, updated_at: syncedAt })
    .eq("legacy_owner_id", userId);
  if (syncStateError) throw new Error(`record Nifty sync state: ${syncStateError.message}`);
  return { projects: projects.length, members: members.length, tasks: tasks.length, syncedAt };
}
