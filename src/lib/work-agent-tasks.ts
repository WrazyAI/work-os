import type { AgentAccess } from "@/lib/work-agent-auth";
import { WorkOsValidationError, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { getWorkOsEmployeeTaskDetails } from "@/lib/work-os-employee-tasks";
import { db, type Json } from "@/lib/work-os-internal";

/** Person-scoped agent task reads. The list uses the dedicated change-feed
 * function so the person attribution rule matches the employee surfaces. */

export const AGENT_TASK_PAGE_MAX = 100;
export const AGENT_TASK_PAGE_DEFAULT = 50;

export type AgentTaskCursor = { order: "asc" | "desc"; updatedAt: string; id: string };

export function encodeAgentTaskCursor(cursor: AgentTaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAgentTaskCursor(value: string | null | undefined): AgentTaskCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.order !== "asc" && parsed.order !== "desc") return null;
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return { order: parsed.order, updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    return null;
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
