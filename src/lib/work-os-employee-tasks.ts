import {
  archiveTask,
  completeTask,
  createTask,
  deleteTask,
  getTaskByLocalOrProviderId,
  hydrateTaskAssignees,
  isNiftyTaskAttributableToMember,
  listEvidence,
  listPersonTasks,
  moveTaskToParent,
  niftyTaskEventIdempotencyKey,
  syncNiftyTask,
  updateTask,
} from "@/lib/work-os";
import { filterAssignableTaskPeople } from "@/lib/work-os-task-assignees";
import { isTaskOutcomeEvidence } from "@/modules/work-os/companion";
import { recordTaskDayEvent } from "@/lib/work-os-daily-workspace";
import { audit, dateOnly, db, loadShiftData, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";
import type { WorkOsAccess } from "@/lib/work-os-api";

const DEFAULT_NIFTY_TASK_PROJECT_ID = "czFZk9928z";
const DEFAULT_NIFTY_TASK_GROUP_ID = "PDp!eGkwR5";

export async function getWorkOsTaskCreationOptions(access: WorkOsAccess) {
  const [peopleResult, adminResult] = await Promise.all([
    db().from("work_people").select("id,display_name,email,nifty_member_id").eq("organization_id", access.organizationId).eq("active", true).not("nifty_member_id", "is", null).order("display_name"),
    db().from("work_org_members").select("person_id").eq("organization_id", access.organizationId).eq("role", "admin").eq("active", true).not("person_id", "is", null),
  ]);
  if (peopleResult.error) throw new Error(`load assignable task people: ${peopleResult.error.message}`);
  if (adminResult.error) throw new Error(`load task administrators: ${adminResult.error.message}`);
  const adminPersonIds = new Set((adminResult.data ?? []).map((item: any) => String(item.person_id)));
  return {
    people: (filterAssignableTaskPeople(
      (peopleResult.data ?? []).map((person: Record<string, unknown>) => ({ ...person, id: String(person.id) })),
      adminPersonIds,
      access.personId,
    ) as Array<Record<string, unknown> & { id: string }>).map((person) => ({
      id: person.id as string,
      displayName: person.display_name as string,
      email: person.email as string | null,
    })),
  };
}

async function employeeTaskContext(access: WorkOsAccess, taskId: string) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (task.status === "archived" || task.status === "deleted") throw new Error("Task not found");
  const { data: person, error } = await db().from("work_people").select("nifty_member_id").eq("organization_id", access.organizationId).eq("id", access.personId as string).single();
  if (error) throw new Error(`load task employee mapping: ${error.message}`);
  const assignedToPerson = Array.isArray(task.assignee_person_ids) && task.assignee_person_ids.includes(access.personId as string);
  if (!assignedToPerson && !isNiftyTaskAttributableToMember(task, person.nifty_member_id as string | null)) throw new Error("Task is not available to this employee");
  return { ownerId, task, niftyMemberId: person.nifty_member_id as string | null };
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

const TASK_DETAIL_PROVIDER_REFRESH_MS = 5_000;
const TASK_DETAIL_MIRROR_FRESH_MS = 2 * 60_000;

export async function getWorkOsEmployeeTaskDetails(access: WorkOsAccess, taskId: string) {
  const { ownerId, task, niftyMemberId } = await employeeTaskContext(access, taskId);
  const providerTaskId = task.provider_task_id as string;
  const syncedAtMs = task.synced_at ? Date.parse(String(task.synced_at)) : 0;
  let currentTask = task;
  // The mirror is authoritative enough within the freshness window. Outside
  // it, refresh from Nifty quickly and fall back to the mirror on timeout —
  // opening a task must never hang on a provider round-trip.
  if (!syncedAtMs || Date.now() - syncedAtMs > TASK_DETAIL_MIRROR_FRESH_MS) {
    try {
      await withTimeout(syncNiftyTask(ownerId, providerTaskId), TASK_DETAIL_PROVIDER_REFRESH_MS, "Nifty task refresh");
      currentTask = await getTaskByLocalOrProviderId(ownerId, taskId);
    } catch (error) {
      console.warn("[work-os] task detail provider refresh skipped", { taskId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  const { data: subtasks, error } = await db().from("work_tasks")
    .select("*, project:work_projects(id,name,provider_project_id)")
    .eq("organization_id", access.organizationId)
    .eq("parent_provider_task_id", providerTaskId)
    .not("status", "in", "(archived,deleted)")
    .order("completed", { ascending: true })
    .order("provider_created_at", { ascending: true });
  if (error) throw new Error(`load task subtasks: ${error.message}`);
  // Move targets are a bounded same-project parent set; attribution is filtered
  // in JS exactly like listPersonTasks did, without its per-task embed fan-out.
  const { data: moveRows, error: moveError } = await db().from("work_tasks")
    .select("id,provider_task_id,title,assignee_person_ids,raw")
    .eq("organization_id", access.organizationId)
    .eq("provider_project_id", (currentTask.provider_project_id as string) ?? "")
    .is("parent_provider_task_id", null)
    .eq("completed", false)
    .not("status", "in", "(archived,deleted)")
    .order("provider_created_at", { ascending: false })
    .limit(200);
  if (moveError) throw new Error(`load task move targets: ${moveError.message}`);
  const moveTargets = (moveRows ?? []).filter((candidate: Record<string, unknown>) => {
    if (candidate.provider_task_id === providerTaskId) return false;
    const assignedToPerson = Array.isArray(candidate.assignee_person_ids) && candidate.assignee_person_ids.includes(access.personId as string);
    return assignedToPerson || isNiftyTaskAttributableToMember(candidate, niftyMemberId);
  }).slice(0, 50).map((candidate: Record<string, unknown>) => ({
    id: candidate.id,
    provider_task_id: candidate.provider_task_id,
    title: candidate.title,
  }));
  const hydrated = await hydrateTaskAssignees(ownerId, [currentTask, ...(subtasks ?? [])] as Json[]);
  return { task: hydrated[0], subtasks: hydrated.slice(1), moveTargets };
}

export async function moveWorkOsEmployeeSubtask(access: WorkOsAccess, taskId: string, body: Json) {
  const targetId = text(body.parent_task_id);
  if (!targetId) throw new Error("parent_task_id is required");
  const [{ ownerId, task }, { task: parent }] = await Promise.all([
    employeeTaskContext(access, taskId),
    employeeTaskContext(access, targetId),
  ]);
  if (!task.parent_provider_task_id) throw new Error("Only subtasks can be moved");
  const moved = await moveTaskToParent(ownerId, task.provider_task_id as string, parent.provider_task_id as string);
  await audit(access, "task.subtask_moved", "nifty_task", task.provider_task_id as string, {
    fromParentProviderTaskId: task.parent_provider_task_id,
    toParentProviderTaskId: parent.provider_task_id,
  });
  return { task: moved, providerStatus: "nifty_confirmed" };
}

export async function updateWorkOsEmployeeTask(access: WorkOsAccess, taskId: string, body: Json) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const name = text(body.name);
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  if (!name) throw new Error("Task title is required");
  if (name.length > 240) throw new Error("Task title must be 240 characters or fewer");
  if (description && description.length > 20_000) throw new Error("Task description must be 20000 characters or fewer");
  const updated = await updateTask(ownerId, task.provider_task_id as string, { name, ...(description !== undefined ? { description } : {}) });
  await audit(access, "task.updated", "nifty_task", task.provider_task_id as string, { fields: description === undefined ? ["name"] : ["name", "description"] });
  return { task: updated, providerStatus: "nifty_confirmed" };
}

export async function setWorkOsEmployeeTaskCompletion(access: WorkOsAccess, taskId: string, completed: boolean) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const updated = await completeTask(ownerId, task.provider_task_id as string, completed);
  const exactAt = (completed ? text((updated as Json).completed_at) : text((updated as Json).provider_updated_at)) ?? new Date().toISOString();
  await recordTaskDayEvent(access, updated as Json, completed ? "completed" : "reopened", {
    idempotencyKey: niftyTaskEventIdempotencyKey(completed ? "completed" : "reopened", task.provider_task_id as string, exactAt),
    exactAt,
    provenance: "employee_explicit",
  });
  await audit(access, completed ? "task.completed" : "task.reopened", "nifty_task", task.provider_task_id as string, {
    source: "employee_explicit",
  });
  return { task: updated, providerStatus: "nifty_confirmed" };
}

/** Returns provider-backed task rows for a read-only assistant selection card. */
export async function listWorkOsEmployeeTaskSelection(access: WorkOsAccess, view: "pending" | "overdue", requestedLimit?: unknown) {
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(requestedLimit) || 20)));
  const personId = access.personId as string;
  const [{ timezone }, ownerId] = await Promise.all([
    loadShiftData(access, personId, new Date()),
    organizationOwnerId(access.organizationId),
  ]);
  const currentDate = localDateForTimezone(new Date(), timezone);
  const tasks = await listPersonTasks(ownerId, personId, { includeCompleted: true, includeLedgerHistory: true, limit: 500 }) as Json[];
  const pending = tasks.filter((task) => task.completed !== true && !["archived", "deleted"].includes(String(task.status ?? "")));
  const selected = (view === "overdue"
    ? pending.filter((task) => {
      const due = dateOnly(task.due_date);
      return !!due && due < currentDate;
    })
    : pending)
    .sort((left, right) => view === "overdue"
      ? String(dateOnly(typeof left.due_date === "string" ? left.due_date : null)).localeCompare(String(dateOnly(typeof right.due_date === "string" ? right.due_date : null)))
      : String(right.provider_updated_at ?? right.updated_at ?? right.created_at ?? "").localeCompare(String(left.provider_updated_at ?? left.updated_at ?? left.created_at ?? "")))
    .slice(0, limit);
  return { view, currentDate, tasks: selected };
}

export async function archiveWorkOsEmployeeTask(access: WorkOsAccess, taskId: string) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const { data: children, error } = await db().from("work_tasks").select("provider_task_id")
    .eq("organization_id", access.organizationId)
    .eq("parent_provider_task_id", task.provider_task_id as string)
    .not("status", "in", "(archived,deleted)");
  if (error) throw new Error(`load task children for removal: ${error.message}`);
  for (const child of children ?? []) await archiveTask(ownerId, child.provider_task_id as string);
  const archived = await archiveTask(ownerId, task.provider_task_id as string);
  await audit(access, "task.archived", "nifty_task", task.provider_task_id as string, { archivedSubtasks: children?.length ?? 0 });
  return { task: archived, archivedSubtasks: children?.length ?? 0, providerStatus: "nifty_confirmed" };
}

export async function deleteWorkOsEmployeeTask(access: WorkOsAccess, taskId: string) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const { data: children, error } = await db().from("work_tasks").select("provider_task_id")
    .eq("organization_id", access.organizationId)
    .eq("parent_provider_task_id", task.provider_task_id as string)
    .not("status", "in", "(archived,deleted)");
  if (error) throw new Error(`load task children for permanent deletion: ${error.message}`);
  for (const child of children ?? []) await deleteTask(ownerId, child.provider_task_id as string);
  const deleted = await deleteTask(ownerId, task.provider_task_id as string);
  await audit(access, "task.deleted", "nifty_task", task.provider_task_id as string, { deletedSubtasks: children?.length ?? 0 });
  return { task: deleted, deletedSubtasks: children?.length ?? 0, providerStatus: "nifty_confirmed" };
}

export async function createWorkOsEmployeeTask(access: WorkOsAccess, body: Json) {
  const title = text(body.name);
  const description = text(body.description);
  if (!title) throw new Error("Task title is required");
  if (title.length > 240) throw new Error("Task title must be 240 characters or fewer");
  if (description && description.length > 20_000) throw new Error("Task description must be 20000 characters or fewer");

  const requestedPersonIds = Array.isArray(body.assignee_person_ids)
    ? [...new Set(body.assignee_person_ids.filter((value): value is string => typeof value === "string" && !!value.trim()))]
    : [];
  const options = await getWorkOsTaskCreationOptions(access);
  const allowedPeople = new Map(options.people.map((person) => [person.id, person]));
  const invalidPersonId = requestedPersonIds.find((personId) => !allowedPeople.has(personId));
  if (invalidPersonId) throw new Error("Assignees must be active, Nifty-mapped organization members; administrators may assign only their own worker profile");
  let assignees: string[] = [];
  if (requestedPersonIds.length) {
    const { data, error } = await db().from("work_people").select("id,nifty_member_id").eq("organization_id", access.organizationId).in("id", requestedPersonIds);
    if (error) throw new Error(`resolve Nifty task assignees: ${error.message}`);
    assignees = (data ?? []).map((person: any) => String(person.nifty_member_id)).filter(Boolean);
    if (assignees.length !== requestedPersonIds.length) throw new Error("Every assignee must have a Nifty member mapping");
  }

  const ownerId = await organizationOwnerId(access.organizationId);
  const projectId = process.env.WORK_OS_NIFTY_LEDGER_PROJECT_ID?.trim() || DEFAULT_NIFTY_TASK_PROJECT_ID;
  const defaultTaskGroupId = process.env.WORK_OS_NIFTY_DEFAULT_TASK_GROUP_ID?.trim() || DEFAULT_NIFTY_TASK_GROUP_ID;
  const parentId = text(body.parent_task_id);
  let parent: Json | null = null;
  if (parentId) {
    parent = (await employeeTaskContext(access, parentId)).task;
  }
  const task = await createTask(ownerId, {
    name: title,
    description: description ?? undefined,
    project_id: text(parent?.provider_project_id) ?? projectId,
    task_group_id: text(parent?.task_group_id) ?? defaultTaskGroupId,
    task_id: text(parent?.provider_task_id) ?? undefined,
    assignees,
  });
  const taskRecord = task as Json;
  const createdAt = text(taskRecord.provider_created_at) ?? text(taskRecord.created_at) ?? new Date().toISOString();
  await recordTaskDayEvent(access, taskRecord, "creation_observed", {
    idempotencyKey: `nifty:created:${taskRecord.provider_task_id ?? taskRecord.id}:${createdAt}`,
    exactAt: createdAt,
    provenance: "provider_observed",
  });
  await audit(access, parent ? "task.subtask_created" : "task.created", "nifty_task", String((task as Json).provider_task_id ?? (task as Json).id ?? "unknown"), {
    parentProviderTaskId: text(parent?.provider_task_id),
    assigneePersonIds: requestedPersonIds,
  });
  return task;
}

async function completionEvidence(taskId: string, organizationId: string, ownerId: string) {
  const [legacyEvidence, eventResult] = await Promise.all([
    listEvidence(ownerId, { taskId }) as Promise<Json[]>,
    db().from("work_evidence_events").select("id, evidence_class, title, artifact_url")
      .eq("organization_id", organizationId).eq("task_id", taskId)
      .eq("evidence_class", "output_evidence").limit(1),
  ]);
  if (eventResult.error) throw new Error(`check completion evidence: ${eventResult.error.message}`);
  const legacyOutput = legacyEvidence.some(isTaskOutcomeEvidence);
  return legacyOutput || !!eventResult.data?.length;
}

export async function completeWorkOsTask(access: WorkOsAccess, taskId: string, completed = true) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (completed && !(await completionEvidence(task.id as string, access.organizationId, ownerId))) {
    throw new Error("sufficient outcome or artifact evidence is required before completing this task");
  }
  return completeTask(ownerId, taskId, completed);
}
