import type { AgentAccess } from "@/lib/work-agent-auth";
import { getWorkOsEmployeeTaskDetails } from "@/lib/work-os-employee-tasks";
import { db, type Json } from "@/lib/work-os-internal";

/** One merged timeline per task: day events, evidence, and blockers. Raw
 * provider payloads and storage paths never appear here. */

export type AgentActivityActor = "agent" | "employee" | "system";
export type AgentActivityItem = {
  id: string;
  kind: string;
  at: string;
  actor: AgentActivityActor;
  summary: string;
  data: Json;
};

export const AGENT_ACTIVITY_MAX = 100;
export const AGENT_ACTIVITY_DEFAULT = 50;

export function encodeActivityCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify({ at, id }), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string | null | undefined): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.at !== "string" || typeof parsed.id !== "string") return null;
    return { at: parsed.at, id: parsed.id };
  } catch {
    return null;
  }
}

export function mergeAgentActivity(
  input: { events?: Json[]; evidence?: Json[]; blockers?: Json[] },
  cursor?: string | null,
  limit = AGENT_ACTIVITY_DEFAULT,
): { items: AgentActivityItem[]; nextCursor: string | null } {
  const items: AgentActivityItem[] = [];
  for (const event of input.events ?? []) {
    const at = String(event.exact_at ?? event.observed_at ?? "");
    if (!at) continue;
    const provenance = String(event.provenance ?? "");
    const snapshot = event.task_snapshot && typeof event.task_snapshot === "object" ? event.task_snapshot as Json : {};
    items.push({
      id: `task_event:${String(event.id)}`,
      kind: `task.${String(event.event_type ?? "event")}`,
      at,
      actor: provenance === "agent" ? "agent" : provenance === "employee_explicit" ? "employee" : "system",
      summary: typeof snapshot.title === "string" ? snapshot.title : String(event.event_type ?? "Task event"),
      data: { eventType: event.event_type ?? null, provenance: provenance || null },
    });
  }
  for (const row of input.evidence ?? []) {
    const at = String(row.created_at ?? "");
    if (!at) continue;
    const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics as Json : {};
    const origin = String(metrics.origin ?? "");
    const source = String(row.source ?? "");
    items.push({
      id: `evidence:${String(row.id)}`,
      kind: origin === "agent_progress" || source === "agent" ? "evidence.progress" : "evidence.completion",
      at,
      actor: metrics.agentTokenId || source === "agent" ? "agent" : "employee",
      summary: typeof row.title === "string" ? row.title : "Evidence",
      data: { source: source || null, origin: origin || null },
    });
  }
  for (const row of input.blockers ?? []) {
    const at = String(row.created_at ?? "");
    if (!at) continue;
    const resolved = String(row.status ?? "") === "resolved";
    items.push({
      id: `blocker:${String(row.id)}`,
      kind: resolved ? "blocker.resolved" : "blocker.opened",
      at,
      actor: row.agent_token_id ? "agent" : "employee",
      summary: typeof row.description === "string" ? row.description : "Blocker",
      data: { status: row.status ?? null },
    });
  }
  items.sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id));
  const decoded = decodeActivityCursor(cursor);
  const filtered = decoded
    ? items.filter((item) => item.at < decoded.at || (item.at === decoded.at && item.id < decoded.id))
    : items;
  const pageSize = Math.min(AGENT_ACTIVITY_MAX, Math.max(1, Math.trunc(limit)));
  const page = filtered.slice(0, pageSize);
  const last = page[page.length - 1];
  const nextCursor = filtered.length > pageSize && last ? encodeActivityCursor(last.at, last.id) : null;
  return { items: page, nextCursor };
}

export async function listAgentActivity(
  agent: AgentAccess,
  taskId: string,
  params: { cursor?: string | null; limit?: number } = {},
) {
  const details = await getWorkOsEmployeeTaskDetails(agent.access, taskId);
  const localTaskId = String((details.task as Json).id);
  const organizationId = agent.access.organizationId;
  const [events, evidence, blockers] = await Promise.all([
    db().from("work_task_day_events").select("id,event_type,provenance,exact_at,observed_at,task_snapshot,metadata")
      .eq("organization_id", organizationId).eq("task_id", localTaskId)
      .order("observed_at", { ascending: false }).limit(AGENT_ACTIVITY_MAX),
    db().from("work_evidence").select("id,title,summary,source,metrics,created_at")
      .eq("organization_id", organizationId).eq("task_id", localTaskId)
      .order("created_at", { ascending: false }).limit(AGENT_ACTIVITY_MAX),
    db().from("work_task_blockers").select("id,description,status,created_at,resolved_at,agent_token_id")
      .eq("organization_id", organizationId).eq("task_id", localTaskId)
      .order("created_at", { ascending: false }).limit(AGENT_ACTIVITY_MAX),
  ]);
  for (const result of [events, evidence, blockers]) {
    if (result.error) throw new Error(`load agent activity: ${result.error.message}`);
  }
  return mergeAgentActivity(
    { events: events.data ?? [], evidence: evidence.data ?? [], blockers: blockers.data ?? [] },
    params.cursor,
    params.limit,
  );
}
