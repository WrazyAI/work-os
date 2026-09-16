import {
  addTaskProgress,
  adoptProviderTask,
  createEvidence,
  createTask,
  findNiftyTaskByMarker,
  getTaskByLocalOrProviderId,
  listPersonTasks,
  syncNiftyTask,
  updateTask,
} from "@/lib/work-os";
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
  | "add_subtask" | "modify_subtask" | "delete_subtask" | "display_pending_tasks" | "display_overdue_tasks";

function interpretedOperations(value: unknown) {
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
    if (!op || !["record_progress", "record_blocker", "complete_task", "reopen_task", "create_task", "add_task", "archive_task", "delete_task", "modify_task_description", "modify_task_status", "add_subtask", "modify_subtask", "delete_subtask", "display_pending_tasks", "display_overdue_tasks"].includes(op) || !statement || statement.length > 1000) {
      throw new Error(`Proposed update ${index + 1} is invalid`);
    }
    if (!["create_task", "add_task", "display_pending_tasks", "display_overdue_tasks"].includes(op) && !taskId) throw new Error(`Proposed update ${index + 1} requires a task`);
    if (["create_task", "add_task", "add_subtask"].includes(op) && (taskTitle ?? statement).length > 240) throw new Error("Task title must be 240 characters or fewer");
    if (op === "modify_task_status" && !taskGroupId) throw new Error("task_group_id is required for a Nifty status move");
    return { op, statement, taskId, taskTitle, taskGroupId, limit };
  });
}

export async function listWorkOsProposals(access: WorkOsAccess, personId: string, status?: string | null) {
  let query = db()
    .from("work_task_proposals")
    .select("*, task:work_tasks(id, title, provider_task_id)")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`load Work OS proposals: ${error.message}`);
  return data ?? [];
}

/** Single proposal readback, owner-scoped. The companion uses it to reconcile
 * an approval whose response was interrupted: it can distinguish "applied",
 * a real failure reason, and "still processing" instead of guessing. */
export async function getWorkOsProposal(access: WorkOsAccess, proposalId: string) {
  const { data, error } = await db().from("work_task_proposals")
    .select("id,operation,status,failure_reason,updated_at,decided_at,provider_result")
    .eq("organization_id", access.organizationId)
    .eq("person_id", access.personId as string)
    .eq("id", proposalId)
    .maybeSingle();
  if (error) throw new Error(`load Work OS proposal: ${error.message}`);
  if (!data) throw new Error("Proposal not found");
  return data;
}

/** Fenced write of the provider task id onto the applying proposal. Returns
 * false when the lease moved on, so a stale worker never overwrites the live
 * attempt's outbox anchor. */
async function rememberProviderTaskId(proposalId: string, providerTaskId: string, applyAttempt: string): Promise<boolean> {
  const { data, error } = await db().from("work_task_proposals").update({
    provider_task_id: providerTaskId,
    updated_at: new Date().toISOString(),
  }).eq("id", proposalId).eq("status", "applying").eq("apply_attempt", applyAttempt).select("id").maybeSingle();
  if (error) throw new Error(`record provider task id: ${error.message}`);
  return Boolean(data);
}

async function applyProposal(access: WorkOsAccess, proposal: Json, applyAttempt: string, opts: { firstAttempt: boolean }) {
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
    if (!text(change.task_group_id)) throw new Error("task_group_id is required before this Nifty task can be created");
    const marker = `Work OS proposal: ${proposal.id}`;
    const body = {
      ...change,
      description: [text(change.description), marker].filter(Boolean).join("\n\n"),
    };
    // Outbox replay: this proposal already created its provider task. Adopt it
    // instead of issuing a second Nifty POST; the tail fills in anything the
    // interrupted attempt had not written yet.
    const recordedProviderId = text(proposal.provider_task_id);
    if (recordedProviderId) return adoptProviderTask(ownerId, recordedProviderId, body);
    // A full provider sync does not belong in a request path: the local
    // mirror already holds anything a previous attempt created, so the
    // marker lookup alone reconciles a retry after an interrupted filing.
    const { data: existing, error: existingError } = await db().from("work_tasks").select("*")
      .eq("organization_id", access.organizationId).ilike("description", `%${marker}%`).maybeSingle();
    if (existingError) throw new Error(`reconcile Nifty task proposal: ${existingError.message}`);
    if (existing) {
      // Upgrade the mirror-era reconcile to an id-based anchor so later retries
      // never depend on the marker text surviving in Nifty.
      if (text(existing.provider_task_id)) await rememberProviderTaskId(proposal.id as string, String(existing.provider_task_id), applyAttempt);
      return existing;
    }
    // Provider-side reconcile for the narrow crash window between the Nifty
    // POST and the outbox write. The marker makes that orphan adoptable. Only
    // retries pay for the provider listing: a first attempt cannot have one.
    const orphan = opts.firstAttempt ? null : await findNiftyTaskByMarker(ownerId, marker, {
      projectId: text(change.project_id) ?? undefined,
      taskGroupId: text(change.task_group_id) ?? undefined,
    });
    if (orphan) {
      await rememberProviderTaskId(proposal.id as string, orphan.id, applyAttempt);
      return adoptProviderTask(ownerId, orphan.id, body);
    }
    return createTask(ownerId, body, {
      onProviderTaskCreated: async (providerTaskId) => {
        if (!await rememberProviderTaskId(proposal.id as string, providerTaskId, applyAttempt)) {
          throw new Error("The proposal lease moved to another attempt before the created task could be recorded.");
        }
      },
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

/** Stores an assistant interpretation for review. This endpoint creates no
 * Nifty/task mutation; only a later accepted proposal can apply one. */
export async function proposeInterpretedWorkUpdate(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const input = text(body.input_text);
  if (!input || input.length > 4000) throw new Error("input_text is required");
  const operations = interpretedOperations(body.operations);
  const personId = access.personId as string;
  const ownerId = await organizationOwnerId(access.organizationId);
  // Drafting a proposal uses the locally cached task view the employee just
  // saw; the day poll keeps that cache fresh. Do NOT block here on a provider
  // sync — it pages the whole account and took over two minutes, so the UI
  // appeared to do nothing. Approval re-syncs and staleness-checks before
  // anything is filed, so correctness is preserved.
  const available = await listPersonTasks(ownerId, personId, { includeLedgerHistory: true, limit: 500 }) as Json[];
  const byId = new Map(available.flatMap((task) => [[String(task.id), task], [text(task.provider_task_id) ?? "", task]]));
  const proposals: Array<Json & { client_operation_index: number }> = [];
  for (const [index, operation] of operations.entries()) {
    const operationKey = `${idempotencyKey}:${index}`;
    const { data: existing, error: existingError } = await db().from("work_task_proposals").select("*")
      .eq("organization_id", access.organizationId).eq("person_id", personId).eq("idempotency_key", operationKey).maybeSingle();
    if (existingError) throw new Error(`load idempotent interpreted proposal: ${existingError.message}`);
    if (existing) {
      proposals.push({ ...(existing as Json), client_operation_index: index });
      continue;
    }
    const task = operation.taskId ? byId.get(operation.taskId) : null;
    if (!["create_task", "add_task", "display_pending_tasks", "display_overdue_tasks"].includes(operation.op) && !task) throw new Error(`The selected task is no longer available for proposed update ${index + 1}`);
    if (operation.op === "modify_task_status") {
      const taskProjectId = text(task?.provider_project_id);
      const knownTaskGroupIds = new Set((taskProjectId ? available : [])
        .filter((candidate) => text(candidate.provider_project_id) === taskProjectId)
        .map((candidate) => text(candidate.task_group_id))
        .filter((id): id is string => !!id));
      if (!operation.taskGroupId || !input.includes(operation.taskGroupId) || !knownTaskGroupIds.has(operation.taskGroupId)) {
        throw new Error("A Nifty status move requires an employee-supplied, existing task_group_id for this project");
      }
    }
    const providerOperation: ProposalOperation = operation.op === "record_progress" ? "log_progress"
      : operation.op === "record_blocker" ? "add_blocker"
      : operation.op === "add_task" ? "create_task"
      : operation.op === "modify_task_description" || operation.op === "modify_task_status" || operation.op === "modify_subtask" ? "update_task"
      : operation.op === "add_subtask" ? "add_subtask"
      : operation.op === "delete_subtask" ? "delete_task"
      : operation.op === "display_pending_tasks" || operation.op === "display_overdue_tasks" ? "display_tasks"
      : operation.op as ProposalOperation;
    const beforeState = task ? {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      completed: task.completed,
      due_date: task.due_date,
      start_date: task.start_date,
      task_group_id: task.task_group_id,
      parent_provider_task_id: task.parent_provider_task_id,
    } : {};
    const proposedChange: Json = operation.op === "create_task" || operation.op === "add_task"
      ? { name: operation.taskTitle ?? operation.statement.slice(0, 240), description: operation.statement, task_group_id: process.env.WORK_OS_NIFTY_DEFAULT_TASK_GROUP_ID?.trim() || "PDp!eGkwR5" }
      : operation.op === "record_progress"
        ? { summary: operation.statement }
        : operation.op === "record_blocker"
          ? { description: operation.statement }
          : operation.op === "modify_task_description" || operation.op === "modify_subtask"
            ? { description: operation.statement }
            : operation.op === "modify_task_status"
              ? { task_group_id: operation.taskGroupId as string }
              : operation.op === "add_subtask"
                ? { name: operation.taskTitle ?? operation.statement.slice(0, 240), description: operation.statement }
                : operation.op === "display_pending_tasks" || operation.op === "display_overdue_tasks"
                  ? { view: operation.op === "display_overdue_tasks" ? "overdue" : "pending", limit: operation.limit }
                  : {};
    const { data: proposal, error: proposalError } = await db().from("work_task_proposals").insert({
      organization_id: access.organizationId,
      person_id: personId,
      task_id: task?.id ?? null,
      operation: providerOperation,
      input_text: input,
      before_state: beforeState,
      proposed_change: proposedChange,
      model: "desktop_interpretation",
      prompt_version: "desktop-interpretation-v1",
      idempotency_key: operationKey,
      created_by: access.ctx.user.id,
    }).select("*").single();
    if (proposalError) throw new Error(`create interpreted proposal: ${proposalError.message}`);
    await audit(access, "proposal.interpreted", "task_proposal", proposal.id as string, { operation: providerOperation, clientOperationIndex: index });
    proposals.push({ ...(proposal as Json), client_operation_index: index });
  }
  return { proposals };
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
  if (proposal.status === "applying") {
    const applyingSince = new Date(proposal.updated_at as string).getTime();
    if (Date.now() - applyingSince <= 5 * 60_000) return withOutcome(proposal);
    // The fence matches the attempt that was stalled when it was read, so a
    // lease that a concurrent claimant just replaced is never flipped back.
    let recovery = db().from("work_task_proposals").update({
      status: "failed",
      apply_attempt: null,
      failure_reason: "Previous provider application did not finalize; reconciling before retry.",
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying");
    if (proposal.apply_attempt) recovery = recovery.eq("apply_attempt", proposal.apply_attempt as string);
    const { data: recovered, error: recoveryError } = await recovery.select("*").maybeSingle();
    if (recoveryError) throw new Error(`recover stalled Work OS proposal: ${recoveryError.message}`);
    if (recovered) Object.assign(proposal, recovered);
  }
  if (decisionKey && proposal.decision_idempotency_key === decisionKey && !["pending", "failed", "needs_review", "stale"].includes(proposal.status)) return withOutcome(proposal);
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
      const keys = ["title", "description", "status", "completed", "due_date", "start_date", "task_group_id", "parent_provider_task_id"];
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
    const providerResult = await applyProposal(access, applying as Json, applyAttempt, { firstAttempt });
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
    const needsReview = /required before|evidence is required|task_group_id is required/i.test(reason);
    await db().from("work_task_proposals").update({
      status: needsReview ? "needs_review" : "failed",
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    }).eq("id", proposalId).eq("status", "applying").eq("apply_attempt", applyAttempt);
    await audit(access, "proposal.failed", "task_proposal", proposalId, { operation: proposal.operation, reason, needsReview });
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
