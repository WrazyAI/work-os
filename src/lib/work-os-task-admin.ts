import { getTaskByLocalOrProviderId, updateTask } from "@/lib/work-os-tasks";
import { archiveWorkOsEmployeeTask, completeWorkOsTask, deleteWorkOsEmployeeTask, getWorkOsTaskCreationOptions } from "@/lib/work-os-employee-tasks";
import { workOsOrganizationOwnerId, WorkOsConflictError, WorkOsForbiddenError, WorkOsNotFoundError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { audit, type Json } from "@/lib/work-os-internal";
import { isWorkflowStatus, taskIsOverdue } from "@/lib/work-os-task-permissions";
import { withTaskCapabilities } from "@/lib/work-os-task-capabilities";

export async function updateWorkOsAdminTask(access: WorkOsAccess, taskId: string, body: Json): Promise<Json> {
  if (access.role !== "admin") throw new WorkOsForbiddenError();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkOsValidationError("Task patch must be an object");
  if (["completed", "workflow_status"].some((key) => key in body) && Object.keys(body).length !== 1) {
    throw new WorkOsValidationError("Send one task change at a time");
  }
  const ownerId = workOsOrganizationOwnerId(access);
  const task = await getTaskByLocalOrProviderId(ownerId, taskId);
  if (!task || task.organization_id !== access.organizationId || task.status === "deleted" || task.status === "archived") throw new WorkOsNotFoundError();
  const today = new Date().toISOString().slice(0, 10);
  let updated: Json;
  if ("completed" in body) {
    if (typeof body.completed !== "boolean") throw new WorkOsValidationError("completed must be a boolean");
    updated = await completeWorkOsTask(access, taskId, body.completed);
  } else {
    const patch: Json = {};
    if ("workflow_status" in body) {
      if (!isWorkflowStatus(body.workflow_status)) throw new WorkOsValidationError("workflow_status must be pending or in_progress");
      if (task.completed === true) throw new WorkOsConflictError("Reopen the task before changing its status", "task_completed");
      if (taskIsOverdue(task, today)) throw new WorkOsConflictError("Update the due date before changing this task's status", "due_date_passed");
      patch.workflow_status = body.workflow_status;
    }
    for (const key of ["name", "description", "due_date", "start_date", "priority", "expected_outcome", "definition_of_done", "blocked_reason", "task_group_id", "effort_unit", "estimated_effort_minutes", "labels", "story_points", "blocked"]) {
      if (key in body) patch[key] = body[key];
    }
    let assignmentChanged = false;
    if ("assignee_person_ids" in body) {
      const options = await getWorkOsTaskCreationOptions(access);
      const allowed = new Set(options.people.map((person) => person.id));
      if (!Array.isArray(body.assignee_person_ids) || body.assignee_person_ids.some((id: unknown) => typeof id !== "string" || !allowed.has(id))) {
        throw new WorkOsValidationError("Assignees must be active Work OS organization members");
      }
      const ids = [...new Set(body.assignee_person_ids as string[])];
      const previous = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [];
      assignmentChanged = previous.length !== ids.length || ids.some((id) => !previous.includes(id));
      patch.assignee_person_ids = ids;
      if (assignmentChanged) patch.assigned_by_person_id = access.personId;
    }
    if (!Object.keys(patch).length) throw new WorkOsValidationError("At least one field is required");
    updated = await updateTask(ownerId, taskId, patch);
    const entityType = task.provider === "local" ? "work_os_task" : "nifty_task";
    const entityId = String(task.provider_task_id ?? task.id);
    await audit(access, "workflow_status" in patch ? "task.status_changed" : "task.updated", entityType, entityId, { fields: Object.keys(patch) });
    if (assignmentChanged) await audit(access, "task.assigned", entityType, entityId, { assigneePersonIds: patch.assignee_person_ids, assignedByPersonId: access.personId });
  }
  return { task: withTaskCapabilities([updated], { role: access.role, personId: access.personId }, today)[0] };
}

export async function removeWorkOsAdminTask(access: WorkOsAccess, taskId: string, mode: "archive" | "delete"): Promise<Json> {
  if (access.role !== "admin") throw new WorkOsForbiddenError();
  if (mode !== "archive" && mode !== "delete") throw new WorkOsValidationError("mode must be archive or delete");
  // The employee lifecycle helpers enforce organization scope, cascade children,
  // clean plan items and emit the canonical task.archived/task.deleted audit.
  const result = mode === "delete" ? await deleteWorkOsEmployeeTask(access, taskId) : await archiveWorkOsEmployeeTask(access, taskId);
  return { ...result, task: withTaskCapabilities([result.task], { role: access.role, personId: access.personId }, new Date().toISOString().slice(0, 10))[0] };
}
