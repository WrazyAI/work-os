import { createHash, randomUUID } from "node:crypto";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { audit, db, nonEmptyString as text, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import { recordTaskDayEvent } from "@/lib/work-os-daily-workspace";

/** Work OS-native tasks (SOD goals materialized on plan confirm). These never
 * touch Nifty: they are written straight into work_tasks with provider
 * "local", and every lifecycle write path branches on that provider. */
export const LOCAL_TASK_PROVIDER = "local";
const MAX_TITLE = 240;
const MAX_DESCRIPTION = 20_000;

export type MaterializedPlanTask = {
  itemId: string | null;
  taskId: string;
  providerTaskId: string;
  title: string;
};

export type PlanTaskMaterialization = {
  tasks: number;
  subtasks: number;
  failed: number;
  created: MaterializedPlanTask[];
};

export type PlanTaskEntry = {
  itemId: string | null;
  title: string;
  objective: string | null;
  successCriteria: unknown;
  linkedTaskId: string | null;
};

/** Stable dedup marker. Re-confirming the same plan never duplicates tasks:
 * the marker is plan-scoped and derived from the normalized content. */
export function planTaskMarker(...parts: string[]) {
  return `work-os-plan:${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`;
}

export function normalizeCriterion(value: unknown): string | null {
  const criterion = typeof value === "string" ? value.trim() : "";
  if (!criterion) return null;
  return criterion.length > MAX_TITLE ? `${criterion.slice(0, MAX_TITLE - 1).trimEnd()}…` : criterion;
}

const markerFor = planTaskMarker;

async function findLocalTaskByMarker(organizationId: string, marker: string) {
  const result = await db().from("work_tasks").select("*")
    .eq("organization_id", organizationId).eq("provider", LOCAL_TASK_PROVIDER)
    .contains("raw", { planMarker: marker }).maybeSingle();
  if (result.error) throw new Error(`load plan task by marker: ${result.error.message}`);
  return (result.data as Json | null) ?? null;
}

async function createLocalTaskRow(access: WorkOsAccess, input: {
  title: string;
  description: string | null;
  dueDate: string;
  parent: Json | null;
  marker: string;
}) {
  const now = new Date().toISOString();
  const result = await db().from("work_tasks").insert({
    organization_id: access.organizationId,
    user_id: await organizationOwnerId(access.organizationId),
    provider: LOCAL_TASK_PROVIDER,
    provider_task_id: `local-${randomUUID()}`,
    title: input.title.slice(0, MAX_TITLE),
    description: input.description ? input.description.slice(0, MAX_DESCRIPTION) : null,
    status: "open",
    completed: false,
    assignee_person_ids: access.personId ? [access.personId] : [],
    due_date: input.dueDate,
    parent_task_id: input.parent ? String(input.parent.id) : null,
    parent_provider_task_id: input.parent ? String(input.parent.provider_task_id) : null,
    raw: { source: "work_os_plan", planMarker: input.marker, createdFromPlan: true },
    synced_at: now,
    created_at: now,
    updated_at: now,
  }).select("*").single();
  if (result.error) throw new Error(`create Work OS plan task: ${result.error.message}`);
  const row = result.data as Json;
  await recordLocalTaskCreationEvent(access, row, input.dueDate, now);
  return row;
}

/** Day-event attribution is best-effort (idempotent upsert): a missing event
 * only affects day surfacing, never the task itself, and re-running the flow
 * heals it. */
async function recordLocalTaskCreationEvent(access: WorkOsAccess, task: Json, dueDate: string, exactAt: string) {
  try {
    await recordTaskDayEvent(access, task, "creation_observed", {
      idempotencyKey: `local:created:${String(task.provider_task_id)}`,
      exactAt,
      provenance: "employee_explicit",
      localDate: dueDate,
    });
  } catch (error) {
    console.error("[plan-materialize] day event failed:", error instanceof Error ? error.message : error);
  }
}

async function loadTaskById(access: WorkOsAccess, taskId: string) {
  const result = await db().from("work_tasks").select("*")
    .eq("organization_id", access.organizationId)
    .or(`id.eq.${taskId},provider_task_id.eq.${taskId}`).maybeSingle();
  if (result.error) throw new Error(`load plan task: ${result.error.message}`);
  return (result.data as Json | null) ?? null;
}

/** Materializes a confirmed SOD draft into Work OS tasks: each new goal
 * becomes a local task, each success criterion becomes a local subtask under
 * its goal (including goals the AI linked to existing tasks). Idempotent per
 * plan: markers dedupe re-confirms, and linked plan items never re-create. */
export async function materializePlanLocalTasks(
  access: WorkOsAccess,
  planId: string,
  planDate: string,
  entries: PlanTaskEntry[],
): Promise<PlanTaskMaterialization> {
  const summary: PlanTaskMaterialization = { tasks: 0, subtasks: 0, failed: 0, created: [] };
  const parents = new Map<string, { row: Json; criteria: string[] }>();

  for (const entry of entries) {
    if (!entry.title) continue;
    try {
      let parent: Json | null = null;
      if (entry.linkedTaskId) {
        parent = await loadTaskById(access, entry.linkedTaskId);
      } else {
        const marker = markerFor(String(planId), "goal", entry.title.toLowerCase());
        parent = await findLocalTaskByMarker(access.organizationId, marker);
        if (!parent) {
          parent = await createLocalTaskRow(access, {
            title: entry.title,
            description: entry.objective,
            dueDate: planDate,
            parent: null,
            marker,
          });
          summary.tasks += 1;
        } else {
          // Heal attribution for a task created before an earlier day-event write failed.
          await recordLocalTaskCreationEvent(access, parent, planDate, new Date().toISOString());
        }
        if (entry.itemId) {
          const link = await db().from("work_daily_plan_items")
            .update({ task_id: parent.id, item_kind: "local_task" })
            .eq("plan_id", planId).eq("id", entry.itemId).select("*").single();
          if (link.error) throw new Error(`link plan item to Work OS task: ${link.error.message}`);
        }
        summary.created.push({
          itemId: entry.itemId,
          taskId: String(parent.id),
          providerTaskId: String(parent.provider_task_id),
          title: entry.title,
        });
      }
      if (!parent) continue;
      const criteria = (Array.isArray(entry.successCriteria) ? entry.successCriteria : [])
        .map(normalizeCriterion)
        .filter((criterion): criterion is string => Boolean(criterion));
      const existing = parents.get(String(parent.id));
      if (existing) existing.criteria.push(...criteria);
      else parents.set(String(parent.id), { row: parent, criteria });
    } catch (error) {
      console.error("[plan-materialize] goal failed:", error instanceof Error ? error.message : error);
      summary.failed += 1;
    }
  }

  for (const { row: parent, criteria } of parents.values()) {
    for (const criterion of [...new Set(criteria)]) {
      const marker = markerFor(String(planId), "subtask", String(parent.provider_task_id), criterion.toLowerCase());
      try {
        const found = await findLocalTaskByMarker(access.organizationId, marker);
        if (!found) {
          await createLocalTaskRow(access, {
            title: criterion,
            description: null,
            dueDate: planDate,
            parent,
            marker,
          });
          summary.subtasks += 1;
        }
      } catch (error) {
        console.error("[plan-materialize] subtask failed:", error instanceof Error ? error.message : error);
        summary.failed += 1;
      }
    }
  }

  if (summary.tasks || summary.subtasks || summary.failed) {
    await audit(access, "plan.tasks_materialized", "work_daily_plan", String(planId), {
      tasks: summary.tasks,
      subtasks: summary.subtasks,
      failed: summary.failed,
      provider: LOCAL_TASK_PROVIDER,
    });
  }
  return summary;
}
