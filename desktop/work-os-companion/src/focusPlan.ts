import type { DailyPlan } from "./types";
import { safeTaskText, type TaskRow } from "./taskWorkspace";

export type FocusPlanSubtask = {
  id: string;
  title: string;
  completed: boolean;
  /** The plan recorded this outcome's success criterion before its task row
   * (and therefore its materialized subtask) was loaded. */
  planned: boolean;
};

export type FocusPlanGroup = {
  id: string;
  taskId: string | null;
  title: string;
  recordedState: "open" | "completed";
  subtasks: FocusPlanSubtask[];
  subtaskTotal: number;
  subtaskCompleted: number;
  subtasksTruncated: boolean;
};

export type FocusPlan = {
  groups: FocusPlanGroup[];
  total: number;
  open: number;
  completed: number;
  subtaskTotal: number;
  subtaskCompleted: number;
};

const taskKey = (task: TaskRow) => String(task.provider_task_id || task.id || "");
const isSubtask = (task: TaskRow) => Boolean(task.parent_task_id || task.parent_provider_task_id);
const parentKey = (task: TaskRow) => String(task.parent_task_id || task.parent_provider_task_id || "");

function count(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

/** A plan outcome records its success criteria before confirmation. Those
 * criteria become the task's subtasks during materialization, so when the day
 * page does not carry the task row (the plan can exceed the task page), the
 * criteria are the truthful hierarchy the focus dialog can still show. */
function plannedCriteria(item: DailyPlan["items"][number], task: TaskRow | null, groupId: string): FocusPlanSubtask[] {
  const completed = task?.completed === true || item.completion_state === "completed";
  const seen = new Set<string>();
  const rows: FocusPlanSubtask[] = [];
  for (const [index, criterion] of (Array.isArray(item.success_criteria) ? item.success_criteria : []).entries()) {
    const title = safeTaskText(criterion, "");
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    rows.push({
      id: `${groupId}:criterion-${index}`,
      title,
      completed,
      planned: true,
    });
  }
  return rows;
}

function indexTask(index: Map<string, TaskRow>, task: TaskRow) {
  for (const value of [task.id, task.provider_task_id]) {
    if (value) index.set(String(value), task);
  }
  for (const child of Array.isArray(task.subtasks) ? task.subtasks : []) {
    // A compact day payload can omit the child's parent columns even though it
    // arrived inside the parent. Keep that relationship for plan deduplication.
    const linked = child.parent_task_id || child.parent_provider_task_id ? child : {
      ...child,
      parent_task_id: task.id ?? null,
      ...(task.provider_task_id ? { parent_provider_task_id: task.provider_task_id } : {}),
    };
    for (const value of [child.id, child.provider_task_id]) {
      if (value) index.set(String(value), linked);
    }
  }
}

/**
 * The plan is the record of which parent tasks were selected for the workday.
 * The day payload already carries those parents' subtasks, so one pass can
 * attach them without a second fetch. Counts describe the plan items, not the
 * subtasks, because the plan's completion snapshot belongs to the item.
 */
export function buildFocusPlan(plan: DailyPlan | null | undefined, tasks: readonly TaskRow[]): FocusPlan {
  const index = new Map<string, TaskRow>();
  for (const task of tasks) indexTask(index, task);
  const items = (plan?.items ?? [])
    .filter((item) => item.disposition === "selected")
    .slice()
    .sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
  const resolved = items.map((item) => ({ item, task: item.task_id ? index.get(String(item.task_id)) ?? null : null }));
  const plannedParents = new Set(
    resolved
      .filter(({ task }) => task && !isSubtask(task))
      .map(({ task }) => taskKey(task!))
      .filter(Boolean),
  );

  const groups: FocusPlanGroup[] = [];
  const seen = new Set<string>();
  for (const { item, task } of resolved) {
    // A separately planned subtask belongs beneath its parent when that parent
    // is also on the plan; showing it twice would make the hierarchy lie.
    if (task && isSubtask(task)) {
      const parent = index.get(parentKey(task));
      if (parent && plannedParents.has(taskKey(parent))) continue;
    }
    const id = task ? taskKey(task) : item.id ? `item:${item.id}` : `item:${item.rank}:${item.title_snapshot}`;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const rawSubtasks = task && Array.isArray(task.subtasks) ? task.subtasks : [];
    const seenSubtasks = new Set<string>();
    const subtasks: FocusPlanSubtask[] = [];
    for (const [position, child] of rawSubtasks.entries()) {
      const childId = String(child?.provider_task_id || child?.id || `${id}-subtask-${position}`);
      if (seenSubtasks.has(childId)) continue;
      seenSubtasks.add(childId);
      subtasks.push({
        id: childId,
        title: safeTaskText(child?.title, "Untitled subtask"),
        completed: child?.completed === true,
        planned: false,
      });
    }
    // The compact day keeps up to eight children but carries the full counts;
    // the summary must state the task's total, not the loaded window.
    const declaredTotal = count(task?.subtaskProgress?.total ?? task?.subtask_total ?? task?.subtaskCount);
    const declaredCompleted = count(task?.subtaskProgress?.completed ?? task?.subtask_completed);
    // Loaded task children are authoritative. Only fall back to the plan's own
    // success criteria when the task row or its child counts are unavailable;
    // an explicit empty list (including `subtask_total: 0`) means the
    // subtasks were removed and must not be resurrected from the old plan.
    const childDataKnown = task != null && (Array.isArray(task.subtasks)
      || task.subtaskProgress?.total !== undefined || task.subtask_total !== undefined || task.subtaskCount !== undefined);
    const authoritativeEmpty = childDataKnown && rawSubtasks.length === 0 && declaredTotal === 0;
    if (!subtasks.length && !authoritativeEmpty && Array.isArray(item.success_criteria) && item.success_criteria.length) {
      subtasks.push(...plannedCriteria(item, task, id));
    }
    // Open work leads the nested list, matching every task surface.
    subtasks.sort((left, right) => Number(left.completed) - Number(right.completed));
    const subtaskTotal = Math.max(subtasks.length, declaredTotal);
    const subtaskCompleted = Math.min(subtaskTotal, Math.max(subtasks.filter((child) => child.completed).length, declaredCompleted));
    groups.push({
      id,
      taskId: task ? String(task.provider_task_id || task.id) : item.task_id,
      title: safeTaskText(task?.title, safeTaskText(item.title_snapshot, "Untitled plan item")),
      recordedState: item.completion_state === "completed" ? "completed" : "open",
      subtasks,
      subtaskTotal,
      subtaskCompleted,
      subtasksTruncated: subtaskTotal > subtasks.length,
    });
  }

  const completed = groups.filter((group) => group.recordedState === "completed").length;
  return {
    groups,
    total: groups.length,
    open: groups.length - completed,
    completed,
    subtaskTotal: groups.reduce((sum, group) => sum + group.subtaskTotal, 0),
    subtaskCompleted: groups.reduce((sum, group) => sum + group.subtaskCompleted, 0),
  };
}
