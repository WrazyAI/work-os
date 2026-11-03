import { db, audit, type Json } from "@/lib/work-os-internal";
import { previewFingerprint } from "@/lib/work-admin-action-previews";
import {
  getAdminAgentEod,
  reviewAdminAgentEod,
  type AdminAgentEodReviewInput,
} from "@/lib/work-admin-agent-eods";
import { taskRequiresCompletionEvidence } from "@/modules/work-os/completion-evidence";
import {
  createWorkOsEmployeeTask,
  getWorkOsEmployeeTaskDetails,
  moveWorkOsEmployeeSubtask,
} from "@/lib/work-os-employee-tasks";
import { removeWorkOsAdminTask, updateWorkOsAdminTask } from "@/lib/work-os-task-admin";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import {
  WorkOsConflictError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "@/lib/work-os-api";
import type {
  AdminPreview,
  AdminPreviewAction,
  AdminPreviewChange,
  AdminPreviewValue,
} from "@/modules/work-os/admin-agent/contracts";

/** The action layer between an admin agent request and the services that
 * already own the writes. Every consequential action is described once, as a
 * preview (`summary`, `changes`, `warnings`, `state`, `request`), and only the
 * confirm route reaches `applyAdminAction`. A preview never calls a write
 * service; an apply writes the request it was handed and always records the
 * admin, token, target, and exact change list. */

export type AdminAgentPersonOption = {
  id: string;
  displayName: string;
  active: boolean;
};

/** The seven write/read services, plus an optional directory read used to
 * validate assignees and name people in a preview. The directory is optional so
 * a unit test can hand the layer fakes without installing a database; a real
 * preview (default services below) always supplies it. */
export type AdminAgentCreateTaskOptions = {
  /** Deterministic creation key. The preview id is passed here, so a retried
   * confirm returns the task the first attempt created instead of a second one. */
  idempotencyKey?: string;
  actor?: { tokenId: string; tokenName: string };
};

export type AdminAgentActionServices = {
  getTask: (access: WorkOsAccess, taskId: string) => Promise<Json>;
  createTask: (access: WorkOsAccess, payload: Json, options?: AdminAgentCreateTaskOptions) => Promise<Json>;
  updateTask: (access: WorkOsAccess, taskId: string, payload: Json) => Promise<Json>;
  moveTask: (access: WorkOsAccess, taskId: string, parentTaskId: string) => Promise<Json>;
  completeTask: (access: WorkOsAccess, taskId: string, completed: boolean) => Promise<Json>;
  archiveTask: (access: WorkOsAccess, taskId: string, mode: "archive" | "delete") => Promise<Json>;
  /** Reads the report a decision would apply to. A preview must describe the
   * current status from the same reader the confirm path re-reads. */
  getEod: (access: WorkOsAccess, reportId: string) => Promise<Json>;
  /** `reviewerPersonId` is the resolved admin identity (token person, otherwise
   * the membership person), so self-review is enforced even for an unmapped
   * admin token. */
  reviewEod: (
    access: WorkOsAccess,
    reportId: string,
    body: Json,
    reviewerPersonId?: string | null,
  ) => Promise<Json>;
  listPeople?: (access: WorkOsAccess) => Promise<AdminAgentPersonOption[]>;
};

/** The preview plus the resolved request the preview store must persist. Task
 * 13 stores `request` in the preview row and hands it back to apply verbatim. */
export type AdminActionPreview = Omit<AdminPreview, "id" | "expiresAt"> & {
  targetType: string;
  targetId: string | null;
  request: Json;
};

/** The actor that confirmed the preview. `previewId` doubles as the create
 * idempotency key; `tokenId` scopes it to one admin token. `reviewerPersonId` is
 * the person the admin decides as, resolved at authorization time: Task 8's
 * self-review rule depends on it because an admin token may have no person
 * mapping of its own. */
export type AdminActionActor = {
  tokenId: string;
  tokenName: string;
  previewId: string;
  reviewerPersonId: string | null;
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

/** Fields the preview resolves once and apply must consume verbatim instead of
 * recomputing from a possibly newer target snapshot. They are accepted on an
 * apply request but never sent to a write service. */
const RESOLVED_REQUEST_FIELDS = new Set([
  "final_assignee_person_ids",
  "resolved_owner_person_ids",
]);

type AssignmentMode = "add" | "remove" | "replace";

type ActionPlan = {
  summary: string;
  changes: AdminPreviewChange[];
  warnings: string[];
  state: Json;
  targetType: string;
  targetId: string | null;
  request: Json;
  /** The current target row the plan was built from; null for create. */
  task: Json | null;
  /** Audit coordinates when they are not derivable from a task row (EOD
   * reports are not tasks). Task plans leave this unset. */
  auditTarget?: { type: string; id: string };
  run: (actor?: AdminActionActor) => Promise<{ status: number; body: Json; targetId: string | null }>;
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

/** An inactive or unknown assignee is a caller mistake, exactly as the write
 * service treats it. The preview refuses it instead of warning and letting the
 * confirm fail after the user has already said yes. */
function assertActiveAssignees(ids: string[], people: AdminAgentPersonOption[] | null): void {
  if (!people) return;
  const active = new Set(people.filter((person) => person.active).map((person) => person.id));
  if (ids.some((id) => !active.has(id))) {
    throw new WorkOsValidationError("Assignees must be active Work OS organization members");
  }
}

function rejectUnknownFields(input: Json, allowed: Set<string>, label: string): void {
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    throw new WorkOsValidationError(`Field ${key} cannot be set through the ${label}`);
  }
}

/** Accepts the employee create fields and normalizes them. `assignee_person_ids`
 * is always emitted, even when empty: the delegated create service defaults a
 * subtask to the mapped caller only when the array is absent, and an admin
 * preview must describe exactly who will own the new work. */
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
  const assignees = "assignee_person_ids" in input ? normalizePersonIds(input.assignee_person_ids) : [];
  if (activePersonIdsForValidation) {
    const allowed = new Set(activePersonIdsForValidation);
    if (assignees.some((id) => !allowed.has(id))) {
      throw new WorkOsValidationError("Assignees must be active Work OS organization members");
    }
  }
  result.assignee_person_ids = assignees;
  return result;
}

function validateTaskUpdate(payload: Json, activePersonIdsForValidation?: Iterable<string> | null): Json {
  const input = objectInput(payload, "Task patch");
  const patch: Json = {};
  for (const key of Object.keys(input)) {
    if (key === "task_id" || RESOLVED_REQUEST_FIELDS.has(key)) continue;
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

/** The target state a preview was computed from: the current assignees and the
 * current parent, never the planned result. Task 13's confirm `readState` must
 * call this same helper so the stored fingerprint compares like for like. */
export function adminTaskPreviewState(task: Json): Json {
  return {
    updatedAt: typeof task.updated_at === "string" ? task.updated_at : null,
    status: typeof task.status === "string" ? task.status : null,
    completed: task.completed === true,
    assignees: assigneeIds(task),
    parentId: taskParentId(task),
  };
}

/** The person this admin decides as. The admin surface attaches the resolved
 * reviewer person to the access object it hands this layer (Task 13 spreads
 * `agent.reviewerPersonId` onto `agent.access`); a bare `WorkOsAccess` falls
 * back to its own person mapping, the same order `reviewAdminAgentEod` uses. */
function reviewerPersonId(access: WorkOsAccess): string | null {
  const resolved = (access as WorkOsAccess & { reviewerPersonId?: string | null }).reviewerPersonId;
  if (typeof resolved === "string" && resolved.trim()) return resolved;
  return access.personId;
}

/** The details reader attaches the employee-attached completion evidence it
 * already loaded. `taskRequiresCompletionEvidence` is the same predicate the
 * completion service enforces, so the preview can say why a completion will be
 * refused before the admin confirms it. */
function taskHasCompletionEvidence(task: Json): boolean {
  if (Array.isArray(task.completion_evidence)) return task.completion_evidence.length > 0;
  if (Array.isArray(task.evidence)) return task.evidence.length > 0;
  return task.has_completion_evidence === true;
}

function taskChildCount(task: Json): number {
  if (Array.isArray(task.subtasks)) return task.subtasks.length;
  const total = task.subtask_total;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : 0;
}

function childWarning(mode: "archive" | "delete", children: number): string | null {
  if (!children) return null;
  return `This also ${mode === "delete" ? "deletes" : "archives"} ${children} subtask${children === 1 ? "" : "s"}.`;
}

/** The report state an EOD decision was previewed from. Task 13's confirm
 * `readState` must project the report the same way so a status change or a
 * later edit invalidates the preview. */
export function adminEodPreviewState(report: Json): Json {
  return {
    status: stringField(report, "status"),
    updatedAt: stringField(report, "updated_at") ?? stringField(report, "updatedAt"),
  };
}

function eodPersonId(report: Json): string | null {
  const direct = stringField(report, "person_id");
  if (direct) return direct;
  return isRecord(report.person) ? stringField(report.person, "id") : null;
}

function eodPersonName(report: Json): string | null {
  if (isRecord(report.person)) {
    const name = stringField(report.person, "displayName") ?? stringField(report.person, "display_name");
    if (name) return name;
  }
  return stringField(report, "display_name");
}

function eodManagerNotes(report: Json): string | null {
  return stringField(report, "manager_notes") ?? stringField(report, "managerNotes");
}

/** `Approve EOD for <person>` when the report names its author, otherwise the
 * decision alone. The action is always visible at the front of the summary. */
function eodSummary(decision: "approved" | "rejected", report: Json): string {
  const verb = decision === "approved" ? "Approve" : "Reject";
  const title = stringField(report, "title");
  const label = eodPersonName(report)
    ?? (title && title.toLowerCase() !== "eod" ? title : null);
  return label ? `${verb} EOD for ${label}` : `${verb} EOD`;
}

function taskBody(result: Json): Json {
  return isRecord(result) && "task" in result ? result : { task: result };
}

function taskRow(result: Json): Json | null {
  if (isRecord(result) && isRecord(result.task)) return result.task;
  return isRecord(result) ? result : null;
}

function stringField(row: Json | null, field: string): string | null {
  if (!row) return null;
  const value = row[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Audit targets follow the canonical task convention: provider-backed rows
 * are `nifty_task`, local Work OS rows `work_os_task`. The preview store's
 * `targetType` stays the simpler `task` surface label. */
function auditTargetType(task: Json | null): string {
  const provider = stringField(task, "provider");
  return provider && provider !== "local" ? "nifty_task" : "work_os_task";
}

function auditTargetId(task: Json | null, fallback: string | null): string {
  return stringField(task, "provider_task_id") ?? stringField(task, "id") ?? fallback ?? "unknown";
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

function assignmentWarnings(final: string[]): string[] {
  return final.length ? [] : ["This leaves the task with no assignees."];
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

function pickFields(input: Json, allowed: Set<string>): Json {
  const picked: Json = {};
  for (const key of allowed) {
    if (key in input) picked[key] = input[key];
  }
  return picked;
}

async function planCreate(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  const people = await readPeople(services, access);
  const input = validateAdminTaskCreate(pickFields(payload, CREATE_FIELDS), activePersonIds(people));
  const owners = input.assignee_person_ids as string[];
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
    request: { ...input, resolved_owner_person_ids: owners },
    task: null,
    run: async (actor) => {
      const created = await services.createTask(access, input, {
        idempotencyKey: actor?.previewId,
        actor: actor ? { tokenId: actor.tokenId, tokenName: actor.tokenName } : undefined,
      });
      const row = taskRow(created);
      return { status: 201, body: taskBody(created), targetId: auditTargetId(row, null) };
    },
  };
}

async function planUpdate(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  const input = objectInput(payload, "Task patch");
  const taskId = payloadTaskId(input);
  const task = await requireTask(services, access, taskId);
  const people = await readPeople(services, access);
  const patch = validateTaskUpdate(input, activePersonIds(people));
  const changes: AdminPreviewChange[] = [];
  for (const field of Object.keys(patch)) {
    if (field === "name") changes.push(change("name", task.title ?? null, patch.name));
    else if (field === "assignee_person_ids") changes.push(change("assignees", assigneeIds(task), patch.assignee_person_ids));
    else changes.push(change(field, task[field] ?? null, patch[field]));
  }
  const assigned = Array.isArray(patch.assignee_person_ids) ? patch.assignee_person_ids as string[] : null;
  if (assigned) assertActiveAssignees(assigned, people);
  return {
    summary: `Update ${taskTitle(task)}`,
    changes,
    warnings: assigned ? assignmentWarnings(assigned) : [],
    state: adminTaskPreviewState(task),
    targetType: "task",
    targetId: taskId,
    request: { task_id: taskId, ...patch },
    task,
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
  const input = objectInput(payload, "Task assign payload");
  rejectUnknownFields(
    input,
    new Set(["task_id", "mode", "person_ids", "final_assignee_person_ids"]),
    "admin task assign action",
  );
  const taskId = payloadTaskId(input);
  const task = await requireTask(services, access, taskId);
  const current = assigneeIds(task);
  const people = await readPeople(services, access);
  const requested = normalizePersonIds(input.person_ids, "person_ids");
  let final: string[];
  if (Array.isArray(input.final_assignee_person_ids)) {
    // A stored request already resolved the list; reuse it instead of applying
    // the delta again against a possibly changed snapshot.
    final = normalizePersonIds(input.final_assignee_person_ids, "final_assignee_person_ids");
  } else {
    const mode = input.mode;
    if (mode !== "add" && mode !== "remove" && mode !== "replace") {
      throw new WorkOsValidationError("mode must be add, remove, or replace");
    }
    final = resolveAssignment(current, mode, requested);
  }
  assertActiveAssignees(final, people);
  return {
    summary: `Assign ${taskTitle(task)}`,
    changes: [change("assignees", current, final)],
    warnings: assignmentWarnings(final),
    state: adminTaskPreviewState(task),
    targetType: "task",
    targetId: taskId,
    request: {
      task_id: taskId,
      mode: input.mode === "add" || input.mode === "remove" || input.mode === "replace" ? input.mode : "replace",
      person_ids: requested,
      final_assignee_person_ids: final,
    },
    task,
    run: async () => {
      // The stored action is a delta, but the write is the exact resolved list.
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
  const input = objectInput(payload, "Task move payload");
  rejectUnknownFields(
    input,
    new Set(["task_id", "parent_task_id"]),
    "admin task move action",
  );
  const taskId = payloadTaskId(input);
  const parentTaskId = input.parent_task_id;
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
    state: adminTaskPreviewState(task),
    targetType: "task",
    targetId: taskId,
    request: { task_id: taskId, parent_task_id: parentId },
    task,
    run: async () => {
      const result = await services.moveTask(access, taskId, parentId);
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

async function planCompletion(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
  completed: boolean,
): Promise<ActionPlan> {
  const label = completed ? "task complete" : "task reopen";
  const input = objectInput(payload, completed ? "Task complete payload" : "Task reopen payload");
  rejectUnknownFields(input, new Set(["task_id"]), `admin ${label} action`);
  const taskId = payloadTaskId(input);
  const task = await requireTask(services, access, taskId);
  const current = task.completed === true;
  const warnings: string[] = [];
  if (current === completed) {
    warnings.push(completed ? "This task is already complete." : "This task is already open.");
  }
  // The completion service refuses this write with `evidence_required`; saying
  // so in the preview is the difference between a guess and a described action.
  if (completed && taskRequiresCompletionEvidence(task) && !taskHasCompletionEvidence(task)) {
    warnings.push(
      "This task records an expected outcome, so completion needs evidence; attach it in the Windows Companion first.",
    );
  }
  return {
    summary: `${completed ? "Complete" : "Reopen"} ${taskTitle(task)}`,
    changes: [change("completed", current, completed)],
    warnings,
    state: adminTaskPreviewState(task),
    targetType: "task",
    targetId: taskId,
    request: { task_id: taskId },
    task,
    run: async () => {
      const result = await services.completeTask(access, taskId, completed);
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

async function planRemoval(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
  mode: "archive" | "delete",
): Promise<ActionPlan> {
  const input = objectInput(payload, mode === "delete" ? "Task delete payload" : "Task archive payload");
  rejectUnknownFields(input, new Set(["task_id"]), `admin task ${mode} action`);
  const taskId = payloadTaskId(input);
  const task = await requireTask(services, access, taskId);
  const current = stringField(task, "status");
  const warnings: string[] = [];
  const children = childWarning(mode, taskChildCount(task));
  if (children) warnings.push(children);
  if (current === "archived" || current === "deleted") warnings.push(`This task is already ${current}.`);
  return {
    summary: `${mode === "delete" ? "Delete" : "Archive"} ${taskTitle(task)}`,
    changes: [change("status", current, mode === "delete" ? "deleted" : "archived")],
    warnings,
    state: adminTaskPreviewState(task),
    targetType: "task",
    targetId: taskId,
    request: { task_id: taskId },
    task,
    run: async () => {
      const result = await services.archiveTask(access, taskId, mode);
      return { status: 200, body: taskBody(result), targetId: taskId };
    },
  };
}

const EOD_REVIEW_FIELDS = new Set(["report_id", "status", "manager_notes", "markdown"]);

async function planEodReview(
  access: WorkOsAccess,
  payload: Json,
  services: AdminAgentActionServices,
): Promise<ActionPlan> {
  const input = objectInput(payload, "EOD review payload");
  rejectUnknownFields(input, EOD_REVIEW_FIELDS, "admin EOD review action");
  const rawReportId = input.report_id;
  if (typeof rawReportId !== "string" || !rawReportId.trim()) {
    throw new WorkOsValidationError("report_id is required");
  }
  const reportId = rawReportId.trim();
  const decision = input.status;
  if (decision !== "approved" && decision !== "rejected") {
    throw new WorkOsValidationError("status must be approved or rejected");
  }
  // An absent or empty note is no note: the review service accepts a string
  // only, so an explicit null is collapsed rather than sent through. Notes are
  // free text, so they get the same generous bound as a description.
  const managerNotes = textField(input, "manager_notes", DESCRIPTION_MAX) || undefined;
  const markdown = textField(input, "markdown", DESCRIPTION_MAX) || undefined;

  const report = await services.getEod(access, reportId);
  if (!isRecord(report) || !stringField(report, "id") || !stringField(report, "status")) {
    throw new WorkOsNotFoundError("EOD report not found");
  }
  const currentStatus = stringField(report, "status") as string;
  const warnings: string[] = [];
  const author = eodPersonId(report);
  if (author && author === reviewerPersonId(access)) {
    warnings.push("This is your own report; the decision will be refused. Another manager must review it.");
  }
  if (currentStatus !== "pending_review") {
    warnings.push(`This report is already ${currentStatus}; only a pending report can be reviewed.`);
  }
  if (markdown !== undefined) {
    warnings.push("A manager edit replaces the employee's submitted text with this version.");
  }

  const changes: AdminPreviewChange[] = [change("status", currentStatus, decision)];
  if (managerNotes !== undefined) changes.push(change("manager_notes", eodManagerNotes(report), managerNotes));

  const request: Json = { report_id: reportId, status: decision };
  if (managerNotes !== undefined) request.manager_notes = managerNotes;
  if (markdown !== undefined) request.markdown = markdown;

  return {
    summary: eodSummary(decision, report),
    changes,
    warnings,
    state: adminEodPreviewState(report),
    targetType: "eod",
    targetId: reportId,
    request,
    task: null,
    auditTarget: { type: "work_report", id: reportId },
    run: async (actor) => {
      const body: Json = { status: decision };
      if (managerNotes !== undefined) body.manager_notes = managerNotes;
      if (markdown !== undefined) body.markdown = markdown;
      const result = await services.reviewEod(
        access,
        reportId,
        body,
        actor ? actor.reviewerPersonId : reviewerPersonId(access),
      );
      return { status: 200, body: result, targetId: reportId };
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
    case "task.complete":
      return planCompletion(access, payload, services, true);
    case "task.reopen":
      return planCompletion(access, payload, services, false);
    case "task.archive":
      return planRemoval(access, payload, services, "archive");
    case "task.delete":
      return planRemoval(access, payload, services, "delete");
    case "eod.review":
      return planEodReview(access, payload, services);
    default:
      throw new WorkOsValidationError(`Action ${String(action)} is not supported by this surface`);
  }
}

/** Describe one action without writing anything. The `run` closure is only
 * invoked by `applyAdminAction`, so a preview route can never execute a
 * consequential write by accident. `request` is the resolved payload the
 * preview store must persist; `state` is the target as it was before the
 * action, which is what the confirm path fingerprints. */
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
    request: plan.request,
  };
}

/** Execute a confirmed preview and record who did it. Pass the stored
 * `preview.request` as `payload` and the stored `preview.state` as
 * `expectedState`; a target that moved since the preview answers
 * `409 preview_stale` before any write. `actor.previewId` is the create
 * idempotency key, so a retry after a failed audit returns the first task
 * instead of creating a second one. */
export async function applyAdminAction(
  access: WorkOsAccess,
  action: AdminPreviewAction,
  payload: Json,
  services: AdminAgentActionServices,
  actor: AdminActionActor,
  expectedState?: Json,
): Promise<{ status: number; body: Json }> {
  const plan = await planAdminAction(access, action, payload, services);
  if (expectedState !== undefined && action !== "task.create") {
    // `plan.state` is the fresh projection the plan itself was built from, so a
    // task and an EOD report compare through the same stored fingerprint.
    if (previewFingerprint(plan.state) !== previewFingerprint(expectedState)) {
      throw new WorkOsConflictError("This change is stale; refresh it", "preview_stale");
    }
  }
  const result = await plan.run(actor);
  const resultTask = taskRow(result.body);
  const target = plan.auditTarget
    ?? { type: auditTargetType(resultTask), id: auditTargetId(resultTask, result.targetId) };
  await audit(access, `admin.${action}`, target.type, target.id, {
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
    // The preview needs the children a removal cascades to and the evidence a
    // completion requires; the detail read already loads both.
    return {
      ...(details.task as Json),
      subtasks: details.subtasks as unknown as Json,
      completion_evidence: details.completionEvidence as unknown as Json,
    };
  },
  createTask: async (access, payload, options = {}) => {
    try {
      return await createWorkOsEmployeeTask(access, payload, options.actor, options.idempotencyKey) as Json;
    } catch (error) {
      // A retry after a successful create with a failed follow-up write hits
      // the (organization, token, key) unique index; return the row the first
      // attempt created instead of surfacing a duplicate-key failure.
      if (!options.actor || !options.idempotencyKey) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate key|unique constraint|already exists/i.test(message)) throw error;
      const { data, error: loadError } = await db().from("work_tasks").select("*")
        .eq("organization_id", access.organizationId)
        .eq("agent_token_id", options.actor.tokenId)
        .eq("agent_idempotency_key", options.idempotencyKey)
        .maybeSingle();
      if (loadError) throw new Error(`reconcile admin task create: ${loadError.message}`);
      if (!data) throw error;
      return data as Json;
    }
  },
  updateTask: (access, taskId, payload) => updateWorkOsAdminTask(access, taskId, payload),
  moveTask: (access, taskId, parentTaskId) =>
    moveWorkOsEmployeeSubtask(access, taskId, { parent_task_id: parentTaskId }) as unknown as Promise<Json>,
  completeTask: (access, taskId, completed) => updateWorkOsAdminTask(access, taskId, { completed }),
  archiveTask: (access, taskId, mode) => removeWorkOsAdminTask(access, taskId, mode),
  getEod: async (access, reportId) => {
    const found = await getAdminAgentEod(access, reportId);
    return (found?.eod ?? {}) as Json;
  },
  reviewEod: (access, reportId, body, reviewerPersonId) =>
    reviewAdminAgentEod(access, reportId, body as unknown as AdminAgentEodReviewInput, reviewerPersonId),
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
