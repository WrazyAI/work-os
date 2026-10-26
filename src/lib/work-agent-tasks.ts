import type { AgentAccess } from "@/lib/work-agent-auth";
import { WorkOsValidationError, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { createWorkOsEmployeeTask, getWorkOsEmployeeTaskDetails, setWorkOsEmployeeTaskCompletion, updateWorkOsAgentTask } from "@/lib/work-os-employee-tasks";
import { addTaskProgress } from "@/lib/work-os-tasks";
import { audit, db, type Json } from "@/lib/work-os-internal";

/** Person-scoped agent task reads. The list uses the dedicated change-feed
 * function so the person attribution rule matches the employee surfaces. */

export const AGENT_TASK_PAGE_MAX = 100;
export const AGENT_TASK_PAGE_DEFAULT = 50;

export type AgentTaskCursor = { order: "asc" | "desc"; updatedAt: string; id: string };

export function encodeAgentTaskCursor(cursor: AgentTaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** PostgreSQL JSON timestamps carry a timezone and can retain microseconds. */
function validCursorTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]!
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

export function decodeAgentTaskCursor(value: string | null | undefined): AgentTaskCursor | null {
  if (value == null) return null;
  try {
    if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor");
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    if (parsed.order !== "asc" && parsed.order !== "desc") throw new Error("invalid cursor");
    if (!validCursorTimestamp(parsed.updatedAt)) throw new Error("invalid cursor");
    if (typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("invalid cursor");
    return { order: parsed.order, updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new WorkOsValidationError("Task cursor is invalid");
  }
}

export async function listAgentTasks(
  agent: AgentAccess,
  params: { updatedSince?: string | null; includeArchived?: boolean; limit?: number; cursor?: string | null } = {},
): Promise<{ tasks: Json[]; nextCursor: string | null }> {
  const ownerId = workOsOrganizationOwnerId(agent.access);
  const personId = agent.access.personId as string;
  const organizationId = agent.access.organizationId;
  const limit = Math.min(AGENT_TASK_PAGE_MAX, Math.max(1, Math.trunc(params.limit ?? AGENT_TASK_PAGE_DEFAULT)));
  const ascending = Boolean(params.updatedSince);
  const cursor = decodeAgentTaskCursor(params.cursor);
  if (cursor && cursor.order !== (ascending ? "asc" : "desc")) {
    throw new WorkOsValidationError("Task cursor must match the requested order");
  }
  const person = await db().from("work_people").select("nifty_member_id")
    .eq("organization_id", organizationId).eq("user_id", ownerId).eq("id", personId).maybeSingle();
  if (person.error) throw new Error(`load agent person mapping: ${person.error.message}`);
  const rows = await db().rpc("work_agent_list_tasks", {
    p_user_id: ownerId,
    p_organization_id: organizationId,
    p_person_id: personId,
    p_nifty_member_id: ((person.data as Json | null)?.nifty_member_id as string | null) ?? null,
    p_updated_since: params.updatedSince ?? null,
    p_include_archived: params.includeArchived === true,
    p_ascending: ascending,
    p_after_updated_at: cursor?.updatedAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: limit + 1,
  });
  if (rows.error) throw new Error(`list agent tasks: ${rows.error.message}`);
  const tasks = ((rows.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => row.task as Json)
    .filter((task): task is Json => Boolean(task && typeof task === "object"));
  const page = tasks.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = tasks.length > limit && last
    ? encodeAgentTaskCursor({ order: ascending ? "asc" : "desc", updatedAt: String(last.updated_at), id: String(last.id) })
    : null;
  return { tasks: page, nextCursor };
}

export async function getAgentTask(agent: AgentAccess, taskId: string) {
  const details = await getWorkOsEmployeeTaskDetails(agent.access, taskId);
  const localTaskId = String((details.task as Json).id);
  const blockers = await db().from("work_task_blockers")
    .select("id,description,status,created_at,resolved_at,agent_token_id")
    .eq("organization_id", agent.access.organizationId)
    .eq("task_id", localTaskId)
    .order("created_at", { ascending: false });
  if (blockers.error) throw new Error(`load agent task blockers: ${blockers.error.message}`);
  return {
    task: details.task,
    subtasks: details.subtasks,
    completionEvidence: details.completionEvidence,
    blockers: blockers.data ?? [],
  };
}

const AGENT_TASK_CREATE_FIELDS = new Set([
  "name",
  "description",
  "due_date",
  "start_date",
  "priority",
  "labels",
  "expected_outcome",
  "definition_of_done",
  "parent_task_id",
  "project_id",
]);

/** The agent create contract: work for the token's own person, in a real
 * project (TASKS by default). Assignment and grouping fields are rejected so a
 * token can never file work it cannot then see. */
export function validateAgentTaskCreate(body: Json): Json {
  const create: Json = {};
  for (const key of Object.keys(body ?? {})) {
    if (!AGENT_TASK_CREATE_FIELDS.has(key)) {
      throw new WorkOsValidationError(`Field ${key} is not accepted when creating through the agent API`);
    }
    create[key] = body[key];
  }
  if (typeof create.name !== "string" || !create.name.trim()) {
    throw new WorkOsValidationError("Task title is required");
  }
  return create;
}

export async function createAgentTask(agent: AgentAccess, body: Json, idempotencyKey: string) {
  const personId = agent.access.personId as string;
  const actor = { tokenId: agent.tokenId, tokenName: agent.tokenName };
  const create = { ...validateAgentTaskCreate(body), assignee_person_ids: [personId] };
  try {
    return await createWorkOsEmployeeTask(agent.access, create, actor, idempotencyKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/duplicate key|unique constraint|already exists/i.test(message)) throw error;
    const existing = await db().from("work_tasks").select("*")
      .eq("organization_id", agent.access.organizationId)
      .eq("agent_token_id", agent.tokenId)
      .eq("agent_idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing.error) throw new Error(`reconcile agent task create: ${existing.error.message}`);
    if (!existing.data) throw error;
    return existing.data as Json;
  }
}

export async function updateAgentTask(agent: AgentAccess, taskId: string, body: Json) {
  return updateWorkOsAgentTask(agent.access, taskId, body, { tokenId: agent.tokenId, tokenName: agent.tokenName });
}

export async function completeAgentTask(agent: AgentAccess, taskId: string, completed: boolean) {
  return setWorkOsEmployeeTaskCompletion(agent.access, taskId, completed, { tokenId: agent.tokenId, tokenName: agent.tokenName });
}

/** A progress note is employee-authored context, never completion proof. It is
 * one `work_evidence` row marked with the token that wrote it. */
export async function addAgentProgress(agent: AgentAccess, taskId: string, body: Json, idempotencyKey: string) {
  const details = await getWorkOsEmployeeTaskDetails(agent.access, taskId);
  const localTaskId = String((details.task as Json).id);
  const ownerId = workOsOrganizationOwnerId(agent.access);
  const metrics = body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)
    ? body.metrics as Json
    : {};
  const evidence = await addTaskProgress(ownerId, localTaskId, {
    title: body.title,
    summary: body.summary,
    url: body.url,
    person_id: agent.access.personId,
    source: "agent",
    idempotency_key: idempotencyKey,
    metrics: { ...metrics, origin: "agent_progress", agentTokenId: agent.tokenId },
  });
  await audit(agent.access, "agent.progress.logged", "work_evidence", String((evidence as Json).id ?? ""), {
    tokenId: agent.tokenId,
    tokenName: agent.tokenName,
    taskId: localTaskId,
  });
  return evidence;
}
