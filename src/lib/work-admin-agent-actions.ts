import { db, audit, type Json } from "@/lib/work-os-internal";
import { reviewAdminAgentEod, type AdminAgentEodReviewInput } from "@/lib/work-admin-agent-eods";
import {
  createWorkOsEmployeeTask,
  getWorkOsEmployeeTaskDetails,
  moveWorkOsEmployeeSubtask,
} from "@/lib/work-os-employee-tasks";
import { removeWorkOsAdminTask, updateWorkOsAdminTask } from "@/lib/work-os-task-admin";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import { WorkOsNotFoundError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type {
  AdminPreview,
  AdminPreviewAction,
  AdminPreviewChange,
  AdminPreviewValue,
} from "@/modules/work-os/admin-agent/contracts";

/** The action layer between an admin agent request and the services that
 * already own the writes. Every consequential action is described once, as a
 * preview (`summary`, `changes`, `warnings`, `state`), and only the confirm
 * route reaches `applyAdminAction`. A preview never calls a write service, and
 * an apply always writes the audit entry naming the admin, token, target, and
 * exact change list. */

export type AdminAgentPersonOption = {
  id: string;
  displayName: string;
  active: boolean;
};

/** The seven write/read services, plus an optional directory read used to
 * validate assignees and name people in a preview. The directory is optional so
 * a unit test can hand the layer fakes without installing a database; a real
 * preview (default services below) always supplies it. */
export type AdminAgentActionServices = {
  getTask: (access: WorkOsAccess, taskId: string) => Promise<Json>;
  createTask: (access: WorkOsAccess, payload: Json) => Promise<Json>;
  updateTask: (access: WorkOsAccess, taskId: string, payload: Json) => Promise<Json>;
  moveTask: (access: WorkOsAccess, taskId: string, parentTaskId: string) => Promise<Json>;
  completeTask: (access: WorkOsAccess, taskId: string, completed: boolean) => Promise<Json>;
  archiveTask: (access: WorkOsAccess, taskId: string, mode: "archive" | "delete") => Promise<Json>;
  reviewEod: (access: WorkOsAccess, reportId: string, body: Json) => Promise<Json>;
  listPeople?: (access: WorkOsAccess) => Promise<AdminAgentPersonOption[]>;
};

export type AdminActionPreview = Omit<AdminPreview, "id" | "expiresAt"> & {
  targetType: string;
  targetId: string | null;
};

const NAME_MAX = 240;
const DESCRIPTION_MAX = 20_000;
const PERSON_IDS_MAX = 50;

/** The employee create contract. The admin surface accepts the same fields;
 * the difference is that `assignee_person_ids` is checked against every active
 * organization member rather than the caller's own person. */
const CREATE_FIELDS = new Set([
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
  "parent_task_id",
  "project_id",
  "assignee_person_ids",
]);

/** Content edits plus blockers and assignment. Lifecycle changes are their own
 * actions (complete/reopen/archive/delete), and a parent change is `task.move`,
 * so a flat update can never smuggle one in. */
const UPDATE_FIELDS = new Set([
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
  "blocked",
  "blocked_reason",
]);

type AssignmentMode = "add" | "remove" | "replace";

type ActionPlan = {
  summary: string;
  changes: AdminPreviewChange[];
  warnings: string[];
  state: Json;
  targetType: string;
  targetId: string | null;
  run: () => Promise<{ status: number; body: Json; targetId: string | null }>;
};

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function objectInput(value: Json, label: string): Json {
  if (!isRecord(value)) throw new WorkOsValidationError(`${label} must be an object`);
  return value;
}

function optionalText(value: unknown, field: string, max = NAME_MAX): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new WorkOsValidationError(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new WorkOsValidationError(`${field} must be ${max} characters or fewer`);
  return trimmed;
}

function textField(input: Json, field: string, max = NAME_MAX): string | null | undefined {
  if (!(field in input)) return undefined;
  return optionalText(input[field], field, max);
}

function nameField(input: Json): string {
  const name = optionalText(input.name, "name");
  if (!name) throw new WorkOsValidationError("Task title is required");
  return name;
}

function dateField(input: Json, field: string): string | null | undefined {
  if (!(field in input)) return undefined;
  const value = input[field];
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new WorkOsValidationError(`${field} must be a string or null`);
  const date = value.trim();
  if (!isCalendarDate(date)) throw new WorkOsValidationError(`${field} must be a real calendar date (YYYY-MM-DD)`);
  return date;
}

function numberField(input: Json, field: string): number | null | undefined {
  if (!(field in input)) return undefined;
  const value = input[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new WorkOsValidationError(`${field} must be a non-negative number or null`);
  }
  return value;
}

function labelsField(input: Json): string[] | undefined {
  if (!("labels" in input)) return undefined;
  const value = input.labels;
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((label) => typeof label !== "string")) {
    throw new WorkOsValidationError("labels must be an array of strings");
  }
  return [...new Set((value as string[]).map((label) => label.trim()).filter(Boolean))];
}

/** Order is not identity for an assignee list, so every list this module emits
 * is deduped and sorted. The preview state fingerprint applies the same rule. */
function normalizePersonIds(value: unknown, field = "assignee_person_ids"): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new WorkOsValidationError(`${field} must be an array of person ids`);
  if (value.length > PERSON_IDS_MAX) throw new WorkOsValidationError(`${field} must contain ${PERSON_IDS_MAX} people or fewer`);
  const ids = value.map((id) => (typeof id === "string" ? id.trim() : ""));
  if (ids.some((id) => !id)) throw new WorkOsValidationError(`${field} must be an array of person ids`);
  return [...new Set(ids as string[])].sort();
}

function activePersonIds(people: AdminAgentPersonOption[] | null): string[] | null {
  return people ? people.filter((person) => person.active).map((person) => person.id) : null;
}

async function readPeople(
  services: AdminAgentActionServices,
  access: WorkOsAccess,
): Promise<AdminAgentPersonOption[] | null> {
  return services.listPeople ? services.listPeople(access) : null;
}

function rejectUnknownFields(input: Json, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    throw new WorkOsValidationError(`Field ${key} cannot be set through the ${label}`);
  }
}

/** Accepts the employee create fields and normalizes them. `activePersonIds`
 * is the resolved directory read; a caller that has not read the directory can
 * omit it, and the service that owns the write enforces membership again before
 * inserting. */
export function validateAdminTaskCreate(
  payload: Json,
  activePersonIdsForValidation?: Iterable<string> | null,
): Json {
  const input = objectInput(payload, "Task create payload");
  rejectUnknownFields(input, CREATE_FIELDS, "admin task API");
  const result: Json = { name: nameField(input) };

  for (const field of ["description", "priority", "expected_outcome", "definition_of_done", "effort_unit", "task_group_id", "parent_task_id", "project_id"]) {
    const value = textField(input, field, field === "description" ? DESCRIPTION_MAX : NAME_MAX);
    if (value !== undefined) result[field] = value;
  }
  for (const field of ["due_date", "start_date"]) {
    const value = dateField(input, field);
    if (value !== undefined) result[field] = value;
  }
  for (const field of ["story_points", "estimated_effort_minutes"]) {
    const value = numberField(input, field);
    if (value !== undefined) result[field] = value;
  }
  const labels = labelsField(input);
  if (labels !== undefined) result.labels = labels;
  if ("assignee_person_ids" in input) {
    const ids = normalizePersonIds(input.assignee_person_ids);
    if (activePersonIdsForValidation) {
      const allowed = new Set(activePersonIdsForValidation);
      if (ids.some((id) => !allowed.has(id))) {
        throw new WorkOsValidationError("Assignees must be active Work OS organization members");
      }
    }
    result.assignee_person_ids = ids;
  }
  return result;
}

function validateTaskUpdate(payload: Json, activePersonIdsForValidation?: Iterable<string> | null): Json {
  const input = objectInput(payload, "Task patch");
  const patch: Json = {};
  for (const key of Object.keys(input)) {
    if (key === "task_id") continue;
    if (!UPDATE_FIELDS.has(key)) {
      throw new WorkOsValidationError(`Field ${key} cannot be updated through the admin task API`);
    }
  }
  if ("name" in input) patch.name = nameField(input);
  for (const field of ["description", "priority", "expected_outcome", "definition_of_done", "effort_unit", "task_group_id", "blocked_reason"]) {
    const value = textField(input, field, field === "description" ? DESCRIPTION_MAX : NAME_MAX);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["due_date", "start_date"]) {
    const value = dateField(input, field);
    if (value !== undefined) patch[field] = value;
  }
  for (const field of ["story_points", "estimated_effort_minutes"]) {
    const value = numberField(input, field);
    if (value !== undefined) patch[field] = value;
  }
  if ("blocked" in input) {
    if (typeof input.blocked !== "boolean") throw new WorkOsValidationError("blocked must be a boolean");
    patch.blocked = input.blocked;
  }
  const labels = labelsField(input);
  if (labels !== undefined) patch.labels = labels;
  if ("assignee_person_ids" in input) {
    const ids = normalizePersonIds(input.assignee_person_ids);
    if (activePersonIdsForValidation) {
      const allowed = new Set(activePersonIdsForValidation);
      if (ids.some((id) => !allowed.has(id))) {
        throw new WorkOsValidationError("Assignees must be active Work OS organization members");
      }
    }
    patch.assignee_person_ids = ids;
  }
  if (!Object.keys(patch).length) throw new WorkOsValidationError("At least one field is required");
  return patch;
}

function previewValue(value: unknown): AdminPreviewValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => previewValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Json).map(([key, item]) => [key, previewValue(item)]));
  }
  return String(value);
}

function change(field: string, from: unknown, to: unknown): AdminPreviewChange {
  return { field, from: previewValue(from), to: previewValue(to) };
}

function assigneeIds(task: Json): string[] {
  if (!Array.isArray(task.assignee_person_ids)) return [];
  return [...new Set(task.assignee_person_ids.filter((id): id is string => typeof id === "string" && !!id.trim()))].sort();
}

function taskParentId(task: Json): string | null {
  return typeof task.parent_task_id === "string" && task.parent_task_id.trim() ? task.parent_task_id : null;
}

function taskTitle(task: Json): string {
  return typeof task.title === "string" && task.title.trim() ? task.title.trim() : "Untitled task";
}

function taskState(task: Json, assignees = assigneeIds(task), parentId = taskParentId(task)): Json {
  return {
    updatedAt: typeof task.updated_at === "string" ? task.updated_at : null,
    status: typeof task.status === "string" ? task.status : null,
    completed: task.completed === true,
    assignees,
    parentId,
  };
}

function taskBody(result: Json): Json {
  return isRecord(result) && "task" in result ? result : { task: result };
}

function taskIdOf(result: Json): string | null {
  const row = isRecord(result) && isRecord(result.task) ? result.task : result;
  return typeof row.id === "string" && row.id.trim() ? row.id : null;
}

function payloadTaskId(payload: Json): string {
  const value = payload.task_id;
  if (typeof value !== "string" || !value.trim()) throw new WorkOsValidationError("task_id is required");
  return value.trim();
}

async function requireTask(
  services: AdminAgentActionServices,
  access: WorkOsAccess,
  taskId: string,
  message = "Task not found",
): Promise<Json> {
  const task = await services.getTask(access, taskId);
  if (!isRecord(task) || typeof task.id !== "string" || !task.id.trim()) {
    throw new WorkOsNotFoundError(message);
  }
  return task;
}

function personName(person: AdminAgentPersonOption): string {
  return person.displayName.trim() || person.id;
}

function ownerNames(owners: string[], people: AdminAgentPersonOption[] | null): string {
  if (!owners.length) return "";
  if (!people) return owners.join(", ");
  const byId = new Map(people.map((person) => [person.id, person]));
  return owners.map((id) => (byId.has(id) ? personName(byId.get(id) as AdminAgentPersonOption) : id)).join(", ");
}

function assignmentWarnings(final: string[], people: AdminAgentPersonOption[] | null): string[] {
  const warnings: string[] = [];
  if (!final.length) warnings.push("This leaves the task with no assignees.");
  if (people) {
    const byId = new Map(people.map((person) => [person.id, person]));
    for (const id of final) {
      const person = byId.get(id);
      if (!person) warnings.push(`Person ${id} is not an active organization member.`);
      else if (!person.active) warnings.push(`${person.displayName} is not an active organization member.`);
    }
  }
  return warnings;
}

function hasParent(task: Json): boolean {
  return !!(taskParentId(task)
    || (typeof task.parent_provider_task_id === "string" && task.parent_provider_task_id.trim()));
}

function projectKey(task: Json): string | null {
  if (typeof task.project_id === "string" && task.project_id.trim()) return task.project_id;
  if (typeof task.provider_project_id === "string" && task.provider_project_id.trim()) return task.provider_project_id;
  return null;
}

function resolveAssignment(current: string[], mode: AssignmentMode, requested: string[]): string[] {
  const requestedSet = new Set(requested);
  if (mode === "add") return [...new Set([...current, ...requested])].sort();
  if (mode === "remove") return current.filter((id) => !requestedSet.has(id)).sort();
  return [...requestedSet].sort();
}

function planCreate(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  return (async () => {
    const people = await readPeople(services, access);
    const input = validateAdminTaskCreate(payload, activePersonIds(people));
    const owners = Array.isArray(input.assignee_person_ids) ? input.assignee_person_ids as string[] : [];
    const names = ownerNames(owners, people);
    const project = typeof input.project_id === "string" ? input.project_id : null;
    const dueDate = typeof input.due_date === "string" ? input.due_date : null;
    return {
      summary: `Create ${String(input.name)} for ${names || "unassigned"}`,
      changes: [
        change("name", null, input.name),
        change("owners", [], owners),
        change("project", null, project),
        change("due_date", null, dueDate),
      ],
      warnings: [],
      state: {},
      targetType: "task",
      targetId: null,
      run: async () => {
        const created = await services.createTask(access, input);
        return { status: 201, body: taskBody(created), targetId: taskIdOf(created) };
      },
    };
  })();
}

async function planUpdate(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  const taskId = payloadTaskId(payload);
  const task = await requireTask(services, access, taskId);
  const people = await readPeople(services, access);
  const patch = validateTaskUpdate(payload, activePersonIds(people));
  const changes: AdminPreviewChange[] = [];
  for (const field of Object.keys(patch)) {
    if (field === "name") changes.push(change("name", task.title ?? null, patch.name));
    else if (field === "assignee_person_ids") changes.push(change("assignees", assigneeIds(task), patch.assignee_person_ids));
    else changes.push(change(field, task[field] ?? null, patch[field]));
  }
  const assigned = Array.isArray(patch.assignee_person_ids) ? patch.assignee_person_ids as string[] : null;
  return {
    summary: `Update ${taskTitle(task)}`,
    changes,
    warnings: assigned ? assignmentWarnings(assigned, people) : [],
    state: taskState(task),
    targetType: "task",
    targetId: taskId,
    run: async () => {
      const result = await services.updateTask(access, taskId, patch);
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

async function planAssign(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  rejectUnknownFields(payload, new Set(["task_id", "mode", "person_ids"]), "admin task assign action");
  const taskId = payloadTaskId(payload);
  const mode = payload.mode;
  if (mode !== "add" && mode !== "remove" && mode !== "replace") {
    throw new WorkOsValidationError("mode must be add, remove, or replace");
  }
  const requested = normalizePersonIds(payload.person_ids, "person_ids");
  const task = await requireTask(services, access, taskId);
  const current = assigneeIds(task);
  // The final list is resolved once against this snapshot; the confirm path
  // re-reads the same state before apply, so the list cannot drift underneath.
  const final = resolveAssignment(current, mode, requested);
  const people = await readPeople(services, access);
  return {
    summary: `Assign ${taskTitle(task)}`,
    changes: [change("assignees", current, final)],
    warnings: assignmentWarnings(final, people),
    state: taskState(task, final),
    targetType: "task",
    targetId: taskId,
    run: async () => {
      // The stored action is a delta, but the write is the exact final list.
      const result = await services.updateTask(access, taskId, { assignee_person_ids: final });
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

async function planMove(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  rejectUnknownFields(payload, new Set(["task_id", "parent_task_id"]), "admin task move action");
  const taskId = payloadTaskId(payload);
  const parentTaskId = payload.parent_task_id;
  if (typeof parentTaskId !== "string" || !parentTaskId.trim()) {
    throw new WorkOsValidationError("parent_task_id is required");
  }
  const parentId = parentTaskId.trim();
  if (parentId === taskId) throw new WorkOsValidationError("A task cannot be its own parent");
  const [task, parent] = await Promise.all([
    requireTask(services, access, taskId),
    requireTask(services, access, parentId, "Parent task not found"),
  ]);
  const warnings: string[] = [];
  if (!hasParent(task)) warnings.push("Only subtasks can be moved.");
  if (hasParent(parent)) warnings.push("The new parent is not a top-level task.");
  const taskProject = projectKey(task);
  const parentProject = projectKey(parent);
  if (taskProject && parentProject && taskProject !== parentProject) {
    warnings.push("The new parent is in another project.");
  }
  const from = taskParentId(task);
  return {
    summary: `Move ${taskTitle(task)}`,
    changes: [change("parent", from, parentId)],
    warnings,
    state: taskState(task, assigneeIds(task), parentId),
    targetType: "task",
    targetId: taskId,
    run: async () => {
      const result = await services.moveTask(access, taskId, parentId);
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

async function planAdminAction(
  access: WorkOsAccess,
  action: AdminPreviewAction,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  switch (action) {
    case "task.create":
      return planCreate(access, payload, services);
    case "task.update":
      return planUpdate(access, payload, services);
    case "task.assign":
      return planAssign(access, payload, services);
    case "task.move":
      return planMove(access, payload, services);
    default:
      throw new WorkOsValidationError(`Action ${String(action)} is not supported by this surface`);
  }
}

/** Describe one action without writing anything. The `run` closure is only
 * invoked by `applyAdminAction`, so a preview route can never execute a
 * consequential write by accident. */
export async function previewAdminAction(
  access: WorkOsAccess,
  action: AdminPreviewAction,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<AdminActionPreview> {
  const plan = await planAdminAction(access, action, payload, services);
  return {
    action,
    summary: plan.summary,
    changes: plan.changes,
    warnings: plan.warnings,
    state: plan.state,
    targetType: plan.targetType,
    targetId: plan.targetId,
  };
}

/** Execute a confirmed preview and record who did it. The preview id is the
 * one-time key; this function only ever runs from the confirm route. */
export async function applyAdminAction(
  access: WorkOsAccess,
  action: AdminPreviewAction,
  payload: Json,
  services: AdminAgentActionServices,
  actor: { tokenId: string; tokenName: string },
): Promise<{ status: number; body: Json }> {
  const plan = await planAdminAction(access, action, payload, services);
  const result = await plan.run();
  await audit(access, `admin.${action}`, plan.targetType, result.targetId, {
    tokenId: actor.tokenId,
    tokenName: actor.tokenName,
    action,
    changes: plan.changes,
  });
  return { status: result.status, body: result.body };
}

/** The production wiring. Each method delegates to the service that already
 * owns the employee/admin write, so capability checks, cascades, plan-item
 * sync, and the canonical task audit behave exactly as on the employee
 * surfaces. The admin action audit above is additive, not a replacement. */
export const defaultAdminAgentActionServices: AdminAgentActionServices = {
  getTask: async (access, taskId) => {
    const details = await getWorkOsEmployeeTaskDetails(access, taskId, { allowArchived: true });
    return details.task as Json;
  },
  createTask: (access, payload) => createWorkOsEmployeeTask(access, payload) as Promise<Json>,
  updateTask: (access, taskId, payload) => updateWorkOsAdminTask(access, taskId, payload),
  moveTask: (access, taskId, parentTaskId) =>
    moveWorkOsEmployeeSubtask(access, taskId, { parent_task_id: parentTaskId }) as unknown as Promise<Json>,
  completeTask: (access, taskId, completed) => updateWorkOsAdminTask(access, taskId, { completed }),
  archiveTask: (access, taskId, mode) => removeWorkOsAdminTask(access, taskId, mode),
  reviewEod: (access, reportId, body) =>
    reviewAdminAgentEod(access, reportId, body as unknown as AdminAgentEodReviewInput),
  listPeople: async (access) => {
    const { data, error } = await db().from("work_people")
      .select("id,display_name,active")
      .eq("organization_id", access.organizationId)
      .order("display_name");
    if (error) throw new Error(`load admin action people: ${error.message}`);
    return (data ?? []).map((person: Record<string, unknown>) => ({
      id: String(person.id),
      displayName: (person.display_name as string | null)?.trim() || "Organization member",
      active: person.active === true,
    }));
  },
};
