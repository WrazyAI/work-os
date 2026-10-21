import { randomUUID } from "node:crypto";
import {
  archiveTask,
  assertTopLevelTaskParent,
  compareTaskRecency,
  completeTask,
  deleteTask,
  getTaskByLocalOrProviderId,
  hydrateTaskAssignees,
  isTaskAttributableToPerson,
  listEvidence,
  listPersonTasks,
  moveTaskToParent,
  syncNiftyTask,
  updateTask,
} from "@/lib/work-os";
import { getStorageBackend } from "@/lib/db/storage";
import { createLocalWorkOsTask, defaultWorkOsTaskProjectId } from "@/lib/work-os-local-tasks";
import { syncPlanItemCompletion } from "@/lib/work-os-plan-items";
import { filterAssignableTaskPeople } from "@/lib/work-os-task-assignees";
import { isTaskOutcomeEvidence } from "@/modules/work-os/companion";
import {
  CompletionEvidenceError,
  COMPLETION_EVIDENCE_BUCKET,
  assertCompletionEvidenceBytes,
  completionEvidenceMetrics,
  completionEvidenceObjectPath,
  isEmployeeAttachedEvidence,
  taskEvidenceFromRow,
  taskRequiresCompletionEvidence,
  validateCompletionEvidenceUpload,
} from "@/modules/work-os/completion-evidence";
import { recordTaskDayEvent } from "@/lib/work-os-daily-workspace";
import { audit, dateOnly, db, loadShiftData, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { WorkOsConflictError, type WorkOsAccess } from "@/lib/work-os-api";

export async function getWorkOsTaskCreationOptions(access: WorkOsAccess) {
  const [peopleResult, adminResult] = await Promise.all([
    db().from("work_people").select("id,display_name,email").eq("organization_id", access.organizationId).eq("active", true).order("display_name"),
    db().from("work_org_members").select("person_id").eq("organization_id", access.organizationId).eq("role", "admin").eq("active", true).not("person_id", "is", null),
  ]);
  if (peopleResult.error) throw new Error(`load assignable task people: ${peopleResult.error.message}`);
  if (adminResult.error) throw new Error(`load task administrators: ${adminResult.error.message}`);
  const adminPersonIds = new Set((adminResult.data ?? []).map((item: any) => String(item.person_id)));
  const people = (peopleResult.data ?? []).map((person: Record<string, unknown>) => ({ ...person, id: String(person.id) }));
  const assignable = access.role === "admin" ? people : filterAssignableTaskPeople(people, adminPersonIds, access.personId);
  return {
    people: (assignable as Array<Record<string, unknown> & { id: string }>).map((person) => ({
      id: person.id as string,
      displayName: (person.display_name as string | null)?.trim() || "Organization member",
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
  let parent: Record<string, any> | null = null;
  const parentId = task.parent_task_id ?? task.parent_provider_task_id;
  if (parentId) {
    try {
      parent = await getTaskByLocalOrProviderId(ownerId, String(parentId));
    } catch {
      // A dangling or inaccessible parent cannot grant child access.
      parent = null;
    }
  }
  if (!isEmployeeTaskAccessible(task, parent, access.personId as string | null, person.nifty_member_id as string | null)) throw new Error("Task is not available to this employee");
  return { ownerId, task, niftyMemberId: person.nifty_member_id as string | null };
}

/**
 * A child task inherits employee access from its active parent. Local inline
 * subtasks are intentionally created unassigned, so checking only the child
 * assignee makes their edit/archive/delete controls unusable after creation.
 */
export function isEmployeeTaskAccessible(task: Record<string, any>, parent: Record<string, any> | null, personId: string | null | undefined, niftyMemberId: string | null | undefined) {
  if (isTaskAttributableToPerson(task, personId, niftyMemberId)) return true;
  if (!parent || parent.status === "archived" || parent.status === "deleted") return false;
  return isTaskAttributableToPerson(parent, personId, niftyMemberId);
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
  const providerTaskId = String(task.provider_task_id ?? task.id);
  const syncedAtMs = task.synced_at ? Date.parse(String(task.synced_at)) : 0;
  let currentTask = task;
  let refreshed = false;
  // The mirror is authoritative enough within the freshness window. Outside
  // it, refresh from Nifty quickly and fall back to the mirror on timeout —
  // opening a task must never hang on a provider round-trip. Work OS-native
  // tasks have no provider record, so they are never refreshed.
  if (task.provider !== "local" && (!syncedAtMs || Date.now() - syncedAtMs > TASK_DETAIL_MIRROR_FRESH_MS)) {
    try {
      await withTimeout(syncNiftyTask(ownerId, providerTaskId), TASK_DETAIL_PROVIDER_REFRESH_MS, "Nifty task refresh");
      currentTask = await getTaskByLocalOrProviderId(ownerId, taskId);
      refreshed = true;
    } catch (error) {
      console.warn("[work-os] task detail provider refresh skipped", { taskId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // The refresh can reassign the task to another employee. Re-authorize the
  // refreshed row through the same gate as the original lookup instead of
  // trusting the stale pre-refresh mirror. This stays outside the try so a
  // rejection is never mistaken for a provider timeout and swallowed.
  if (refreshed) currentTask = (await employeeTaskContext(access, taskId)).task;
  let subtasksQuery = db().from("work_tasks")
    .select("*, project:work_projects(id,name,provider_project_id)")
    .eq("organization_id", access.organizationId)
    .not("status", "in", "(archived,deleted)")
    .order("completed", { ascending: true })
    .order("provider_created_at", { ascending: true });
  subtasksQuery = task.provider === "local"
    ? subtasksQuery.eq("parent_task_id", task.id as string)
    : subtasksQuery.eq("parent_provider_task_id", providerTaskId);
  const [subtasksResult, evidenceResult] = await Promise.all([
    subtasksQuery,
    db().from("work_evidence")
      .select("id,title,summary,source,metrics,created_at")
      .eq("organization_id", access.organizationId)
      .eq("task_id", String(currentTask.id))
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const { data: subtasks, error } = subtasksResult;
  if (error) throw new Error(`load task subtasks: ${error.message}`);
  if (evidenceResult.error) throw new Error(`load task completion evidence: ${evidenceResult.error.message}`);
  const completionEvidence = ((evidenceResult.data ?? []) as Json[])
    .filter(isEmployeeAttachedEvidence)
    .map(taskEvidenceFromRow);
  // Move targets are a bounded same-project parent set; attribution is filtered
  // in JS exactly like listPersonTasks did, without its per-task embed fan-out.
  let moveQuery = db().from("work_tasks")
    .select("id,provider_task_id,title,assignee_person_ids,raw,provider,project_id,provider_project_id,parent_task_id,parent_provider_task_id")
    .eq("organization_id", access.organizationId)
    .eq("completed", false)
    .not("status", "in", "(archived,deleted)")
    .order("provider_created_at", { ascending: false })
    .limit(200);
  if (currentTask.provider === "local") {
    moveQuery = (currentTask.project_id
      ? moveQuery.eq("project_id", currentTask.project_id as string)
      : moveQuery.is("project_id", null)).is("parent_task_id", null);
  } else {
    moveQuery = moveQuery.eq("provider_project_id", (currentTask.provider_project_id as string) ?? "").is("parent_provider_task_id", null);
  }
  const { data: moveRows, error: moveError } = await moveQuery;
  if (moveError) throw new Error(`load task move targets: ${moveError.message}`);
  const moveTargets = (moveRows ?? []).filter((candidate: Record<string, unknown>) => {
    if (String(candidate.provider_task_id ?? candidate.id) === providerTaskId) return false;
    return isTaskAttributableToPerson(candidate, access.personId as string, niftyMemberId);
  }).slice(0, 50).map((candidate: Record<string, unknown>) => ({
    id: candidate.id,
    provider_task_id: candidate.provider_task_id,
    title: candidate.title,
  }));
  const hydrated = await hydrateTaskAssignees(ownerId, [currentTask, ...(subtasks ?? [])] as Json[]);
  return { task: hydrated[0], subtasks: hydrated.slice(1), moveTargets, completionEvidence };
}

export async function moveWorkOsEmployeeSubtask(access: WorkOsAccess, taskId: string, body: Json) {
  const targetId = text(body.parent_task_id);
  if (!targetId) throw new Error("parent_task_id is required");
  const [{ ownerId, task }, { task: parent }] = await Promise.all([
    employeeTaskContext(access, taskId),
    employeeTaskContext(access, targetId),
  ]);
  if (!task.parent_task_id && !task.parent_provider_task_id) throw new Error("Only subtasks can be moved");
  const moved = await moveTaskToParent(ownerId, String(task.provider_task_id ?? task.id), String(parent.provider_task_id ?? parent.id));
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.subtask_moved", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    fromParentTaskId: task.parent_task_id,
    fromParentProviderTaskId: task.parent_provider_task_id,
    toParentTaskId: parent.id,
    toParentProviderTaskId: parent.provider_task_id,
  });
  return { task: moved, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

export async function updateWorkOsEmployeeTask(access: WorkOsAccess, taskId: string, body: Json) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const name = text(body.name);
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  if (!name) throw new Error("Task title is required");
  if (name.length > 240) throw new Error("Task title must be 240 characters or fewer");
  if (description && description.length > 20_000) throw new Error("Task description must be 20000 characters or fewer");
  const assigneePersonIds = Array.isArray(body.assignee_person_ids)
    ? [...new Set(body.assignee_person_ids.filter((value): value is string => typeof value === "string" && !!value.trim()))]
    : undefined;
  if (assigneePersonIds) {
    const options = await getWorkOsTaskCreationOptions(access);
    const allowed = new Set(options.people.map((person) => person.id));
    if (assigneePersonIds.some((personId) => !allowed.has(personId))) throw new Error("Assignees must be active Work OS organization members");
  }
  const updated = await updateTask(ownerId, String(task.provider_task_id ?? task.id), {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(assigneePersonIds ? { assignee_person_ids: assigneePersonIds } : {}),
  });
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.updated", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    fields: ["name", ...(description === undefined ? [] : ["description"]), ...(assigneePersonIds ? ["assignee_person_ids"] : [])],
  });
  return { task: updated, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

export async function setWorkOsEmployeeTaskCompletion(access: WorkOsAccess, taskId: string, completed: boolean) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  if (completed && taskRequiresCompletionEvidence(task) && !(await completionEvidence(String(task.id), access.organizationId, ownerId))) {
    throw new WorkOsConflictError(
      "This task records an expected outcome. Attach completion evidence in the Windows Companion before marking it complete.",
      "evidence_required",
    );
  }
  const updated = await completeTask(ownerId, String(task.provider_task_id ?? task.id), completed);
  const exactAt = (completed ? text((updated as Json).completed_at) : text((updated as Json).provider_updated_at)) ?? new Date().toISOString();
  await recordTaskDayEvent(access, updated as Json, completed ? "completed" : "reopened", {
    idempotencyKey: `${task.provider === "local" ? "local" : "nifty"}:${completed ? "completed" : "reopened"}:${String(task.provider_task_id ?? task.id)}:${exactAt}`,
    exactAt,
    provenance: "employee_explicit",
  });
  // The task record is authoritative for the plan's commitment state.
  await syncPlanItemCompletion({
    organizationId: access.organizationId,
    taskId: String(task.id),
    completed,
    completedAt: completed ? text((updated as Json).completed_at) : null,
    personId: access.personId,
  });
  const local = String(task.provider ?? "") === "local";
  await audit(access, completed ? "task.completed" : "task.reopened", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    source: "employee_explicit",
  });
  return { task: updated, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

/**
 * Returns provider-backed task rows for a read-only assistant selection card.
 *
 * Both views answer with open work only, so a long completed history can never
 * crowd the card's window, and pending lists the newest activity first (Nifty
 * activity, then creation); overdue keeps oldest-due-first (design §27.3).
 */
export async function listWorkOsEmployeeTaskSelection(access: WorkOsAccess, view: "pending" | "overdue", requestedLimit?: unknown) {
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(requestedLimit) || 20)));
  const personId = access.personId as string;
  const [{ timezone }, ownerId] = await Promise.all([
    loadShiftData(access, personId, new Date()),
    organizationOwnerId(access.organizationId),
  ]);
  const currentDate = localDateForTimezone(new Date(), timezone);
  const tasks = await listPersonTasks(ownerId, personId, { completed: "false", includeLedgerHistory: true, limit: 500, order: "recency" }) as Json[];
  const pending = tasks.filter((task) => task.completed !== true && !["archived", "deleted"].includes(String(task.status ?? "")));
  const selected = (view === "overdue"
    ? pending.filter((task) => {
      const due = dateOnly(task.due_date);
      return !!due && due < currentDate;
    })
    : pending)
    .sort((left, right) => view === "overdue"
      ? String(dateOnly(left.due_date)).localeCompare(String(dateOnly(right.due_date)))
      : compareTaskRecency(left, right))
    .slice(0, limit);
  // Attach child progress for the same page so a parent row can show `2/5` and
  // offer its subtasks without a per-row round trip (design §25.7).
  const parentProviderIds = selected
    .filter((task) => !task.parent_task_id && !task.parent_provider_task_id && task.provider_task_id)
    .map((task) => String(task.provider_task_id));
  const parentLocalIds = selected
    .filter((task) => !task.parent_task_id && !task.parent_provider_task_id && task.provider === "local")
    .map((task) => String(task.id));
  const [providerChildren, localChildren] = await Promise.all([
    parentProviderIds.length
      ? db().from("work_tasks").select("parent_provider_task_id,completed")
        .eq("organization_id", access.organizationId)
        .not("status", "in", "(archived,deleted)")
        .in("parent_provider_task_id", parentProviderIds)
      : Promise.resolve({ data: [], error: null }),
    parentLocalIds.length
      ? db().from("work_tasks").select("parent_task_id,completed")
        .eq("organization_id", access.organizationId)
        .not("status", "in", "(archived,deleted)")
        .in("parent_task_id", parentLocalIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (providerChildren.error) throw new Error(`load task subtask progress: ${providerChildren.error.message}`);
  if (localChildren.error) throw new Error(`load local task subtask progress: ${localChildren.error.message}`);
  const progress = new Map<string, { total: number; completed: number }>();
  for (const child of [...(providerChildren.data ?? []), ...(localChildren.data ?? [])]) {
    const parentId = String(child.parent_provider_task_id ?? child.parent_task_id);
    const current = progress.get(parentId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (child.completed === true) current.completed += 1;
    progress.set(parentId, current);
  }
  const withProgress = selected.map((task) => {
    const counts = progress.get(String(task.provider_task_id)) ?? progress.get(String(task.id)) ?? { total: 0, completed: 0 };
    return { ...task, subtask_total: counts.total, subtask_completed: counts.completed };
  });
  return { view, currentDate, tasks: withProgress };
}

export async function archiveWorkOsEmployeeTask(access: WorkOsAccess, taskId: string) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  let childrenQuery = db().from("work_tasks").select("provider_task_id,id")
    .eq("organization_id", access.organizationId)
    .not("status", "in", "(archived,deleted)");
  childrenQuery = task.provider === "local"
    ? childrenQuery.eq("parent_task_id", task.id as string)
    : childrenQuery.eq("parent_provider_task_id", task.provider_task_id as string);
  const { data: children, error } = await childrenQuery;
  if (error) throw new Error(`load task children for removal: ${error.message}`);
  for (const child of children ?? []) await archiveTask(ownerId, String(child.provider_task_id ?? child.id));
  const archived = await archiveTask(ownerId, String(task.provider_task_id ?? task.id));
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.archived", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), { archivedSubtasks: children?.length ?? 0 });
  return { task: archived, archivedSubtasks: children?.length ?? 0, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

export async function deleteWorkOsEmployeeTask(access: WorkOsAccess, taskId: string) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  let childrenQuery = db().from("work_tasks").select("provider_task_id,id")
    .eq("organization_id", access.organizationId)
    .not("status", "in", "(archived,deleted)");
  childrenQuery = task.provider === "local"
    ? childrenQuery.eq("parent_task_id", task.id as string)
    : childrenQuery.eq("parent_provider_task_id", task.provider_task_id as string);
  const { data: children, error } = await childrenQuery;
  if (error) throw new Error(`load task children for permanent deletion: ${error.message}`);
  for (const child of children ?? []) await deleteTask(ownerId, String(child.provider_task_id ?? child.id));
  const deleted = await deleteTask(ownerId, String(task.provider_task_id ?? task.id));
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.deleted", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), { deletedSubtasks: children?.length ?? 0 });
  return { task: deleted, deletedSubtasks: children?.length ?? 0, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
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
  // New work belongs to TASKS; a subtask inherits its parent's project instead.
  const requestedProjectId = text(body.project_id);
  const parentId = text(body.parent_task_id);
  let parent: Json | null = null;
  if (parentId) {
    parent = (await employeeTaskContext(access, parentId)).task;
    assertTopLevelTaskParent(parent);
  }
  if (invalidPersonId) throw new Error("Assignees must be active Work OS organization members");
  const task = await createLocalWorkOsTask(access, {
    title,
    description,
    assigneePersonIds: requestedPersonIds,
    dueDate: text(body.due_date),
    startDate: text(body.start_date),
    priority: text(body.priority),
    labels: Array.isArray(body.labels) ? body.labels.filter((value): value is string => typeof value === "string") : [],
    storyPoints: typeof body.story_points === "number" ? body.story_points : null,
    expectedOutcome: text(body.expected_outcome),
    definitionOfDone: text(body.definition_of_done),
    taskGroupId: text(body.task_group_id),
    projectId: requestedProjectId ?? (parent ? null : await defaultWorkOsTaskProjectId(access.organizationId)),
    providerProjectId: text(parent?.provider_project_id),
    parent,
    raw: text(body.local_proposal_id) ? { proposalId: text(body.local_proposal_id), source: "work_os_proposal" } : undefined,
  });
  const taskRecord = task as Json;
  await audit(access, parent ? "task.subtask_created" : "task.created", "work_os_task", String((task as Json).provider_task_id ?? (task as Json).id ?? "unknown"), {
    parentTaskId: text(parent?.id),
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

export type CompletionEvidenceUpload = {
  fileName?: string | null;
  contentType?: string | null;
  bytes: Uint8Array;
  note?: string | null;
  idempotencyKey?: string | null;
};

/**
 * Persists one employee-attached completion artifact and its `work_evidence`
 * row before any completion is confirmed. The storage object is removed if the
 * row cannot be written, so an upload can never leave a file the ledger does
 * not know about. A completion failure keeps the evidence: it is truthful on
 * its own, and the client can retry only the completion.
 */
export async function attachWorkOsTaskCompletionEvidence(access: WorkOsAccess, taskId: string, input: CompletionEvidenceUpload) {
  if (!access.personId) throw new CompletionEvidenceError("Work OS person mapping required");
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const validated = validateCompletionEvidenceUpload({
    contentType: input.contentType,
    fileName: input.fileName,
    size: input.bytes.byteLength,
    note: input.note,
  });
  assertCompletionEvidenceBytes(input.bytes, validated.contentType);
  const idempotencyKey = text(input.idempotencyKey);
  if (!idempotencyKey) throw new CompletionEvidenceError("Idempotency-Key is required");
  if (idempotencyKey.length > 160) throw new CompletionEvidenceError("Idempotency-Key must be 160 characters or fewer");

  if (idempotencyKey) {
    const existing = await db().from("work_evidence").select("*")
      .eq("organization_id", access.organizationId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) throw new Error(`load idempotent completion evidence: ${existing.error.message}`);
    if (existing.data) {
      if (String(existing.data.task_id ?? "") !== String(task.id) || String(existing.data.person_id ?? "") !== String(access.personId)) {
        throw new WorkOsConflictError("That evidence reference belongs to another task", "evidence_conflict");
      }
      if (!isEmployeeAttachedEvidence(existing.data as Json)) {
        throw new WorkOsConflictError("That evidence reference is not employee-attached completion evidence", "evidence_conflict");
      }
      return { evidence: taskEvidenceFromRow(existing.data as Json), task };
    }
  }

  const evidenceId = randomUUID();
  const objectPath = completionEvidenceObjectPath({
    organizationId: access.organizationId,
    personId: access.personId,
    taskId: String(task.id),
    evidenceId,
    contentType: validated.contentType,
  });
  const now = new Date();
  const { timezone } = await loadShiftData(access, access.personId, now);
  const uploaded = await getStorageBackend().upload(COMPLETION_EVIDENCE_BUCKET, objectPath, Buffer.from(input.bytes), {
    contentType: validated.contentType,
  });
  if (uploaded.error) throw new Error(`save completion evidence: ${uploaded.error.message}`);

  const taskTitle = text(task.title) ?? "Task";
  const row = {
    id: evidenceId,
    user_id: ownerId,
    organization_id: access.organizationId,
    person_id: access.personId,
    task_id: String(task.id),
    evidence_date: localDateForTimezone(now, timezone),
    source: "manual",
    title: `${taskTitle.slice(0, 220)} — completion evidence`,
    summary: validated.note || `Employee-attached file: ${validated.fileName}.`,
    url: `/api/work-os/evidence/${evidenceId}/file`,
    metrics: completionEvidenceMetrics({
      contentType: validated.contentType,
      fileName: validated.fileName,
      sizeBytes: validated.size,
      note: validated.note,
    }),
    raw: { origin: "task_completion" },
    idempotency_key: idempotencyKey,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const inserted = await db().from("work_evidence").insert(row).select("*").single();
  if (inserted.error) {
    try {
      const removed = await getStorageBackend().remove(COMPLETION_EVIDENCE_BUCKET, [objectPath]);
      if (removed.error) console.warn("[work-os] completion evidence rollback failed", { evidenceId, message: removed.error.message });
    } catch (rollbackError) {
      console.warn("[work-os] completion evidence rollback failed", { evidenceId, message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
    }
    if (idempotencyKey) {
      const existing = await db().from("work_evidence").select("*")
        .eq("organization_id", access.organizationId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing.data && isEmployeeAttachedEvidence(existing.data as Json)) {
        return { evidence: taskEvidenceFromRow(existing.data as Json), task };
      }
    }
    throw new Error(`save completion evidence record: ${inserted.error.message}`);
  }

  await audit(access, "task.evidence_attached", "work_evidence", evidenceId, {
    taskId: String(task.id),
    fileName: validated.fileName,
    contentType: validated.contentType,
    sizeBytes: validated.size,
  });
  return { evidence: taskEvidenceFromRow(inserted.data as Json), task };
}

export async function completeWorkOsTask(access: WorkOsAccess, taskId: string, completed = true) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (completed && taskRequiresCompletionEvidence(task) && !(await completionEvidence(task.id as string, access.organizationId, ownerId))) {
    throw new WorkOsConflictError(
      "This task records an expected outcome. Attach completion evidence in the Windows Companion before marking it complete.",
      "evidence_required",
    );
  }
  const updated = await completeTask(ownerId, taskId, completed);
  // An admin completing a task still completes the plan items that committed
  // to it, across whoever planned it.
  await syncPlanItemCompletion({
    organizationId: access.organizationId,
    taskId: String(task.id),
    completed,
    completedAt: completed ? text((updated as Json).completed_at) : null,
  });
  return updated;
}
