import {
  addTaskProgress,
  createEvidence,
  DEFAULT_NIFTY_LEDGER_PROJECT_ID,
  getTaskByLocalOrProviderId,
  isNiftyTaskAttributableToMember,
  syncNiftyTask,
  updateTask,
} from "@/lib/work-os";
import { addDaysIso } from "@/lib/work-os-dates";
import { randomUUID } from "node:crypto";
import { activeSession } from "@/lib/work-os-workday";
import {
  audit,
  db,
  nonEmptyString as text,
  organizationOwnerId,
  type Json,
  type ProposalOperation,
} from "@/lib/work-os-internal";
import {
  archiveWorkOsEmployeeTask,
  createWorkOsEmployeeTask,
  deleteWorkOsEmployeeTask,
  getWorkOsTaskCreationOptions,
  listWorkOsEmployeeTaskSelection,
  setWorkOsEmployeeTaskCompletion,
  withTimeout,
} from "@/lib/work-os-employee-tasks";
import type { WorkOsAccess } from "@/lib/work-os-api";

/** A provider refresh inside an approval must be bounded: token refresh and
 * nested requests can otherwise outlive the companion's filing timeout. */
const STALENESS_REFRESH_TIMEOUT_MS = 5_000;

type InterpretedOperation = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task"
  | "add_task" | "archive_task" | "delete_task" | "modify_task_description" | "modify_task_status"
  | "add_subtask" | "modify_subtask" | "delete_subtask" | "display_pending_tasks" | "display_overdue_tasks"
  | "multi_task_add" | "multi_task_edit" | "multi_task_archive" | "multi_task_delete"
  | "multi_task_log" | "multi_task_reassign" | "plan_import";

/** A batch entry's step. clientId is the agent's stable handle for the item. */
export interface InterpretedBatchSubtask {
  clientId: string;
  title: string;
  description?: string;
}

/** One entry of a multi_task_add / multi_task_edit payload. */
export interface InterpretedBatchTask {
  clientId: string;
  taskId?: string;
  title?: string;
  description?: string;
  taskGroupId?: string;
  completed?: boolean;
  assigneePersonId?: string;
  dueDate?: string;
  subtasks: InterpretedBatchSubtask[];
}

export interface InterpretedOperationEntry {
  op: InterpretedOperation;
  statement: string;
  taskId?: string;
  taskTitle?: string;
  taskGroupId?: string;
  limit?: number;
  tasks?: InterpretedBatchTask[];
  /** plan_import only: which blueprint to materialize, and how to name it. */
  blueprintId?: string;
  clientName?: string;
  startDate?: string;
}

const BATCH_OPERATIONS = ["multi_task_add", "multi_task_edit", "multi_task_archive", "multi_task_delete", "multi_task_log", "multi_task_reassign"];
const BATCH_TASK_LIMIT = 20;
const BATCH_ITEM_LIMIT = 40;
const BATCH_DESCRIPTION_LIMIT = 20_000;

/** Shape validation for a batch payload. The interpret layer already normalized
 * it for the assistant path, but this endpoint also accepts a client-built
 * operation list, so nothing is trusted here: ids are resolved against Work OS
 * in the filing loop, and every string is capped before it reaches a row. */
function interpretedBatchTasks(op: InterpretedOperation, value: unknown): InterpretedBatchTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: InterpretedBatchTask[] = [];
  let itemCount = 0;
  for (const rawTask of value.slice(0, BATCH_TASK_LIMIT)) {
    if (!rawTask || typeof rawTask !== "object") continue;
    const entry = rawTask as Json;
    const taskId = text(entry.task_id);
    const rawTitle = text(entry.title);
    const title = rawTitle ? rawTitle.slice(0, 240) : undefined;
    const rawDescription = text(entry.description);
    const description = rawDescription ? rawDescription.slice(0, BATCH_DESCRIPTION_LIMIT) : undefined;
    const rawTaskGroupId = text(entry.task_group_id);
    const taskGroupId = rawTaskGroupId ? rawTaskGroupId.slice(0, 160) : undefined;
    const completed = typeof entry.completed === "boolean" ? entry.completed : undefined;
    const rawDue = text(entry.due_date)?.slice(0, 10);
    const dueDate = rawDue && /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : undefined;
    const subtasks: InterpretedBatchSubtask[] = [];
    if (Array.isArray(entry.subtasks)) {
      for (const rawSubtask of entry.subtasks.slice(0, BATCH_TASK_LIMIT)) {
        if (itemCount >= BATCH_ITEM_LIMIT) break;
        if (!rawSubtask || typeof rawSubtask !== "object") continue;
        const subtask = rawSubtask as Json;
        const rawSubtaskTitle = text(subtask.title);
        if (!rawSubtaskTitle) continue;
        const rawSubtaskDescription = text(subtask.description);
        subtasks.push({
          clientId: text(subtask.client_id)?.slice(0, 80) ?? `s${subtasks.length + 1}`,
          title: rawSubtaskTitle.slice(0, 240),
          description: rawSubtaskDescription ? rawSubtaskDescription.slice(0, BATCH_DESCRIPTION_LIMIT) : undefined,
        });
        itemCount += 1;
      }
    }
    if (op === "multi_task_add") {
      if (!taskId && !title) continue;
    } else if (op === "multi_task_edit") {
      if (!taskId || (!title && !description && !taskGroupId && completed === undefined)) continue;
    } else if (op === "multi_task_log") {
      if (!taskId || !description) continue;
    } else if (op === "multi_task_archive" || op === "multi_task_delete" || op === "multi_task_reassign") {
      // Named targets only. (Spelled out so the outbox test's source slice,
      // which anchors on the single-proposal guard below, is not confused.)
      if (taskId === null || taskId === undefined || taskId === "") continue;
    } else if (!taskId || (!title && !description && !taskGroupId && completed === undefined)) {
      continue;
    }
    // A new task counts against the item budget; a step-only entry on an
    // existing task does not.
    const creatingTask = taskId === null || taskId === undefined || taskId === "";
    if (creatingTask && itemCount >= BATCH_ITEM_LIMIT) break;
    if (creatingTask) itemCount += 1;
    tasks.push({
      clientId: text(entry.client_id)?.slice(0, 80) ?? `t${tasks.length + 1}`,
      taskId: taskId ?? undefined,
      title,
      description,
      taskGroupId,
      completed,
      assigneePersonId: text(entry.assignee_person_id)?.slice(0, 80) ?? undefined,
      dueDate,
      subtasks,
    });
  }
  return tasks;
}

/** Exported for the batch contract tests. */
export function interpretedOperations(value: unknown): InterpretedOperationEntry[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("Choose between 1 and 20 proposed updates");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Proposed update ${index + 1} is invalid`);
    const row = entry as Json;
    const op = text(row.op) as InterpretedOperation | null;
    const statement = text(row.statement);
    const taskId = text(row.task_id);
    const taskTitle = text(row.task_title);
    const taskGroupId = text(row.task_group_id);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(row.limit) || 20)));
    if (!op || !["record_progress", "record_blocker", "complete_task", "reopen_task", "create_task", "add_task", "archive_task", "delete_task", "modify_task_description", "modify_task_status", "add_subtask", "modify_subtask", "delete_subtask", "display_pending_tasks", "display_overdue_tasks", "multi_task_add", "multi_task_edit", "multi_task_archive", "multi_task_delete", "multi_task_log", "multi_task_reassign", "plan_import"].includes(op) || !statement || statement.length > 1000) {
      throw new Error(`Proposed update ${index + 1} is invalid`);
    }
    const batch = BATCH_OPERATIONS.includes(op);
    if (!batch && op !== "plan_import" && !["create_task", "add_task", "display_pending_tasks", "display_overdue_tasks"].includes(op) && !taskId) throw new Error(`Proposed update ${index + 1} requires a task`);
    if (["create_task", "add_task", "add_subtask"].includes(op) && (taskTitle ?? statement).length > 240) throw new Error("Task title must be 240 characters or fewer");
    if (op === "modify_task_status" && !taskGroupId) throw new Error("task_group_id is required for a Nifty status move");
    const tasks = batch ? interpretedBatchTasks(op, row.tasks) : undefined;
    if (batch && !tasks?.length) throw new Error(`Proposed update ${index + 1} carries no tasks`);
    const blueprintId = text(row.blueprint_id)?.slice(0, 80) ?? undefined;
    if (op === "plan_import" && !blueprintId) throw new Error(`Proposed update ${index + 1} requires a blueprint`);
    const rawStart = text(row.start_date)?.slice(0, 10);
    return {
      op,
      statement,
      taskId: taskId ?? undefined,
      taskTitle: taskTitle ?? undefined,
      taskGroupId: taskGroupId ?? undefined,
      limit,
      tasks,
      ...(op === "plan_import" ? {
        blueprintId,
        clientName: text(row.client_name)?.slice(0, 120) ?? undefined,
        startDate: rawStart && /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : undefined,
      } : {}),
    };
  });
}

/** One reviewable item: a single operation, or one child of a batch. */
export interface PreparedProposal {
  /** The stored proposal operation. */
  providerOperation: ProposalOperation;
  /** Index of the operation the client sent, so its card can be matched back. */
  clientOperationIndex: number;
  /** Grouping metadata for a batch child; null for a standalone operation. */
  batch: {
    id: string;
    kind: "multi_task_add" | "multi_task_edit" | "multi_task_archive" | "multi_task_delete" | "multi_task_log" | "multi_task_reassign";
    index: number;
    clientId: string;
    parentClientId?: string;
  } | null;
  taskId?: string;
  taskGroupId?: string;
  /** A reassignment names the person; the filing loop resolves their member id. */
  assigneePersonId?: string;
  /** The stored proposed_change, built here so singles keep their exact shape. */
  change: Json;
}

function providerOperationFor(op: InterpretedOperation): ProposalOperation {
  return op === "record_progress" ? "log_progress"
    : op === "record_blocker" ? "add_blocker"
    : op === "add_task" ? "create_task"
    : op === "modify_task_description" || op === "modify_task_status" || op === "modify_subtask" ? "update_task"
    : op === "add_subtask" ? "add_subtask"
    : op === "delete_subtask" ? "delete_task"
    : op === "display_pending_tasks" || op === "display_overdue_tasks" ? "display_tasks"
    : op as ProposalOperation;
}

function singleOperationChange(operation: InterpretedOperationEntry): Json {
  if (operation.op === "create_task" || operation.op === "add_task") {
    return {
      name: operation.taskTitle ?? operation.statement.slice(0, 240),
      description: operation.statement,
      task_authority: "work_os",
    };
  }
  if (operation.op === "record_progress") return { summary: operation.statement };
  if (operation.op === "record_blocker") return { description: operation.statement };
  if (operation.op === "modify_task_description" || operation.op === "modify_subtask") return { description: operation.statement };
  if (operation.op === "modify_task_status") return { task_group_id: operation.taskGroupId as string };
  if (operation.op === "add_subtask") return { name: operation.taskTitle ?? operation.statement.slice(0, 240), description: operation.statement };
  if (operation.op === "display_pending_tasks" || operation.op === "display_overdue_tasks") {
    return { view: operation.op === "display_overdue_tasks" ? "overdue" : "pending", limit: operation.limit };
  }
  return {};
}

/**
 * Flattens the operation list into reviewable items. A batch expands into the
 * existing per-item operations so every entry keeps the exactly-once provider
 * path; the batch metadata is what lets the client draw one card and file the
 * items together.
 */
/** Exported for the batch contract tests. */
export function prepareProposals(operations: InterpretedOperationEntry[]): PreparedProposal[] {
  const prepared: PreparedProposal[] = [];
  operations.forEach((operation, clientOperationIndex) => {
    if (BATCH_OPERATIONS.includes(operation.op)) {
      const id = randomUUID();
      const kind = operation.op as "multi_task_add" | "multi_task_edit" | "multi_task_archive" | "multi_task_delete" | "multi_task_log" | "multi_task_reassign";
      let batchIndex = 0;
      const group = (clientId: string, parentClientId?: string) => ({
        id,
        kind,
        index: batchIndex++,
        clientId,
        ...(parentClientId ? { parentClientId } : {}),
      });
      for (const task of operation.tasks ?? []) {
        // The archive / delete / log / reassign tools act on existing tasks only,
        // each on its own existing write path.
        if (kind === "multi_task_archive" || kind === "multi_task_delete") {
          prepared.push({
            providerOperation: kind === "multi_task_archive" ? "archive_task" : "delete_task",
            clientOperationIndex,
            batch: group(task.clientId),
            taskId: task.taskId,
            change: {},
          });
          continue;
        }
        if (kind === "multi_task_log") {
          prepared.push({
            providerOperation: "log_progress",
            clientOperationIndex,
            batch: group(task.clientId),
            taskId: task.taskId,
            change: { summary: task.description },
          });
          continue;
        }
        if (kind === "multi_task_reassign") {
          // local person id is resolved in the filing loop, where the
          // caller's allowed people are already loaded.
          prepared.push({
            providerOperation: "update_task",
            clientOperationIndex,
            batch: group(task.clientId),
            taskId: task.taskId,
            assigneePersonId: task.assigneePersonId,
            change: {},
          });
          continue;
        }
        if (kind === "multi_task_add" && task.taskId) {
          // Steps attached to a task that already exists: the parent is known.
          for (const subtask of task.subtasks) {
            prepared.push({
              providerOperation: "add_subtask",
              clientOperationIndex,
              batch: group(subtask.clientId, task.clientId),
              taskId: task.taskId,
              change: { name: subtask.title, ...(subtask.description ? { description: subtask.description } : {}) },
            });
          }
          continue;
        }
        if (kind === "multi_task_add") {
          prepared.push({
            providerOperation: "create_task",
            clientOperationIndex,
            batch: group(task.clientId),
            change: {
              name: task.title,
              ...(task.description ? { description: task.description } : {}),
              ...(task.dueDate ? { due_date: task.dueDate } : {}),
              task_authority: "work_os",
            },
          });
          for (const subtask of task.subtasks) {
            // The parent does not exist yet; parent_client_id resolves it when
            // the batch is filed, in index order.
            prepared.push({
              providerOperation: "add_subtask",
              clientOperationIndex,
              batch: group(subtask.clientId, task.clientId),
              change: { name: subtask.title, ...(subtask.description ? { description: subtask.description } : {}) },
            });
          }
          continue;
        }
        // multi_task_edit: wording/status first, then completion, so a single
        // entry may legitimately produce two reviewable items.
        if (task.title || task.description || task.taskGroupId) {
          prepared.push({
            providerOperation: "update_task",
            clientOperationIndex,
            batch: group(task.clientId),
            taskId: task.taskId,
            taskGroupId: task.taskGroupId,
            change: {
              ...(task.title ? { name: task.title } : {}),
              ...(task.description ? { description: task.description } : {}),
              ...(task.taskGroupId ? { task_group_id: task.taskGroupId } : {}),
            },
          });
        }
        if (task.completed !== undefined) {
          prepared.push({
            providerOperation: task.completed ? "complete_task" : "reopen_task",
            clientOperationIndex,
            batch: group(task.clientId),
            taskId: task.taskId,
            change: {},
          });
        }
      }
      return;
    }
    prepared.push({
      providerOperation: providerOperationFor(operation.op),
      clientOperationIndex,
      batch: null,
      taskId: operation.taskId,
      taskGroupId: operation.taskGroupId,
      change: singleOperationChange(operation),
    });
  });
  return prepared;
}

export async function listWorkOsProposals(access: WorkOsAccess, personId: string, status?: string | string[] | null) {
  let query = db()
    .from("work_task_proposals")
    .select("*, task:work_tasks(id, title, provider_task_id)")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (Array.isArray(status)) {
    if (!status.length) return [];
    query = query.in("status", status);
  } else if (status) {
    query = query.eq("status", status);
  }
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS proposals: ${error.message}`);
  return data ?? [];
}

/** Single proposal readback, owner-scoped. The companion uses it to reconcile
 * an approval whose response was interrupted: it can distinguish "applied",
 * a real failure reason, and "still processing" instead of guessing. */
export async function getWorkOsProposal(access: WorkOsAccess, proposalId: string) {
  const { data, error } = await db().from("work_task_proposals")
    .select("id,operation,status,failure_reason,updated_at,decided_at,provider_result,provider_create_issued_at")
    .eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string)
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(`load Work OS proposal: ${error.message}`);
  if (!data) throw new Error("Proposal not found");
  return { ...data, create_intent_unresolved: proposalCreateIntentUnresolved(data as Json) };
}


/** Truthy when a timestamp column is set. The pg driver returns timestamptz
 * columns as Date objects, so a string-only check silently reads null. */
function hasTimestamp(value: unknown): boolean {
  return value instanceof Date
    ? !Number.isNaN(value.getTime())
    : typeof value === "string" && value.trim().length > 0;
}

/** True when a create_task proposal dispatched a provider create that was never
 * resolved by a recorded provider id: the outcome is unknown, and the companion
 * offers the employee the clear-and-retry recovery instead of a dead end. */
export function proposalCreateIntentUnresolved(row: Json): boolean {
  return row.operation === "create_task" && hasTimestamp(row.provider_create_issued_at);
}

async function applyProposal(
  access: WorkOsAccess,
  proposal: Json,
  applyAttempt: string,
  opts: { firstAttempt: boolean; confirmedNoTaskCreated?: boolean },
) {
  const operation = proposal.operation as ProposalOperation;
  const change = proposal.proposed_change as Json;
  if (operation === "remove_from_plan") {
    const planItemId = text(change.plan_item_id) ?? text((proposal.before_state as Json | undefined)?.plan_item_id);
    if (!planItemId) throw new Error("plan_item_id is required for a removal proposal");
    const { data, error } = await db().from("work_daily_plan_items").update({
      disposition: "removed",
      updated_at: new Date().toISOString(),
    }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId)
      .eq("disposition", "removal_proposed").select("*").maybeSingle();
    if (error) throw new Error(`remove task from daily plan: ${error.message}`);
    if (data) return data;
    const { data: current, error: currentError } = await db().from("work_daily_plan_items").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId).maybeSingle();
    if (currentError) throw new Error(`reconcile removed plan item: ${currentError.message}`);
    if (current?.disposition === "removed") return current;
    throw new Error("Removal proposal is no longer pending review.");
  }
  const ownerId = await organizationOwnerId(access.organizationId);
  const taskId = text(proposal.task_id) ?? text((proposal.before_state as Json | undefined)?.id);
  if (operation === "display_tasks") {
    return listWorkOsEmployeeTaskSelection(access, change.view === "overdue" ? "overdue" : "pending", change.limit);
  }
  if (operation === "create_task") {
    // Work OS owns task creation now: Nifty is a read-only backup, so every
    // proposal lands in the local record even when a legacy change omits
    // task_authority.
    const marker = `Work OS proposal: ${proposal.id}`;
    const { data: existing, error: existingError } = await db().from("work_tasks").select("*")
      .eq("organization_id", access.organizationId)
      .eq("provider", "local")
      .contains("raw", { proposalId: proposal.id })
      .maybeSingle();
    if (existingError) throw new Error(`reconcile Work OS task proposal: ${existingError.message}`);
    if (existing) return existing;
    return createWorkOsEmployeeTask(access, {
      ...change,
      description: [text(change.description), marker].filter(Boolean).join("\n\n"),
      assignee_person_ids: access.personId ? [access.personId] : [],
      local_proposal_id: proposal.id,
    });
  }
  if (!taskId) throw new Error("proposal task is required");
  if (operation === "add_subtask") {
    return createWorkOsEmployeeTask(access, {
      name: text(change.name) ?? "Untitled subtask",
      description: text(change.description) ?? undefined,
      parent_task_id: taskId,
    });
  }
  if (operation === "archive_task") return archiveWorkOsEmployeeTask(access, taskId);
  if (operation === "delete_task") return deleteWorkOsEmployeeTask(access, taskId);
  if (operation === "update_task") {
    const patch: Json = { ...change };
    if (text(change.title) && !text(change.name)) patch.name = change.title;
    return updateTask(ownerId, taskId, patch);
  }
  if (operation === "log_progress") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data: existing, error: existingError } = await db().from("work_evidence").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .contains("raw", { note: { proposal_id: proposal.id } }).maybeSingle();
    if (existingError) throw new Error(`reconcile proposal progress: ${existingError.message}`);
    if (existing) return existing;
    return addTaskProgress(ownerId, taskId, {
      person_id: proposal.person_id,
      title: text(change.title) ?? undefined,
      summary: text(change.summary) ?? text(change.progress) ?? proposal.input_text,
      url: text(change.url),
      source: "manual",
      proposal_id: proposal.id,
    });
  }
  if (operation === "link_evidence") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data: existing, error: existingError } = await db().from("work_evidence").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .contains("raw", { proposal_id: proposal.id }).maybeSingle();
    if (existingError) throw new Error(`reconcile linked evidence: ${existingError.message}`);
    if (existing) return existing;
    return createEvidence(ownerId, {
      person_id: proposal.person_id,
      task_id: task.id,
      source: "manual",
      title: text(change.title) ?? "Employee-linked evidence",
      summary: text(change.summary) ?? proposal.input_text,
      url: text(change.url),
      raw: { proposal_id: proposal.id },
    }, access.organizationId);
  }
  if (operation === "add_blocker") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const description = text(change.description) ?? text(change.blocked_reason) ?? text(proposal.input_text);
    if (!description) throw new Error("blocker description is required");
    const { data: existing, error: existingError } = await db().from("work_task_blockers").select("*")
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string)
      .eq("person_id", proposal.person_id as string).eq("description", description).eq("status", "active").maybeSingle();
    if (existingError) throw new Error(`reconcile task blocker: ${existingError.message}`);
    if (existing) {
      // Heal the retry: the blocker row exists from an earlier attempt, but
      // the task flag may not have been written before that attempt failed.
      await updateTask(ownerId, taskId, { blocked: true, blocked_reason: description });
      return existing;
    }
    const { data, error } = await db().from("work_task_blockers").insert({
      organization_id: access.organizationId,
      task_id: task.id,
      person_id: proposal.person_id,
      description,
      created_by: access.ctx.user.id,
    }).select("*").single();
    if (error) throw new Error(`create task blocker: ${error.message}`);
    await updateTask(ownerId, taskId, { blocked: true, blocked_reason: description });
    return data;
  }
  if (operation === "resolve_blocker") {
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    const { data, error } = await db().from("work_task_blockers").update({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("organization_id", access.organizationId).eq("task_id", task.id as string).eq("status", "active").select("*");
    if (error) throw new Error(`resolve task blocker: ${error.message}`);
    await updateTask(ownerId, taskId, { blocked: false, blocked_reason: null });
    return data;
  }
  if (operation === "complete_task") {
    return setWorkOsEmployeeTaskCompletion(access, taskId, true);
  }
  if (operation === "reopen_task") {
    return setWorkOsEmployeeTaskCompletion(access, taskId, false);
  }
  throw new Error("unsupported proposal operation");
}

/** Resolves one referenced task straight from Work OS and verifies the
 * employee may act on it: assigned to them, or — only for the configured
 * ledger project — attributable through the creator/subscriber metadata a
 * legacy imported row carries. The organization scope keeps a shared owner
 * account from reaching another workspace's tasks. */
async function resolveProposalTask(input: {
  ownerId: string;
  organizationId: string;
  personId: string;
  ledgerProjectId: string;
  niftyMemberId: string | null;
  taskId: string;
}): Promise<Json> {
  let task: Json;
  try {
    task = await getTaskByLocalOrProviderId(input.ownerId, input.taskId);
  } catch (error) {
    // Only a genuine not-found means the task left the list; provider,
    // authorization, and database failures keep their real message so the
    // caller is not told to refresh when the backend is broken.
    const message = error instanceof Error ? error.message : "";
    if (!/not found|no rows|does not exist/i.test(message)) throw error;
    throw new Error("That task is no longer in your task list. Refresh and try again.");
  }
  if (["archived", "deleted"].includes(String(task.status ?? ""))) throw new Error("That task was removed from your task list.");
  const taskOrganizationId = text(task.organization_id);
  if (taskOrganizationId && taskOrganizationId !== input.organizationId) throw new Error("That task is not assigned to you.");
  const assigned = Array.isArray(task.assignee_person_ids) && (task.assignee_person_ids as unknown[]).includes(input.personId);
  const attributable = text(task.provider_project_id) === input.ledgerProjectId
    && isNiftyTaskAttributableToMember(task, input.niftyMemberId);
  if (!assigned && !attributable) throw new Error("That task is not assigned to you.");
  return task;
}

/** A status move needs an existing status column for the task's own project.
 * The candidate id is checked directly so a large project cannot cap the
 * query and reject a valid column. */
export interface WorkOsProposalRow extends Json {
  id?: string;
  operation?: string;
  status?: string;
  batch_id?: string | null;
  batch_index?: number | null;
  batch_kind?: string | null;
  client_id?: string | null;
  parent_client_id?: string | null;
  task_id?: string | null;
  provider_result?: Json;
  before_state?: Json;
  proposed_change?: Json;
  decided_change?: Json | null;
  failure_reason?: string | null;
  outcome?: string;
  create_intent_unresolved?: boolean;
}

/**
 * Validates the editable fields an employee may change on the review card.
 * Only the fields that belong to the operation survive, capped exactly like
 * the drafted path, so an edited approval can never widen what the agent was
 * allowed to propose.
 */
/** Exported for the batch contract tests. */
export function proposalDecisionEdits(operation: string, value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Json;
  const edits: Json = {};
  const name = text(source.name);
  if (name) edits.name = name.slice(0, 240);
  if ("description" in source) {
    const description = text(source.description);
    edits.description = description ? description.slice(0, 20_000) : null;
  }
  const taskGroupId = text(source.task_group_id);
  if (taskGroupId) edits.task_group_id = taskGroupId.slice(0, 160);
  const editable =
    operation === "create_task" ? ["name", "description"]
    : operation === "add_subtask" ? ["name", "description"]
    : operation === "update_task" ? ["name", "description", "task_group_id"]
    : [];
  const narrowed: Json = {};
  for (const key of editable) {
    if (key in edits) narrowed[key] = edits[key];
  }
  return Object.keys(narrowed).length ? narrowed : null;
}

/** Batch cards can deliberately remove a proposed optional field. Keep this
 * separate from `edits`: an omitted field means "leave the proposal as-is",
 * while `clear_fields` means the employee explicitly took it back. */
export function proposalDecisionClearFields(operation: string, value: unknown): string[] {
  if (operation !== "update_task" || !Array.isArray(value)) return [];
  const allowed = new Set(["description", "task_group_id"]);
  return [...new Set(value.filter((field): field is string => typeof field === "string" && allowed.has(field)))];
}

/** The human name of a status column, read from any task already sitting in it.
 * Used only for display on the review card; an unresolvable name stays null. */
async function resolveTaskGroupName(ownerId: string, task: Json, taskGroupId: string): Promise<string | null> {
  const taskProjectId = text(task.provider_project_id);
  if (!taskProjectId) return null;
  const { data, error } = await db().from("work_tasks").select("status")
    .eq("user_id", ownerId).eq("provider_project_id", taskProjectId).eq("task_group_id", taskGroupId).limit(1);
  if (error) return null;
  return text((data?.[0] as { status?: string } | undefined)?.status) ?? null;
}

async function assertKnownTaskGroup(ownerId: string, task: Json, taskGroupId: string | null, input: string, opts?: { requireInInput?: boolean }) {
  if (!taskGroupId || ((opts?.requireInInput ?? true) && !input.includes(taskGroupId))) {
    throw new Error("A status move requires an existing status column for this project.");
  }
  const taskProjectId = text(task.provider_project_id);
  if (!taskProjectId) throw new Error("A status move requires an existing status column for this project.");
  const { data, error } = await db().from("work_tasks").select("id")
    .eq("user_id", ownerId).eq("provider_project_id", taskProjectId).eq("task_group_id", taskGroupId).limit(1);
  if (error) throw new Error(`load task status column: ${error.message}`);
  if (!data?.length) throw new Error("A status move requires an existing status column for this project.");
}

/** Resolves the local person a batch reassignment names, scoped to the people
 * this caller may assign to (themselves, or anyone when they are an administrator). */
async function resolveBatchAssignee(access: WorkOsAccess, personId: string): Promise<string> {
  const options = await getWorkOsTaskCreationOptions(access);
  if (!options.people.some((person) => person.id === personId)) {
    throw new Error("You can only assign work to yourself unless you are an administrator.");
  }
  return personId;
}

/** Turns a plan_import into the same add-batch payload the assistant uses for
 * hand-written tasks, so it files through the identical per-item path. */
async function planImportTasks(ownerId: string, operation: InterpretedOperationEntry) {
  const { data: blueprint, error } = await db().from("work_blueprints").select("*")
    .eq("user_id", ownerId).eq("id", operation.blueprintId as string).maybeSingle();
  if (error) throw new Error(`load blueprint: ${error.message}`);
  if (!blueprint) throw new Error("That blueprint is no longer available.");
  const phases = Array.isArray(blueprint.phases) ? blueprint.phases as Array<{ name?: string; tasks?: Array<{ name?: string; offsetDays?: number; evidence?: string[] }> }> : [];
  const clientName = operation.clientName ?? null;
  const start = operation.startDate ?? null;
  const tasks = [] as NonNullable<InterpretedOperationEntry["tasks"]>;
  let index = 0;
  for (const phase of phases) {
    for (const item of phase.tasks ?? []) {
      const name = item.name ?? "Onboarding task";
      const evidence = (item.evidence ?? []).filter(Boolean);
      tasks.push({
        clientId: `b${index}`,
        title: (clientName ? `${clientName}: ${name}` : name).slice(0, 240),
        description: [`Blueprint: ${String(blueprint.name ?? "Blueprint")}`, `Phase: ${phase.name ?? "General"}`, evidence.length ? `Required evidence: ${evidence.join(", ")}` : null].filter(Boolean).join("\n"),
        ...(start ? { dueDate: addDaysIso(start, Number(item.offsetDays ?? 0)) } : {}),
        subtasks: evidence.map((step, stepIndex) => ({ clientId: `b${index}s${stepIndex}`, title: step.slice(0, 240) })),
      });
      index += 1;
    }
  }
  if (!tasks.length) throw new Error("That blueprint has no tasks to import.");
  return tasks;
}

/** Stores an assistant interpretation for review. This endpoint creates no
 * task mutation; only a later accepted proposal can apply one.
 *
 * Each operation resolves its task directly from Work OS (local or provider
 * id) instead of a paged provider view, so carried-over and recently created
 * tasks can never fall outside an arbitrary window. Failures are reported per
 * operation so one stale task cannot reject the whole batch. */
export async function proposeInterpretedWorkUpdate(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const input = text(body.input_text);
  if (!input || input.length > 4000) throw new Error("input_text is required");
  const operations = interpretedOperations(body.operations);
  const personId = access.personId as string;
  const ownerId = await organizationOwnerId(access.organizationId);
  const personResult = await db().from("work_people").select("nifty_member_id").eq("user_id", ownerId).eq("id", personId).maybeSingle();
  if (personResult.error) throw new Error(`load proposal person mapping: ${personResult.error.message}`);
  const niftyMemberId = (personResult.data?.nifty_member_id as string | null | undefined) ?? null;
  const ledgerProjectId = process.env.WORK_OS_NIFTY_LEDGER_PROJECT_ID?.trim() || DEFAULT_NIFTY_LEDGER_PROJECT_ID;
  const proposals: Array<Json & { client_operation_index: number }> = [];
  const failures: Array<{ client_operation_index: number; error: string }> = [];
  const resolved = new Map<string, Json>();
  // A plan import is materialized from its blueprint before expansion, so it
  // files through the same add-batch path as hand-written tasks. A blueprint
  // that cannot be read fails that operation only.
  const expanded: InterpretedOperationEntry[] = [];
  for (const [clientOperationIndex, operation] of operations.entries()) {
    if (operation.op !== "plan_import") {
      expanded.push(operation);
      continue;
    }
    try {
      expanded.push({ ...operation, op: "multi_task_add", tasks: await planImportTasks(ownerId, operation) });
    } catch (error) {
      failures.push({
        client_operation_index: clientOperationIndex,
        error: error instanceof Error && error.message ? error.message : "That blueprint could not be imported.",
      });
    }
  }
  const prepared = prepareProposals(expanded);
  for (const [index, item] of prepared.entries()) {
    try {
      const operationKey = `${idempotencyKey}:${index}`;
      const { data: existing, error: existingError } = await db().from("work_task_proposals").select("*")
        .eq("organization_id", access.organizationId).eq("person_id", personId).eq("idempotency_key", operationKey).maybeSingle();
      if (existingError) throw new Error(`load idempotent interpreted proposal: ${existingError.message}`);
      if (existing) {
        proposals.push({ ...(existing as Json), client_operation_index: item.clientOperationIndex });
        continue;
      }
      // A batch subtask whose parent is created in the same batch has no task id
      // yet: parent_client_id defers it until the batch is filed in order.
      const deferredParent = item.providerOperation === "add_subtask" && !item.taskId && !!item.batch?.parentClientId;
      const needsTask = !["create_task", "display_tasks"].includes(item.providerOperation) && !deferredParent;
      let task: Json | null = null;
      if (needsTask && item.taskId) {
        const cached = resolved.get(item.taskId);
        if (cached) {
          task = cached;
        } else {
          task = await resolveProposalTask({
            ownerId,
            organizationId: access.organizationId,
            personId,
            ledgerProjectId,
            niftyMemberId,
            taskId: item.taskId,
          });
          resolved.set(item.taskId, task);
        }
      }
      if (needsTask && !task) throw new Error("That task is no longer in your task list. Refresh and try again.");
      if (item.taskGroupId) {
        await assertKnownTaskGroup(ownerId, task as Json, item.taskGroupId, input);
      }
      const beforeState = task ? {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        completed: task.completed,
        due_date: task.due_date,
        start_date: task.start_date,
        task_group_id: task.task_group_id,
        assignee_person_ids: task.assignee_person_ids,
        parent_task_id: task.parent_task_id,
        parent_provider_task_id: task.parent_provider_task_id,
      } : {};
      // A status move records both names so a filed (or reloaded) card can keep
      // showing "In review → Done" with no extra lookups.
      const statusNames = item.taskGroupId && task
        ? { from_status: text(task.status), to_status: await resolveTaskGroupName(ownerId, task, item.taskGroupId) }
        : {};
      const proposedChange: Json = {
        ...item.change,
        ...statusNames,
        ...(item.assigneePersonId ? { assignee_person_ids: [await resolveBatchAssignee(access, item.assigneePersonId)] } : {}),
      };
      const { data: proposal, error: proposalError } = await db().from("work_task_proposals").insert({
        organization_id: access.organizationId,
        person_id: personId,
        task_id: task?.id ?? null,
        operation: item.providerOperation,
        input_text: input,
        before_state: beforeState,
        proposed_change: proposedChange,
        model: "desktop_interpretation",
        prompt_version: "desktop-interpretation-v1",
        idempotency_key: operationKey,
        created_by: access.ctx.user.id,
        batch_id: item.batch?.id ?? null,
        batch_index: item.batch?.index ?? null,
        batch_kind: item.batch?.kind ?? null,
        client_id: item.batch?.clientId ?? null,
        parent_client_id: item.batch?.parentClientId ?? null,
      }).select("*").single();
      if (proposalError) throw new Error(`create interpreted proposal: ${proposalError.message}`);
      await audit(access, "proposal.interpreted", "task_proposal", proposal.id as string, { operation: item.providerOperation, clientOperationIndex: item.clientOperationIndex });
      proposals.push({ ...(proposal as Json), client_operation_index: item.clientOperationIndex });
    } catch (error) {
      failures.push({
        client_operation_index: item.clientOperationIndex,
        error: error instanceof Error && error.message ? error.message : "That update could not be filed. Refresh and try again.",
      });
    }
  }
  return { proposals, failures };
}

async function restorePlanRemoval(access: WorkOsAccess, proposal: Json) {
  const before = (proposal.before_state ?? {}) as Json;
  const change = (proposal.proposed_change ?? {}) as Json;
  const planItemId = text(change.plan_item_id) ?? text(before.plan_item_id);
  const previousDisposition = text(before.disposition);
  if (!planItemId || !["selected", "deferred"].includes(previousDisposition ?? "")) return;
  const { error } = await db().from("work_daily_plan_items").update({
    disposition: previousDisposition,
    updated_at: new Date().toISOString(),
  }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId)
    .eq("disposition", "removal_proposed");
  if (error) throw new Error(`restore rejected plan removal: ${error.message}`);
}

export async function proposeWorkOsPlanRemoval(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const planItemId = text(body.plan_item_id);
  const reason = text(body.reason) ?? "No longer part of today's selected work.";
  if (!planItemId) throw new Error("plan_item_id is required");
  const { data: existing, error: existingError } = await db().from("work_task_proposals").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
    .eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingError) throw new Error(`load idempotent removal proposal: ${existingError.message}`);
  if (existing) return { proposal: existing };
  const { data: item, error: itemError } = await db().from("work_daily_plan_items").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", planItemId).single();
  if (itemError) throw new Error(`load daily plan item for removal: ${itemError.message}`);
  if (!item.task_id) throw new Error("Only task-backed plan items can be removed through review.");
  if (!["selected", "deferred"].includes(item.disposition as string)) throw new Error("This plan item is already pending removal or removed.");
  const { data: plan, error: planError } = await db().from("work_daily_plans").select("id,session_id,shift_date,status")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", item.plan_id).single();
  if (planError) throw new Error(`load daily plan for removal: ${planError.message}`);
  if (!["draft", "confirmed"].includes(String(plan.status))) throw new Error("Only an open daily plan can receive a removal proposal.");
  const session = await activeSession(access);
  if (!session || session.id !== plan.session_id) throw new Error("Only the current clocked-in plan can receive a removal proposal.");
  const beforeState = {
    plan_id: plan.id,
    plan_item_id: item.id,
    task_id: item.task_id,
    title_snapshot: item.title_snapshot,
    disposition: item.disposition,
    rank: item.rank,
  };
  const { data: proposal, error: proposalError } = await db().from("work_task_proposals").insert({
    organization_id: access.organizationId,
    person_id: access.personId,
    task_id: item.task_id,
    operation: "remove_from_plan",
    input_text: reason,
    before_state: beforeState,
    proposed_change: { plan_item_id: item.id, disposition: "removed", reason },
    model: "employee",
    prompt_version: "work-os-plan-removal-v1",
    idempotency_key: idempotencyKey,
    created_by: access.ctx.user.id,
  }).select("*").single();
  if (proposalError) {
    if (/duplicate|unique/i.test(proposalError.message)) {
      const reconciled = await db().from("work_task_proposals").select("*")
        .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
        .eq("idempotency_key", idempotencyKey).single();
      if (reconciled.error) throw new Error(`reconcile removal proposal: ${reconciled.error.message}`);
      return { proposal: reconciled.data };
    }
    throw new Error(`create plan removal proposal: ${proposalError.message}`);
  }
  const { data: updatedItem, error: updateError } = await db().from("work_daily_plan_items").update({
    disposition: "removal_proposed",
    updated_at: new Date().toISOString(),
  }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string).eq("id", item.id)
    .eq("disposition", item.disposition).select("*").maybeSingle();
  if (updateError) {
    await db().from("work_task_proposals").update({ status: "failed", failure_reason: `Could not reserve plan item for removal: ${updateError.message}`, updated_at: new Date().toISOString() }).eq("id", proposal.id).eq("status", "pending");
    throw new Error(`mark plan removal pending: ${updateError.message}`);
  }
  if (!updatedItem) {
    await db().from("work_task_proposals").update({ status: "failed", failure_reason: "The plan item changed before this removal proposal could be reserved.", updated_at: new Date().toISOString() }).eq("id", proposal.id).eq("status", "pending");
    throw new Error("The plan item changed before this removal proposal could be reserved.");
  }
  await audit(access, "proposal.removal_proposed", "task_proposal", proposal.id as string, { planItemId: item.id, taskId: item.task_id, reason });
  return { proposal, planItem: updatedItem };
}

/** Explicit outcome so clients never report a 200 as "recorded" when the
 * proposal was stale, rejected, or still applying. */
export function proposalOutcome(status: unknown): string {
  const value = typeof status === "string" ? status : "";
  return ["applied", "rejected", "applying", "stale", "failed", "needs_review", "pending"].includes(value) ? value : value || "unknown";
}

function withOutcome<T extends Json>(row: T): T & { outcome: string } {
  return { ...row, outcome: proposalOutcome(row.status) };
}

export async function reviewWorkOsProposal(access: WorkOsAccess, proposalId: string, body: Json) {
  const decision = text(body.decision);
  if (decision !== "accept" && decision !== "reject") throw new Error("decision must be accept or reject");
  const { data: proposal, error: loadError } = await db()
    .from("work_task_proposals")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("id", proposalId)
    .single();
  if (loadError) throw new Error(`load Work OS proposal: ${loadError.message}`);
  if (proposal.person_id !== access.personId) throw new Error("Only the proposal owner can accept or reject it");
  const decisionKey = text(body.decision_idempotency_key);
  // Employee edits made on the review card, validated against the operation
  // they belong to. The agent's original proposed_change is never overwritten.
  const decisionEdits = proposalDecisionEdits(String(proposal.operation), body.edits);
  const clearFields = proposalDecisionClearFields(String(proposal.operation), body.clear_fields);
  if (decision === "reject" && clearFields.length) throw new Error("clear_fields only applies to an accept decision");
  const decidedChange: Json | null = decisionEdits || clearFields.length
    ? { ...(decisionEdits ?? {}), ...(clearFields.length ? { clear_fields: clearFields } : {}) }
    : null;
  if (proposal.status === "applying") {
    const applyingSince = new Date(proposal.updated_at as string).getTime();
    if (Date.now() - applyingSince <= 5 * 60_000) return withOutcome(proposal);
    // The fence always matches the attempt that was stalled when it was read —
    // including a null attempt — so a lease a concurrent claimant just
    // replaced is never flipped back.
    let recovery = db().from("work_task_proposals").update({
      status: "failed",
      apply_attempt: null,
      failure_reason: "Previous provider application did not finalize; reconciling before retry.",
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying");
    recovery = proposal.apply_attempt
      ? recovery.eq("apply_attempt", proposal.apply_attempt as string)
      : recovery.is("apply_attempt", null);
    const { data: recovered, error: recoveryError } = await recovery.select("*").maybeSingle();
    if (recoveryError) throw new Error(`recover stalled Work OS proposal: ${recoveryError.message}`);
    if (recovered) Object.assign(proposal, recovered);
  }
  if (decisionKey && proposal.decision_idempotency_key === decisionKey && !["pending", "failed", "needs_review", "stale"].includes(proposal.status)) {
    // A replay must carry the same edits. An approval that already settled is
    // never silently rewritten by a different card state.
    if (JSON.stringify(proposal.decided_change ?? null) !== JSON.stringify(decidedChange)) {
      throw new Error("This update was already approved with different edits. Refresh to see the approved version.");
    }
    return withOutcome(proposal);
  }
  // Employee recovery for an uncertain provider create: "nothing was created in
  // Nifty" clears the recorded attempt so the accept files it exactly once.
  const resolution = text(body.provider_create_resolution);
  if (resolution && resolution !== "no_task_created") throw new Error("provider_create_resolution must be no_task_created");
  if (resolution && decision !== "accept") throw new Error("provider_create_resolution only applies to an accept decision");
  const confirmedNoTaskCreated = resolution === "no_task_created";
  if (confirmedNoTaskCreated && !proposalCreateIntentUnresolved(proposal as Json)) {
    throw new Error("This update has no unresolved Nifty create to clear.");
  }
  if (decision === "reject" && ["pending", "failed", "needs_review", "stale"].includes(proposal.status)) {
    if (proposal.operation === "remove_from_plan") await restorePlanRemoval(access, proposal as Json);
    const { data, error } = await db().from("work_task_proposals").update({
      status: "rejected",
      decided_by: access.ctx.user.id,
      decided_at: new Date().toISOString(),
      decision_idempotency_key: decisionKey,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).select("*").single();
    if (error) throw new Error(`reject Work OS proposal: ${error.message}`);
    await audit(access, "proposal.rejected", "task_proposal", proposalId);
    return withOutcome(data);
  }
  if (!["pending", "failed", "needs_review"].includes(proposal.status)) return withOutcome(proposal);
  const proposedChange = proposal.proposed_change as Json;
  const appliedChange: Json = { ...proposedChange };
  for (const field of clearFields) {
    delete appliedChange[field];
    // These are display-only metadata written alongside a status proposal; if
    // the status move is taken back, do not carry its labels into the apply.
    if (field === "task_group_id") {
      delete appliedChange.from_status;
      delete appliedChange.to_status;
    }
  }
  if (decisionEdits) Object.assign(appliedChange, decisionEdits);
  // An employee-chosen status column is validated against the project here;
  // unlike the drafted path, it need not appear verbatim in the input text
  // (the employee picked it from the card, the model did not invent it).
  if ((decisionEdits || clearFields.length) && text(appliedChange.task_group_id) !== text(proposedChange.task_group_id) && text(appliedChange.task_group_id)) {
    const ownerId = await organizationOwnerId(access.organizationId);
    const target = await getTaskByLocalOrProviderId(ownerId, (proposal.task_id as string) ?? "");
    await assertKnownTaskGroup(ownerId, target, text(appliedChange.task_group_id), "", { requireInInput: false });
  }
  // Completion and reopen are idempotent state writes whose target is
  // validated inside the employee task service, so unrelated provider drift
  // (title, due date, description) must not block an employee's check-off.
  const stalenessApplies = proposal.task_id
    && proposal.operation !== "remove_from_plan"
    && proposal.operation !== "complete_task"
    && proposal.operation !== "reopen_task";
  if (stalenessApplies) {
    try {
      const ownerId = await organizationOwnerId(access.organizationId);
      const target = await getTaskByLocalOrProviderId(ownerId, proposal.task_id as string);
      // Refresh only this one provider task. A full org sync takes minutes and
      // does not fit inside an approval request. The refresh is bounded too:
      // on timeout we compare against the last mirrored state and let the
      // idempotent write proceed instead of failing the employee's decision.
      // Work OS-native tasks have no provider record — the mirror is the
      // authority, so a refresh would only fail with a 404.
      if (target.provider !== "local" && text(target.provider_task_id)) {
        try {
          await withTimeout(syncNiftyTask(ownerId, String(target.provider_task_id)), STALENESS_REFRESH_TIMEOUT_MS, "Task refresh");
        } catch (refreshError) {
          // Only a timeout degrades to the mirrored state; real provider or
          // authorization failures must surface to the outer handler so a
          // conflicted approval is never applied blindly.
          if (!(refreshError instanceof Error) || !/timed out after/i.test(refreshError.message)) throw refreshError;
        }
      }
      const current = await getTaskByLocalOrProviderId(ownerId, proposal.task_id as string);
      const before = (proposal.before_state ?? {}) as Json;
       const keys = ["title", "description", "status", "completed", "due_date", "start_date", "task_group_id", "assignee_person_ids", "parent_task_id", "parent_provider_task_id"];
      if (keys.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(current[key] ?? null))) {
        const { data: stale, error: staleError } = await db().from("work_task_proposals").update({
          status: "stale", failure_reason: "The task changed after this proposal was drafted. Create a new proposal from the current task state.",
          decision_idempotency_key: decisionKey, decided_by: access.ctx.user.id, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", proposalId).select("*").single();
        if (staleError) throw new Error(`mark stale Work OS proposal: ${staleError.message}`);
        await audit(access, "proposal.stale", "task_proposal", proposalId);
        return withOutcome(stale);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Task refresh failed";
      await db().from("work_task_proposals").update({
        status: "failed",
        failure_reason: `Could not refresh the task before applying this proposal: ${reason}`,
        updated_at: new Date().toISOString(),
      }).eq("id", proposalId).in("status", ["pending", "failed", "needs_review"]);
      await audit(access, "proposal.refresh_failed", "task_proposal", proposalId, { reason });
      throw error;
    }
  }
  // Read before the claim: a proposal that was still pending has never been
  // applied, so its provider-side orphan search can be skipped.
  const firstAttempt = proposal.status === "pending";
  const applyAttempt = randomUUID();
  const { data: applying, error: applyingError } = await db().from("work_task_proposals").update({
    status: "applying",
    apply_attempt: applyAttempt,
    proposed_change: proposedChange,
    decided_change: decidedChange,
    decided_by: access.ctx.user.id,
    decided_at: new Date().toISOString(),
    decision_idempotency_key: decisionKey,
    failure_reason: null,
    updated_at: new Date().toISOString(),
  }).eq("id", proposalId).in("status", ["pending", "failed", "needs_review"]).select("*").maybeSingle();
  if (applyingError) throw new Error(`claim Work OS proposal: ${applyingError.message}`);
  if (!applying) {
    const { data } = await db().from("work_task_proposals").select("*").eq("id", proposalId).single();
    return data ? withOutcome(data) : data;
  }
  // Heartbeat keeps the lease fresh while the provider work runs, so a stalled
  // >5-minute recovery can only ever happen when this worker is actually gone.
  const heartbeat = setInterval(() => {
    void db().from("work_task_proposals").update({ updated_at: new Date().toISOString() })
      .eq("id", proposalId).eq("status", "applying").eq("apply_attempt", applyAttempt)
      .then(() => undefined, () => undefined);
  }, 60_000);
  try {
    const providerResult = await applyProposal(
      access,
      // Apply the employee's agreed values while proposed_change keeps the
      // agent's original wording for the audit trail.
      (decisionEdits || clearFields.length ? { ...(applying as Json), proposed_change: appliedChange } : applying) as Json,
      applyAttempt,
      { firstAttempt, confirmedNoTaskCreated },
    );
    const { data, error } = await db().from("work_task_proposals").update({
      status: "applied",
      provider_result: providerResult ?? {},
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying").eq("apply_attempt", applyAttempt).select("*").maybeSingle();
    if (error) throw new Error(`finalize Work OS proposal: ${error.message}`);
    if (!data) {
      // The lease was recovered by another attempt; never overwrite its state.
      await audit(access, "proposal.apply_lease_lost", "task_proposal", proposalId, { operation: proposal.operation });
      const { data: current } = await db().from("work_task_proposals").select("*").eq("id", proposalId).single();
      return current ? withOutcome(current) : proposal;
    }
    if (proposal.check_in_id) {
      await db().from("work_check_ins").update({ substantive: true }).eq("id", proposal.check_in_id as string);
    }
    if (["log_progress", "add_blocker", "complete_task", "reopen_task", "create_task", "archive_task", "delete_task", "add_subtask", "update_task"].includes(String(proposal.operation))) {
      const { error: sessionError } = await db().from("work_sessions").update({
        state: "active",
        last_substantive_update_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
        .in("state", ["clocked_in", "active", "paused", "eod_due"]);
      if (sessionError) throw new Error(`record substantive proposal response: ${sessionError.message}`);
    }
    await audit(access, "proposal.applied", "task_proposal", proposalId, { operation: proposal.operation });
    return withOutcome(data);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Proposal application failed";
    const needsReview = /required before|evidence is required|task_group_id is required|may have created|accepted the create/i.test(reason);
    const { data: failed } = await db().from("work_task_proposals").update({
      status: needsReview ? "needs_review" : "failed",
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying").eq("apply_attempt", applyAttempt).select("*").maybeSingle();
    // An unresolved create intent is a review state even when the failure text
    // is a bare timeout: the POST may have landed, so the employee gets the
    // clear-and-retry recovery instead of a retry that cannot safely POST.
    let failedRow = failed as Json | null;
    const unresolved = Boolean(failedRow && proposalCreateIntentUnresolved(failedRow));
    if (unresolved && !needsReview && failedRow) {
      const { data: reviewRow } = await db().from("work_task_proposals").update({
        status: "needs_review",
        updated_at: new Date().toISOString(),
      }).eq("id", proposalId).eq("status", "failed").select("*").maybeSingle();
      failedRow = (reviewRow as Json | null) ?? failedRow;
    }
    await audit(access, "proposal.failed", "task_proposal", proposalId, { operation: proposal.operation, reason, needsReview, createIntentUnresolved: unresolved });
    // Return the row (instead of throwing) when recovery is possible: the
    // companion keys the clear-and-retry action off this machine-readable flag.
    if (unresolved && failedRow) return withOutcome({ ...failedRow, create_intent_unresolved: true });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
