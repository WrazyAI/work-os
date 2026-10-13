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

/** A repeat goal title (the same commitment typed on a new day) continues the
 * recent open task instead of creating a second row. Bounded to the last week
 * and matched on normalized title so genuinely distinct same-named efforts
 * older than the window are never merged. */
export const LOCAL_TASK_REUSE_WINDOW_DAYS = 7;

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
  /** Repeat goals that continued a recent open task instead of creating one. */
  reused: number;
  created: MaterializedPlanTask[];
};

export type PlanTaskEntry = {
  itemId: string | null;
  title: string;
  objective: string | null;
  successCriteria: unknown;
  linkedTaskId: string | null;
};

export type CreateLocalWorkOsTaskInput = {
  title: string;
  description?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  priority?: string | null;
  labels?: string[];
  storyPoints?: number | null;
  expectedOutcome?: string | null;
  definitionOfDone?: string | null;
  taskGroupId?: string | null;
  projectId?: string | null;
  providerProjectId?: string | null;
  assigneePersonIds?: string[];
  parent?: Json | null;
  raw?: Json;
};

/** Stable dedup marker. Re-confirming the same plan never duplicates tasks:
 * the marker is plan-scoped and derived from the normalized content. */
export function planTaskMarker(...parts: string[]) {
  return `work-os-plan:${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 20)}`;
}

/** Comparison form for repeat goals: trimmed, whitespace-collapsed, case-folded. */
export function normalizeTaskTitle(value: unknown): string {
  return (typeof value === "string" ? value : "").trim().replace(/\s+/g, " ").toLowerCase();
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

/** Finds the open Work OS task a repeat goal title should continue. Matching is
 * deliberately narrow: same person, local provider, still open, due inside the
 * window ending on the plan date, and normalized-title equality (compared in
 * JS so titles containing SQL wildcards can never over-match). */
async function findReusableLocalTask(access: WorkOsAccess, title: string, planDate: string) {
  const normalized = normalizeTaskTitle(title);
  if (!normalized) return null;
  const since = new Date(`${planDate}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - LOCAL_TASK_REUSE_WINDOW_DAYS);
  // Page the whole window with a deterministic order (due date, then id) so a
  // match beyond the first page is still found and the pages never overlap.
  const pageSize = 50;
  const maxPages = 4;
  for (let page = 0; page < maxPages; page += 1) {
    let query = db().from("work_tasks").select("*")
      .eq("organization_id", access.organizationId)
      .eq("provider", LOCAL_TASK_PROVIDER)
      .eq("completed", false)
      .not("status", "in", "(archived,deleted)")
      .gte("due_date", since.toISOString().slice(0, 10))
      .lte("due_date", planDate)
      .order("due_date", { ascending: false })
      .order("id", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (access.personId) query = query.contains("assignee_person_ids", [access.personId]);
    const result = await query;
    if (result.error) throw new Error(`load repeat Work OS task: ${result.error.message}`);
    const candidates = (result.data ?? []) as Json[];
    const match = candidates.find((task) => normalizeTaskTitle(task.title) === normalized);
    if (match) return match;
    if (candidates.length < pageSize) break;
  }
  return null;
}

async function validateLocalTaskAssignees(access: WorkOsAccess, personIds: string[]) {
  const uniqueIds = [...new Set(personIds.filter((personId) => personId.trim()))];
  if (!uniqueIds.length) return [];
  const result = await db().from("work_people").select("id")
    .eq("organization_id", access.organizationId)
    .eq("active", true)
    .in("id", uniqueIds);
  if (result.error) throw new Error(`validate Work OS task assignees: ${result.error.message}`);
  const activeIds = new Set((result.data ?? []).map((person) => String(person.id)));
  const invalid = uniqueIds.find((personId) => !activeIds.has(personId));
  if (invalid) throw new Error("Assignees must be active Work OS organization members");
  return uniqueIds;
}

/** A caller-supplied project must belong to the acting organization; otherwise
 * the task would be filed under another tenant's project. */
async function validateLocalTaskProject(access: WorkOsAccess, projectId: string | null | undefined) {
  const id = projectId?.trim();
  if (!id) return null;
  const result = await db().from("work_projects").select("id")
    .eq("organization_id", access.organizationId)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error(`validate Work OS task project: ${result.error.message}`);
  if (!result.data) throw new Error("Task project must belong to the organization");
  return id;
}

/** A subtask lives in its parent's project. A caller may omit the project — it
 * is inherited — but must never override it with a different one. Top-level
 * tasks have no parent to inherit from. */
export function assertSubtaskProjectInherited(projectId: string | null, parent: Json | null) {
  if (!parent) return;
  if (projectId && projectId !== ((parent.project_id as string | null) ?? null)) {
    throw new Error("Subtasks can only be created in their parent's project");
  }
}

export async function createLocalWorkOsTask(access: WorkOsAccess, input: CreateLocalWorkOsTaskInput) {
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required");
  if (title.length > MAX_TITLE) throw new Error("Task title must be 240 characters or fewer");
  const description = input.description?.trim() || null;
  if (description && description.length > MAX_DESCRIPTION) throw new Error("Task description must be 20000 characters or fewer");
  const assigneePersonIds = await validateLocalTaskAssignees(access, input.assigneePersonIds ?? []);
  const projectId = await validateLocalTaskProject(access, input.projectId);
  assertSubtaskProjectInherited(projectId, input.parent ?? null);
  const now = new Date().toISOString();
  const result = await db().from("work_tasks").insert({
    organization_id: access.organizationId,
    user_id: await organizationOwnerId(access.organizationId),
    provider: LOCAL_TASK_PROVIDER,
    provider_task_id: `local-${randomUUID()}`,
    provider_project_id: input.providerProjectId ?? input.parent?.provider_project_id ?? null,
    project_id: projectId ?? input.parent?.project_id ?? null,
    title: title.slice(0, MAX_TITLE),
    description: description ? description.slice(0, MAX_DESCRIPTION) : null,
    task_group_id: input.taskGroupId ?? null,
    priority: input.priority ?? null,
    labels: input.labels ?? [],
    story_points: input.storyPoints ?? null,
    expected_outcome: input.expectedOutcome ?? null,
    definition_of_done: input.definitionOfDone ?? null,
    status: "open",
    completed: false,
    assignee_person_ids: assigneePersonIds,
    due_date: input.dueDate ?? null,
    start_date: input.startDate ?? null,
    parent_task_id: input.parent ? String(input.parent.id) : null,
    parent_provider_task_id: input.parent?.provider_task_id ? String(input.parent.provider_task_id) : null,
    raw: { source: "work_os", ...(input.raw ?? {}) },
    synced_at: now,
    created_at: now,
    updated_at: now,
  }).select("*").single();
  if (result.error) throw new Error(`create Work OS task: ${result.error.message}`);
  const row = result.data as Json;
  await recordLocalTaskCreationEvent(access, row, input.dueDate ?? null, now);
  return row;
}

async function createLocalTaskRow(access: WorkOsAccess, input: {
  title: string;
  description: string | null;
  dueDate: string;
  parent: Json | null;
  marker: string;
}) {
  return createLocalWorkOsTask(access, {
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    parent: input.parent,
    assigneePersonIds: access.personId ? [access.personId] : [],
    raw: { source: "work_os_plan", planMarker: input.marker, createdFromPlan: true },
  });
}

/** Day-event attribution is best-effort (idempotent upsert): a missing event
 * only affects day surfacing, never the task itself, and re-running the flow
 * heals it. */
async function recordLocalTaskCreationEvent(access: WorkOsAccess, task: Json, dueDate: string | null, exactAt: string) {
  try {
    await recordTaskDayEvent(access, task, "creation_observed", {
      idempotencyKey: `local:created:${String(task.provider_task_id)}`,
      exactAt,
      provenance: "employee_explicit",
      ...(dueDate ? { localDate: dueDate } : {}),
    });
  } catch (error) {
    console.error("[plan-materialize] day event failed:", error instanceof Error ? error.message : error);
  }
}

// Task ids are opaque but never contain filter punctuation; reject anything
// that could alter the PostgREST filter it is interpolated into below.
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

async function loadTaskById(access: WorkOsAccess, taskId: string) {
  if (!TASK_ID_RE.test(taskId)) throw new Error("plan item references an invalid task id");
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
  const summary: PlanTaskMaterialization = { tasks: 0, subtasks: 0, failed: 0, reused: 0, created: [] };
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
        if (parent) {
          // Heal attribution for a task created before an earlier day-event write failed.
          await recordLocalTaskCreationEvent(access, parent, planDate, new Date().toISOString());
        } else {
          // A repeat title continues the recent open task instead of creating a
          // duplicate. The plan item link below makes later re-confirms reuse
          // that task directly, without another window search.
          parent = await findReusableLocalTask(access, entry.title, planDate);
          if (parent) {
            summary.reused += 1;
            await audit(access, "plan.task_reused", "work_daily_plan", String(planId), {
              taskId: parent.id,
              title: entry.title,
              dueDate: parent.due_date,
            });
          } else {
            parent = await createLocalTaskRow(access, {
              title: entry.title,
              description: entry.objective,
              dueDate: planDate,
              parent: null,
              marker,
            });
            summary.tasks += 1;
          }
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

  if (summary.tasks || summary.subtasks || summary.failed || summary.reused) {
    await audit(access, "plan.tasks_materialized", "work_daily_plan", String(planId), {
      tasks: summary.tasks,
      subtasks: summary.subtasks,
      failed: summary.failed,
      reused: summary.reused,
      provider: LOCAL_TASK_PROVIDER,
    });
  }
  return summary;
}
