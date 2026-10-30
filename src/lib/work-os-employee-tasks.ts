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
  updateTask,
} from "@/lib/work-os";
import { getStorageBackend } from "@/lib/db/storage";
import { createLocalWorkOsTask, defaultWorkOsTaskProjectId } from "@/lib/work-os-local-tasks";
import { syncPlanItemCompletion } from "@/lib/work-os-plan-items";
import { scopedAssignableTaskPeople } from "@/lib/work-os-task-assignees";
import { isCalendarDate, isWorkflowStatus, taskCapabilities, type TaskActor } from "@/lib/work-os-task-permissions";
import { isTaskOutcomeEvidence } from "@/modules/work-os/companion";
import { effortMinutesPatch } from "@/lib/work-os-tasks";
import { validateTaskGroupId } from "@/lib/work-agent-tasks";
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
import { applyTaskCompletion, taskCompletionFailureMessage } from "@/lib/work-os-task-completion";
import { audit, dateOnly, db, loadShiftData, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { accessibleWorkOsPersonIds, WorkOsConflictError, WorkOsForbiddenError, WorkOsNotFoundError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type { AgentActor } from "@/lib/work-agent-auth";

export async function getWorkOsTaskCreationOptions(access: WorkOsAccess) {
  const [peopleResult, projectsResult] = await Promise.all([
    db().from("work_people").select("id,display_name,email").eq("organization_id", access.organizationId).eq("active", true).order("display_name"),
    // `archived` is nullable and predates the flag being written on every row,
    // so a null means "live" rather than "archived".
    db().from("work_projects").select("id,name,archived").eq("organization_id", access.organizationId).order("name"),
  ]);
  if (peopleResult.error) throw new Error(`load assignable task people: ${peopleResult.error.message}`);
  if (projectsResult.error) throw new Error(`load task projects: ${projectsResult.error.message}`);
  const people = (peopleResult.data ?? []).map((person: Record<string, unknown>) => ({ ...person, id: String(person.id) }));
  const allowed = await accessibleWorkOsPersonIds(access);
  const assignable = scopedAssignableTaskPeople(people, allowed);
  return {
    people: (assignable as Array<Record<string, unknown> & { id: string }>).map((person) => ({
      id: person.id as string,
      displayName: (person.display_name as string | null)?.trim() || "Organization member",
      email: person.email as string | null,
    })),
    // Projects are workspace structure, not a secret: every task row already
    // names its project, so an employee (and their agent token) can see the
    // organization's active projects and choose one when creating work.
    projects: (projectsResult.data ?? [])
      .filter((project: Record<string, unknown>) => project.archived !== true)
      .map((project: Record<string, unknown>) => ({
        id: String(project.id),
        name: (project.name as string | null)?.trim() || "Untitled project",
      })),
  };
}

function taskActor(access: WorkOsAccess): TaskActor {
  return { role: access.role, personId: access.personId };
}

export async function employeeTaskToday(access: WorkOsAccess, personId: string | null = access.personId): Promise<string> {
  const now = new Date();
  // Administrators without a person mapping have no shift; use its UTC default.
  const { timezone } = personId ? await loadShiftData(access, personId, now) : { timezone: "UTC" };
  return localDateForTimezone(now, timezone);
}

async function employeeTaskContext(access: WorkOsAccess, taskId: string, options: { allowArchived?: boolean } = {}) {
  const ownerId = await organizationOwnerId(access.organizationId);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (task.organization_id !== access.organizationId) throw new WorkOsNotFoundError();
  // A tombstoned task is gone for every caller. An archived one is only
  // reachable for the operation that removes it, so removing an archived task
  // does not answer "not found" to the person who can still see it in the
  // archive.
  if (task.status === "deleted") throw new WorkOsNotFoundError();
  if (task.status === "archived" && options.allowArchived !== true) throw new WorkOsNotFoundError();
  if (access.role === "admin") return { ownerId, task, niftyMemberId: null };
  if (!access.personId) throw new WorkOsNotFoundError("Task is not available to this employee");
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
  if (!isEmployeeTaskAccessible(task, parent, access.personId as string | null, person.nifty_member_id as string | null)) throw new WorkOsNotFoundError("Task is not available to this employee");
  return { ownerId, task, niftyMemberId: person.nifty_member_id as string | null };
}

/**
 * A child task inherits visibility from its active parent. Mutations still
 * require the child's own capabilities; parent access never grants an action.
 */
export function isEmployeeTaskAccessible(task: Record<string, any>, parent: Record<string, any> | null, personId: string | null | undefined, niftyMemberId: string | null | undefined) {
  if (personId && task.assigned_by_person_id === personId) return true;
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
  // The record itself is the authority: work is native, so opening a task is a
  // single database read with no provider round-trip to wait on.
  const currentTask = task;
  let subtasksQuery = db().from("work_tasks")
    .select("*, project:work_projects(id,name,provider_project_id)")
    .eq("organization_id", access.organizationId)
    .not("status", "in", "(archived,deleted)")
    .order("completed", { ascending: true })
    .order("provider_created_at", { ascending: true });
  subtasksQuery = task.provider_task_id
    ? subtasksQuery.or(`parent_task_id.eq.${task.id},parent_provider_task_id.eq.${task.provider_task_id}`)
    : subtasksQuery.eq("parent_task_id", task.id as string);
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
  moveQuery = (currentTask.project_id
    ? moveQuery.eq("project_id", currentTask.project_id as string)
    : moveQuery.is("project_id", null))
    .is("parent_task_id", null)
    .is("parent_provider_task_id", null);
  const { data: moveRows, error: moveError } = await moveQuery;
  if (moveError) throw new Error(`load task move targets: ${moveError.message}`);
  const moveTargets = (moveRows ?? []).filter((candidate: Record<string, unknown>) => {
    if (String(candidate.provider_task_id ?? candidate.id) === String(task.provider_task_id ?? task.id)) return false;
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
  if (!task.parent_task_id && !task.parent_provider_task_id) throw new WorkOsValidationError("Only subtasks can be moved");
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  if (!capabilities.canMove) throw new WorkOsForbiddenError();
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
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  if (!capabilities.canEdit) throw new WorkOsForbiddenError();
  if ("workflow_status" in body) throw new WorkOsValidationError("Change workflow_status through the status action");
  const name = "name" in body ? text(body.name) : undefined;
  const description = typeof body.description === "string" ? body.description.trim() : undefined;
  if ("name" in body && !name) throw new WorkOsValidationError("Task title is required");
  if (name && name.length > 240) throw new Error("Task title must be 240 characters or fewer");
  if (description && description.length > 20_000) throw new Error("Task description must be 20000 characters or fewer");
  let assigneePersonIds: string[] | undefined;
  if ("assignee_person_ids" in body) {
    if (!capabilities.canAssign) throw new WorkOsForbiddenError();
    const options = await getWorkOsTaskCreationOptions(access);
    assigneePersonIds = validateAgentAssignment(options.people.map((person) => person.id), body.assignee_person_ids);
  }
  const patch: Json = {
    ...(name ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  };
  for (const field of ["due_date", "start_date", "priority"] as const) {
    if (!(field in body)) continue;
    if (body[field] !== null && typeof body[field] !== "string") throw new WorkOsValidationError(`${field} must be a string or null`);
    // A malformed due date would silently disable the overdue lock, so reject
    // it before the first write. An empty string clears the date.
    if (field === "due_date" && body[field] !== null && body[field] !== "" && !isCalendarDate(body[field])) {
      throw new WorkOsValidationError("due_date must be a real calendar date (YYYY-MM-DD)");
    }
    patch[field] = text(body[field]);
  }
  const previousAssignees = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [];
  const assignmentChanged = assigneePersonIds !== undefined && (previousAssignees.length !== assigneePersonIds.length || assigneePersonIds.some((id) => !previousAssignees.includes(id)));
  if (assigneePersonIds !== undefined) patch.assignee_person_ids = assigneePersonIds;
  if (assignmentChanged) {
    patch.assigned_by_person_id = access.personId;
  }
  if (!Object.keys(patch).length) throw new WorkOsValidationError("At least one field is required");
  const updated = await updateTask(ownerId, String(task.provider_task_id ?? task.id), patch);
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.updated", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    fields: Object.keys(patch),
  });
  if (assignmentChanged) await audit(access, "task.assigned", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    assigneePersonIds,
    assignedByPersonId: access.personId,
  });
  return { task: updated, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

export async function updateWorkOsEmployeeTaskStatus(access: WorkOsAccess, taskId: string, status: unknown): Promise<{ task: Json; providerStatus: string }> {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  if (!isWorkflowStatus(status)) throw new WorkOsValidationError("workflow_status must be pending or in_progress");
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  if (task.completed === true) throw new WorkOsConflictError("Reopen the task before changing its status", "task_completed");
  if (capabilities.statusLocked) throw new WorkOsConflictError("Update the due date before changing this task's status", "due_date_passed");
  if (!capabilities.canChangeStatus) throw new WorkOsForbiddenError();
  const updated = await updateTask(ownerId, String(task.provider_task_id ?? task.id), { workflow_status: status });
  const local = String(task.provider ?? "") === "local";
  await audit(access, "task.status_changed", local ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    workflowStatus: status,
  });
  return { task: updated, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

const AGENT_TASK_UPDATE_FIELDS = new Set([
  "name",
  "description",
  "due_date",
  "start_date",
  "priority",
  "labels",
  "story_points",
  "expected_outcome",
  "definition_of_done",
  "estimated_effort_minutes",
  "effort_unit",
  "task_group_id",
  "assignee_person_ids",
  "parent_task_id",
  "blocked",
  "blocked_reason",
]);

/** The agent PATCH contract: content, assignment, board group, and subtask
 * parent. Project moves stay rejected: a subtask may not change project, so a
 * project edit needs validation the flat patch cannot carry. */
export function validateAgentTaskUpdate(body: Json): Json {
  const patch: Json = {};
  for (const key of Object.keys(body ?? {})) {
    if (!AGENT_TASK_UPDATE_FIELDS.has(key)) {
      throw new WorkOsValidationError(`Field ${key} cannot be updated through the agent API`);
    }
    patch[key] = body[key];
  }
  if (!Object.keys(patch).length) throw new WorkOsValidationError("At least one field is required");
  if ("blocked" in patch && typeof patch.blocked !== "boolean") {
    throw new WorkOsValidationError("blocked must be a boolean");
  }
  if ("labels" in patch && (!Array.isArray(patch.labels) || patch.labels.some((value) => typeof value !== "string"))) {
    throw new WorkOsValidationError("labels must be an array of strings");
  }
  if ("task_group_id" in patch) validateTaskGroupId(patch.task_group_id);
  return patch;
}

/** Agent assignment is limited to the same assignable set the employee's own
 * composer offers; anything outside it is a caller mistake, not a silent drop. */
export function validateAgentAssignment(allowed: Iterable<string>, requested: unknown): string[] {
  if (!Array.isArray(requested)) throw new WorkOsValidationError("assignee_person_ids must be an array of person ids");
  const ids = requested.filter((value): value is string => typeof value === "string" && !!value.trim());
  if (ids.length !== requested.length) throw new WorkOsValidationError("assignee_person_ids must be an array of person ids");
  const permitted = new Set(allowed);
  const unique = [...new Set(ids)];
  if (unique.some((personId) => !permitted.has(personId))) {
    throw new WorkOsValidationError("Assignees must be active Work OS organization members");
  }
  return unique;
}

export async function updateWorkOsAgentTask(access: WorkOsAccess, taskId: string, body: Json, actor: AgentActor) {
  const patch = validateAgentTaskUpdate(body);
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  // Blockers are status work, not content: an assignee who can complete or move
  // the task's status records them without holding the assigner's edit control.
  const nonContentKeys = new Set(["assignee_person_ids", "parent_task_id", "blocked", "blocked_reason"]);
  const editsFields = Object.keys(patch).some((key) => !nonContentKeys.has(key));
  if (editsFields && !capabilities.canEdit) throw new WorkOsForbiddenError();
  if (("blocked" in patch || "blocked_reason" in patch)
    && !capabilities.canEdit && !capabilities.canChangeStatus && !capabilities.canComplete) {
    throw new WorkOsForbiddenError();
  }
  if ("assignee_person_ids" in patch && !capabilities.canAssign) throw new WorkOsForbiddenError();
  if ("parent_task_id" in patch && !capabilities.canMove) throw new WorkOsForbiddenError();
  // An agent token is person-scoped: assignment is self-only, so a coworker id
  // is refused before the creation-options scope (or any write) is consulted.
  if ("assignee_person_ids" in patch && Array.isArray(patch.assignee_person_ids)
    && patch.assignee_person_ids.some((id) => typeof id === "string" && id !== access.personId)) {
    throw new WorkOsValidationError("An agent token can assign work only to its own person");
  }
  let assignmentChanged = false;
  // Every rejection happens before the first write, so a refused assignment can
  // never leave the subtask already moved under a new parent.
  if ("assignee_person_ids" in patch) {
    const options = await getWorkOsTaskCreationOptions(access);
    const assignees = validateAgentAssignment(options.people.map((person) => person.id), patch.assignee_person_ids);
    const previousAssignees = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [];
    assignmentChanged = previousAssignees.length !== assignees.length || assignees.some((id) => !previousAssignees.includes(id));
    patch.assignee_person_ids = assignees;
    if (assignmentChanged) patch.assigned_by_person_id = access.personId;
    const finalAssignees = patch.assignee_person_ids as string[];
    if (String(task.provider ?? "") !== "local" && finalAssignees.length) {
      const mapped = await db().from("work_people").select("id,nifty_member_id")
        .eq("organization_id", access.organizationId).in("id", finalAssignees);
      if (mapped.error) throw new Error(`load assignee provider mappings: ${mapped.error.message}`);
      if ((mapped.data ?? []).some((person: any) => !person.nifty_member_id)) {
        throw new WorkOsValidationError("Historical provider tasks require mapped provider assignees");
      }
    }
  }
  // Validate the content patch before the move: a rejected estimate must not
  // leave the subtask already reassigned to a new parent.
  if ("estimated_effort_minutes" in patch) patch.estimated_effort_minutes = effortMinutesPatch(patch.estimated_effort_minutes);
  const moveParentId = typeof patch.parent_task_id === "string" ? patch.parent_task_id.trim() : "";
  if ("parent_task_id" in patch && !moveParentId) throw new WorkOsValidationError("parent_task_id must be a task id");
  delete patch.parent_task_id;
  if (moveParentId) await moveWorkOsEmployeeSubtask(access, taskId, { parent_task_id: moveParentId });
  if (!Object.keys(patch).length) {
    const moved = await employeeTaskContext(access, taskId);
    return moved.task as Json;
  }
  if ("blocked" in patch) {
    if (patch.blocked === true) {
      const description = text(patch.blocked_reason) ?? "Blocked";
      const existing = await db().from("work_task_blockers").select("id")
        .eq("organization_id", access.organizationId).eq("task_id", String(task.id)).eq("status", "active").maybeSingle();
      if (existing.error) throw new Error(`load agent task blocker: ${existing.error.message}`);
      if (!existing.data) {
        const inserted = await db().from("work_task_blockers").insert({
          organization_id: access.organizationId,
          task_id: String(task.id),
          person_id: access.personId,
          description,
          created_by: access.ctx.user.id,
          agent_token_id: actor.tokenId,
        }).select("id").single();
        if (inserted.error) throw new Error(`create agent task blocker: ${inserted.error.message}`);
      }
      patch.blocked_reason = description;
    } else if (patch.blocked === false) {
      const resolved = await db().from("work_task_blockers")
        .update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("organization_id", access.organizationId).eq("task_id", String(task.id)).eq("status", "active");
      if (resolved.error) throw new Error(`resolve agent task blocker: ${resolved.error.message}`);
      patch.blocked_reason = null;
    }
  }
  const updated = await updateTask(ownerId, String(task.provider_task_id ?? task.id), patch);
  if (assignmentChanged) await audit(access, "task.assigned", String(task.provider ?? "") === "local" ? "work_os_task" : "nifty_task", String(task.provider_task_id ?? task.id), {
    assigneePersonIds: patch.assignee_person_ids,
    assignedByPersonId: access.personId,
    tokenId: actor.tokenId,
    tokenName: actor.tokenName,
  });
  await audit(access, "agent.task.updated", "work_os_task", String(task.provider_task_id ?? task.id), {
    tokenId: actor.tokenId,
    tokenName: actor.tokenName,
    fields: Object.keys(patch),
  });
  return updated;
}

/** A task row the completion rule can carry: a stable id and a name to show
 * when a subtask cannot close. */
type CompletionRow = Record<string, any> & { id: string; title: string };

const completionRow = (value: Json): CompletionRow => ({
  ...value,
  id: String(value.id ?? ""),
  title: String(value.title ?? "Untitled task"),
});

/**
 * The open subtasks beneath a task — what a completion has to close with it.
 * Completed, archived, and deleted subtasks are left alone: they are not open
 * work, and a completion never rewrites history.
 */
async function openSubtaskRows(input: { organizationId: string; task: Json }): Promise<Json[]> {
  const providerTaskId = String(input.task.provider_task_id ?? input.task.id);
  let query = db().from("work_tasks")
    .select("id,provider_task_id,title,provider,status,completed,parent_task_id,parent_provider_task_id")
    .eq("organization_id", input.organizationId)
    .eq("completed", false)
    .not("status", "in", "(archived,deleted)")
    .order("provider_created_at", { ascending: true });
  query = input.task.provider === "local"
    ? query.eq("parent_task_id", String(input.task.id))
    : query.eq("parent_provider_task_id", providerTaskId);
  const { data, error } = await query;
  if (error) throw new Error(`load task subtasks: ${error.message}`);
  return (data ?? []) as Json[];
}

export async function setWorkOsEmployeeTaskCompletion(access: WorkOsAccess, taskId: string, completed: boolean, actor?: AgentActor) {
  const { ownerId, task } = await employeeTaskContext(access, taskId);
  // Check the actor against the requested transition even on a retry: the
  // state-dependent capability flags otherwise reject an already-applied write.
  const capabilities = taskCapabilities({ ...task, completed: !completed }, taskActor(access), await employeeTaskToday(access));
  if (completed ? !capabilities.canComplete : !capabilities.canReopen) throw new WorkOsForbiddenError();
  if (completed && taskRequiresCompletionEvidence(task) && !(await completionEvidence(String(task.id), access.organizationId, ownerId))) {
    throw new WorkOsConflictError(
      "This task records an expected outcome. Attach completion evidence in the Windows Companion before marking it complete.",
      "evidence_required",
    );
  }
  // Completing a task completes the open subtasks beneath it: a finished task
  // never shows open work underneath it. The subtasks close first, so a
  // subtask that cannot close leaves the task above it open rather than
  // leaving a completed task sitting above open work. Reopening a task never
  // touches its subtasks.
  let updatedTask: Json | undefined;
  const outcome = await applyTaskCompletion({
    task: completionRow(task),
    completed,
    openChildren: async (candidate) => (await openSubtaskRows({ organizationId: access.organizationId, task: candidate })).map(completionRow),
    complete: async (candidate) => {
      const updated = await completeTask(ownerId, String(candidate.provider_task_id ?? candidate.id), true);
      const exactAt = text((updated as Json).completed_at) ?? new Date().toISOString();
      await recordTaskDayEvent(access, updated as Json, "completed", {
        idempotencyKey: `${candidate.provider === "local" ? "local" : "nifty"}:completed:${String(candidate.provider_task_id ?? candidate.id)}:${exactAt}`,
        exactAt,
        provenance: actor ? "agent" : "employee_explicit",
        ...(actor ? { metadata: { agentTokenId: actor.tokenId } } : {}),
      });
      // The task record is authoritative for the plan's commitment state.
      await syncPlanItemCompletion({
        organizationId: access.organizationId,
        taskId: String(candidate.id),
        completed: true,
        completedAt: text((updated as Json).completed_at) ?? null,
        personId: access.personId,
      });
      const local = String(candidate.provider ?? "") === "local";
      await audit(access, actor ? "agent.task.completed" : "task.completed", local ? "work_os_task" : "nifty_task", String(candidate.provider_task_id ?? candidate.id), {
        ...(actor ? { tokenId: actor.tokenId, tokenName: actor.tokenName } : {}),
        source: actor ? "agent" : "employee_explicit",
      });
      if (String(candidate.id) === String(task.id)) updatedTask = updated as Json;
    },
    reopen: async (candidate) => {
      const updated = await completeTask(ownerId, String(candidate.provider_task_id ?? candidate.id), false);
      const exactAt = text((updated as Json).provider_updated_at) ?? new Date().toISOString();
      await recordTaskDayEvent(access, updated as Json, "reopened", {
        idempotencyKey: `${candidate.provider === "local" ? "local" : "nifty"}:reopened:${String(candidate.provider_task_id ?? candidate.id)}:${exactAt}`,
        exactAt,
        provenance: actor ? "agent" : "employee_explicit",
        ...(actor ? { metadata: { agentTokenId: actor.tokenId } } : {}),
      });
      await syncPlanItemCompletion({
        organizationId: access.organizationId,
        taskId: String(candidate.id),
        completed: false,
        completedAt: null,
        personId: access.personId,
      });
      const local = String(candidate.provider ?? "") === "local";
      await audit(access, actor ? "agent.task.reopened" : "task.reopened", local ? "work_os_task" : "nifty_task", String(candidate.provider_task_id ?? candidate.id), {
        ...(actor ? { tokenId: actor.tokenId, tokenName: actor.tokenName } : {}),
        source: actor ? "agent" : "employee_explicit",
      });
      if (String(candidate.id) === String(task.id)) updatedTask = updated as Json;
    },
  });
  if (outcome.failures.length) throw new Error(taskCompletionFailureMessage(outcome.failures, String(task.id)));
  const local = String(task.provider ?? "") === "local";
  return { task: updatedTask ?? task, providerStatus: local ? "work_os_confirmed" : "nifty_confirmed" };
}

/**
 * Returns provider-backed task rows for a read-only assistant selection card.
 *
 * Both views answer with open work only, so a long completed history can never
 * crowd the card's window, and pending lists the newest activity first (the record
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
  const tasks = await listPersonTasks(ownerId, personId, { completed: "false", includeLedgerHistory: true, limit: 500, order: "recency", includeAssignedBy: false }) as Json[];
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
  const { ownerId, task } = await employeeTaskContext(access, taskId, { allowArchived: true });
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  if (!capabilities.canArchive) throw new WorkOsForbiddenError();
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
  const { ownerId, task } = await employeeTaskContext(access, taskId, { allowArchived: true });
  const capabilities = taskCapabilities(task, taskActor(access), await employeeTaskToday(access));
  if (!capabilities.canDelete) throw new WorkOsForbiddenError();
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

export async function createWorkOsEmployeeTask(access: WorkOsAccess, body: Json, actor?: AgentActor, idempotencyKey?: string) {
  const title = text(body.name);
  const description = text(body.description);
  if (!title) throw new Error("Task title is required");
  if (title.length > 240) throw new Error("Task title must be 240 characters or fewer");
  if (description && description.length > 20_000) throw new Error("Task description must be 20000 characters or fewer");
  // A malformed due date would silently disable the overdue lock, so it is
  // rejected before the first write. An empty string still means "no date".
  const requestedDueDate = text(body.due_date);
  if (requestedDueDate !== null && !isCalendarDate(requestedDueDate)) {
    throw new WorkOsValidationError("due_date must be a real calendar date (YYYY-MM-DD)");
  }

  const suppliedPersonIds = Array.isArray(body.assignee_person_ids)
    ? [...new Set(body.assignee_person_ids.filter((value): value is string => typeof value === "string" && !!value.trim()))]
    : [];
  const options = await getWorkOsTaskCreationOptions(access);
  const allowedPeople = new Map(options.people.map((person) => [person.id, person]));
  // New work belongs to TASKS; a subtask inherits its parent's project instead.
  const requestedProjectId = text(body.project_id);
  const parentId = text(body.parent_task_id);
  // An inline subtask post sends no assignees. The creator then owns the
  // subtask, so the completion checkbox the capability gate enforces stays
  // usable for them. A top-level task keeps its unassigned contract.
  const requestedPersonIds = Array.isArray(body.assignee_person_ids)
    ? suppliedPersonIds
    : parentId && access.personId && allowedPeople.has(access.personId) ? [access.personId] : [];
  const invalidPersonId = requestedPersonIds.find((personId) => !allowedPeople.has(personId));
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
    assignedByPersonId: access.personId,
    dueDate: requestedDueDate,
    startDate: text(body.start_date),
    priority: text(body.priority),
    labels: Array.isArray(body.labels) ? body.labels.filter((value): value is string => typeof value === "string") : [],
    storyPoints: typeof body.story_points === "number" ? body.story_points : null,
    expectedOutcome: text(body.expected_outcome),
    definitionOfDone: text(body.definition_of_done),
    taskGroupId: text(body.task_group_id),
    estimatedEffortMinutes: effortMinutesPatch(body.estimated_effort_minutes),
    effortUnit: text(body.effort_unit),
    projectId: requestedProjectId ?? (parent ? null : await defaultWorkOsTaskProjectId(access.organizationId)),
    providerProjectId: text(parent?.provider_project_id),
    parent,
    raw: text(body.local_proposal_id) ? { proposalId: text(body.local_proposal_id), source: "work_os_proposal" } : undefined,
    agentTokenId: actor?.tokenId ?? null,
    agentIdempotencyKey: idempotencyKey ?? null,
    provenance: actor ? "agent" : "employee_explicit",
  });
  await audit(access, actor ? "agent.task.created" : parent ? "task.subtask_created" : "task.created", "work_os_task", String((task as Json).provider_task_id ?? (task as Json).id ?? "unknown"), {
    ...(actor ? { tokenId: actor.tokenId, tokenName: actor.tokenName } : {}),
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
/** Agent-attached evidence keeps the token identity while leaving the
 * employee-attached contract (evidenceClass, employeeAttached) intact. */
export function agentEvidenceMetrics(metrics: Json, agentTokenId?: string | null): Json {
  return agentTokenId ? { ...metrics, origin: "agent_evidence", agentTokenId } : metrics;
}

export async function attachWorkOsTaskCompletionEvidence(access: WorkOsAccess, taskId: string, input: CompletionEvidenceUpload, actor?: AgentActor) {
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
    metrics: agentEvidenceMetrics(completionEvidenceMetrics({
      contentType: validated.contentType,
      fileName: validated.fileName,
      sizeBytes: validated.size,
      note: validated.note,
    }), actor?.tokenId),
    raw: { origin: "task_completion", ...(actor ? { agentTokenId: actor.tokenId } : {}) },
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

  await audit(access, actor ? "agent.evidence.attached" : "task.evidence_attached", "work_evidence", evidenceId, {
    ...(actor ? { tokenId: actor.tokenId, tokenName: actor.tokenName } : {}),
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
  if (task.organization_id !== access.organizationId) throw new WorkOsNotFoundError();
  const capabilities = taskCapabilities({ ...task, completed: !completed }, taskActor(access), await employeeTaskToday(access));
  if (completed ? !capabilities.canComplete : !capabilities.canReopen) throw new WorkOsForbiddenError();
  if (completed && taskRequiresCompletionEvidence(task) && !(await completionEvidence(task.id as string, access.organizationId, ownerId))) {
    throw new WorkOsConflictError(
      "This task records an expected outcome. Attach completion evidence in the Windows Companion before marking it complete.",
      "evidence_required",
    );
  }
  // The administration record follows the same rule as the employee surfaces:
  // completing a task completes the open subtasks beneath it, subtasks first.
  let updatedTask: Json | undefined;
  const outcome = await applyTaskCompletion({
    task: completionRow(task),
    completed,
    openChildren: async (candidate) => (await openSubtaskRows({ organizationId: access.organizationId, task: candidate })).map(completionRow),
    complete: async (candidate) => {
      const updated = await completeTask(ownerId, String(candidate.provider_task_id ?? candidate.id), true);
      // An admin completing a task still completes the plan items that committed
      // to it, across whoever planned it.
      await syncPlanItemCompletion({
        organizationId: access.organizationId,
        taskId: String(candidate.id),
        completed: true,
        completedAt: text((updated as Json).completed_at) ?? null,
      });
      await audit(access, "task.completed", String(candidate.provider ?? "") === "local" ? "work_os_task" : "nifty_task", String(candidate.provider_task_id ?? candidate.id), {});
      if (String(candidate.id) === String(task.id)) updatedTask = updated as Json;
    },
    reopen: async (candidate) => {
      const updated = await completeTask(ownerId, String(candidate.provider_task_id ?? candidate.id), false);
      await syncPlanItemCompletion({
        organizationId: access.organizationId,
        taskId: String(candidate.id),
        completed: false,
        completedAt: null,
      });
      await audit(access, "task.reopened", String(candidate.provider ?? "") === "local" ? "work_os_task" : "nifty_task", String(candidate.provider_task_id ?? candidate.id), {});
      if (String(candidate.id) === String(task.id)) updatedTask = updated as Json;
    },
  });
  if (outcome.failures.length) throw new Error(taskCompletionFailureMessage(outcome.failures, String(task.id)));
  return updatedTask ?? task;
}
