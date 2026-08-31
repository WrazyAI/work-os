import type { DailyPlanItem } from "./types";

export type TaskRow = Record<string, any>;
export type GoalSuggestion = { text: string; taskIds: string[] } | null;
export type TaskDateReason = "due" | "created" | "surfaced" | "carried" | "unknown";
export type TaskSection = { id: "overdue" | "open" | "completed"; label: string; note: string; tasks: TaskRow[] };

const taskId = (task: TaskRow) => String(task.id ?? task.provider_task_id ?? "");
const dateOnly = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

const providerErrorText = /(?:failed to fetch|fetch failed|networkerror|unexpected token|<!doctype|<html|\[object object\]|internal server error)/i;

export function safeTaskText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && !providerErrorText.test(normalized) ? normalized : fallback;
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recency(task: TaskRow) {
  const candidates = task.completed === true
    ? [task.completed_at, task.provider_updated_at, task.updated_at, task.provider_created_at, task.created_at]
    : [task.provider_updated_at, task.updated_at, task.provider_created_at, task.created_at];
  return Math.max(0, ...candidates.map(timestamp));
}

export function orderTasksByRecency(tasks: TaskRow[]) {
  return [...tasks].sort((left, right) => recency(right) - recency(left)
    || safeTaskText(left.title, "Untitled task").localeCompare(safeTaskText(right.title, "Untitled task")));
}

export function organizeTaskSections(tasks: TaskRow[], currentDate: string): TaskSection[] {
  const overdue = tasks.filter((task) => task.completed !== true && Boolean(dateOnly(task.due_date)) && String(dateOnly(task.due_date)) < currentDate)
    .sort((left, right) => String(dateOnly(left.due_date)).localeCompare(String(dateOnly(right.due_date))) || recency(right) - recency(left));
  const overdueIds = new Set(overdue.map(taskId));
  const open = orderTasksByRecency(tasks.filter((task) => task.completed !== true && !overdueIds.has(taskId(task))));
  const completed = orderTasksByRecency(tasks.filter((task) => task.completed === true));
  return [
    { id: "overdue", label: "Overdue", note: "Oldest due first", tasks: overdue },
    { id: "open", label: "Recent tasks", note: "Latest activity first", tasks: open },
    { id: "completed", label: "Recently completed", note: "Latest completion first", tasks: completed },
  ].filter((section) => section.tasks.length > 0) as TaskSection[];
}

function priorityRank(value: unknown) {
  const normalized = String(value ?? "").toLowerCase();
  if (["urgent", "critical", "highest", "high", "1"].includes(normalized)) return 0;
  if (["medium", "normal", "2"].includes(normalized)) return 1;
  if (["low", "3"].includes(normalized)) return 2;
  return 3;
}

export function suggestDailyGoal(tasks: TaskRow[], shiftDate: string, planItems: DailyPlanItem[] = []): GoalSuggestion {
  const sourceByTask = new Map(planItems.filter((item) => item.task_id).map((item) => [String(item.task_id), item.source]));
  const ranked = tasks
    .filter((task) => task.completed !== true && taskId(task))
    .map((task) => {
      const id = taskId(task);
      const due = dateOnly(task.due_date);
      const created = dateOnly(task.provider_created_at ?? task.created_at);
      const source = sourceByTask.get(id);
      const dateRank = due === shiftDate ? 0 : source === "carry_over" || (due && due < shiftDate) ? 1 : created === shiftDate ? 2 : 3;
      return { task, id, dateRank, priority: priorityRank(task.priority) };
    })
    .sort((left, right) => left.dateRank - right.dateRank || left.priority - right.priority || String(left.task.title ?? "").localeCompare(String(right.task.title ?? "")))
    .slice(0, 3);
  if (!ranked.length) return null;
  const titles = ranked.map(({ task }) => String(task.title ?? "Untitled task").trim()).filter(Boolean);
  const text = titles.length === 1
    ? `Focus on completing ${titles[0]}.`
    : titles.length === 2
      ? `Focus on completing ${titles[0]}, while progressing ${titles[1]}.`
      : `Focus on completing ${titles[0]}, while progressing ${titles[1]} and ${titles[2]}.`;
  return { text, taskIds: ranked.map(({ id }) => id) };
}

export function taskDateAttribution(task: TaskRow, currentDate: string, surfacedDate?: string | null) {
  if (task.dayAttribution?.date) {
    const reason = task.dayAttribution.reason === "due_date" ? "due"
      : task.dayAttribution.reason === "creation_observed" ? "created"
      : task.dayAttribution.reason === "carried" ? "carried"
      : "surfaced";
    return { date: String(task.dayAttribution.date), reason: reason as TaskDateReason };
  }
  const due = dateOnly(task.due_date);
  // A completed task belongs to the day the work actually happened: finished
  // after its logged-for date, it carries into the completion day while the
  // logged and completed dates stay visible on the task itself.
  const done = task.completed === true ? dateOnly(task.completed_at) : null;
  if (done && done <= currentDate) {
    if (due && done > due) return { date: done, reason: "carried" as const };
    if (due) return { date: due, reason: "due" as const };
    return { date: done, reason: "surfaced" as const };
  }
  if (due && due <= currentDate) return { date: due, reason: "due" as const };
  if (surfacedDate && surfacedDate <= currentDate) return { date: surfacedDate, reason: "surfaced" as const };
  const created = dateOnly(task.provider_created_at ?? task.created_at);
  if (created && created <= currentDate) return { date: created, reason: "created" as const };
  return { date: null, reason: "unknown" as const };
}

export function unfinishedBefore(tasks: TaskRow[], currentDate: string) {
  return tasks
    .filter((task) => task.completed !== true)
    .map((task) => ({ task, attribution: taskDateAttribution(task, currentDate) }))
    .filter(({ attribution }) => attribution.date !== null && attribution.date < currentDate)
    .sort((left, right) => String(right.attribution.date).localeCompare(String(left.attribution.date)) || String(left.task.title ?? "").localeCompare(String(right.task.title ?? "")));
}

export function uniqueTasks(tasks: TaskRow[]) {
  const result = new Map<string, TaskRow>();
  for (const task of tasks) {
    const id = taskId(task);
    if (id && !result.has(id)) result.set(id, task);
  }
  return [...result.values()];
}

export function parentTasks(tasks: TaskRow[]) {
  return tasks.filter((task) => !task.parent_provider_task_id && !task.parent_task_id);
}

export function taskKind(task: TaskRow): "task" | "subtask" {
  return task.parent_provider_task_id || task.parent_task_id ? "subtask" : "task";
}

export function tasksForDate(tasks: TaskRow[], date: string, surfacedTaskIds: string[] = []) {
  const surfaced = new Set(surfacedTaskIds.map(String));
  return uniqueTasks(tasks).filter((task) => {
    const id = taskId(task);
    const providerId = String(task.provider_task_id ?? "");
    return surfaced.has(id) || surfaced.has(providerId) || taskDateAttribution(task, date).date === date;
  });
}

export function filterWorkspaceTasks(tasks: TaskRow[], currentDate: string, filters: { query?: string; from?: string; to?: string }) {
  const query = filters.query?.trim().toLowerCase() ?? "";
  return tasks.filter((task) => {
    const searchable = [task.title, task.description, task.project?.name, task.milestone?.name]
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join(" ")
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    const attributedDate = taskDateAttribution(task, currentDate).date;
    if (filters.from && (!attributedDate || attributedDate < filters.from)) return false;
    if (filters.to && (!attributedDate || attributedDate > filters.to)) return false;
    return true;
  });
}

export function subtaskProgress(task: TaskRow) {
  const total = Number(task.subtaskProgress?.total ?? task.subtask_total ?? 0);
  const completed = Number(task.subtaskProgress?.completed ?? task.subtask_completed ?? 0);
  return {
    total: Number.isFinite(total) ? Math.max(0, total) : 0,
    completed: Number.isFinite(completed) ? Math.max(0, Math.min(completed, total)) : 0,
  };
}
