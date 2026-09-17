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

/**
 * Single overdue definition for every surface (design §27.3): open work with a
 * real due date before the current workday. Undated older work is unfinished
 * carry-over, never overdue.
 */
export function isOverdueTask(task: TaskRow, currentDate: string) {
  if (task.completed === true) return false;
  const due = dateOnly(task.due_date);
  return due !== null && due < currentDate;
}

export function taskState(task: TaskRow, currentDate: string) {
  if (task.completed === true) return "complete" as const;
  return isOverdueTask(task, currentDate) ? "overdue" as const : "open" as const;
}

export type TaskSortKey = "title" | "status" | "due" | "priority" | "activity";
export type TaskSortDirection = "asc" | "desc";
export type TaskSort = { key: TaskSortKey; direction: TaskSortDirection };

export const DEFAULT_TASK_SORT: TaskSort = { key: "status", direction: "asc" };
export const TASKS_SORT_STORAGE_KEY = "work-os.tasks-sort.v1";
export const DAY_SORT_STORAGE_KEY = "work-os.day-sort.v1";

export const TASK_SORT_COLUMNS: ReadonlyArray<{ key: TaskSortKey; label: string; initialDirection: TaskSortDirection }> = [
  { key: "title", label: "Task", initialDirection: "asc" },
  { key: "status", label: "Status", initialDirection: "asc" },
  { key: "due", label: "Due", initialDirection: "asc" },
  { key: "priority", label: "Priority", initialDirection: "asc" },
  { key: "activity", label: "Activity", initialDirection: "desc" },
];

const TASK_SORT_KEYS = TASK_SORT_COLUMNS.map((column) => column.key);

export function readTaskSort(storageKey: string): TaskSort {
  try {
    if (typeof window === "undefined" || !window.localStorage) return { ...DEFAULT_TASK_SORT };
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) as Partial<TaskSort> | null : null;
    if (parsed && TASK_SORT_KEYS.includes(parsed.key as TaskSortKey) && (parsed.direction === "asc" || parsed.direction === "desc")) {
      return { key: parsed.key as TaskSortKey, direction: parsed.direction };
    }
  } catch { /* best effort: a corrupt preference never blocks the list */ }
  return { ...DEFAULT_TASK_SORT };
}

export function writeTaskSort(storageKey: string, sort: TaskSort) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(storageKey, JSON.stringify(sort));
  } catch { /* best effort */ }
}

export function taskSortNote(sort: TaskSort): string {
  switch (sort.key) {
    case "status": return sort.direction === "asc" ? "Overdue first, then due date" : "Completed first, then due date";
    case "due": return sort.direction === "asc" ? "Due date · soonest first" : "Due date · latest first";
    case "priority": return sort.direction === "asc" ? "Priority · highest first" : "Priority · lowest first";
    case "activity": return sort.direction === "asc" ? "Oldest activity first" : "Latest activity first";
    case "title": return sort.direction === "asc" ? "Title A–Z" : "Title Z–A";
  }
}

function compareDueDirectional(left: TaskRow, right: TaskRow, direction: TaskSortDirection) {
  const leftDue = dateOnly(left.due_date);
  const rightDue = dateOnly(right.due_date);
  if (!leftDue && !rightDue) return 0;
  // Undated work sorts last in both directions so it never buries dated work.
  if (!leftDue) return 1;
  if (!rightDue) return -1;
  return direction === "asc" ? leftDue.localeCompare(rightDue) : rightDue.localeCompare(leftDue);
}

function statusRank(task: TaskRow, currentDate: string) {
  if (task.completed === true) return 2;
  return isOverdueTask(task, currentDate) ? 0 : 1;
}

export function compareTaskSort(left: TaskRow, right: TaskRow, sort: TaskSort, currentDate: string) {
  const direction = sort.direction === "asc" ? 1 : -1;
  // byRecency already reads newest-first, so ascending activity flips it.
  const recencyDirection = sort.direction === "asc" ? -1 : 1;
  const byTitle = () => safeTaskText(left.title, "Untitled task").localeCompare(safeTaskText(right.title, "Untitled task"));
  const byRecency = () => recency(right) - recency(left);
  const byStatus = () => (statusRank(left, currentDate) - statusRank(right, currentDate)) * direction;
  switch (sort.key) {
    case "status": return byStatus() || compareDueDirectional(left, right, "asc") || byRecency() || byTitle();
    case "due": return compareDueDirectional(left, right, sort.direction) || (statusRank(left, currentDate) - statusRank(right, currentDate)) || byRecency() || byTitle();
    case "priority": return (priorityRank(left.priority) - priorityRank(right.priority)) * direction || (statusRank(left, currentDate) - statusRank(right, currentDate)) || compareDueDirectional(left, right, "asc") || byRecency() || byTitle();
    case "activity": return byRecency() * recencyDirection || byTitle();
    case "title": return byTitle() * direction || byRecency();
  }
}

export function sortTaskList(tasks: TaskRow[], sort: TaskSort = DEFAULT_TASK_SORT, currentDate = "") {
  return [...tasks].sort((left, right) => compareTaskSort(left, right, sort, currentDate));
}

export function organizeTaskSections(tasks: TaskRow[], currentDate: string, sort: TaskSort = DEFAULT_TASK_SORT): TaskSection[] {
  const overdueTasks = tasks.filter((task) => isOverdueTask(task, currentDate));
  const overdueIds = new Set(overdueTasks.map(taskId));
  const openTasks = tasks.filter((task) => task.completed !== true && !overdueIds.has(taskId(task)));
  const completedTasks = tasks.filter((task) => task.completed === true);
  // The Status column orders the sections themselves; every other column orders
  // rows inside each section so the red-led overdue group never loses its place.
  const canonicalOverdue = [...overdueTasks].sort((left, right) => String(dateOnly(left.due_date)).localeCompare(String(dateOnly(right.due_date))) || recency(right) - recency(left));
  const within = (group: TaskRow[], canonical: TaskRow[]) => sort.key === "status" ? canonical : sortTaskList(group, sort, currentDate);
  const sections = ([
    { id: "overdue", label: "Overdue", note: sort.key === "status" ? "Oldest due first" : taskSortNote(sort), tasks: within(overdueTasks, canonicalOverdue) },
    { id: "open", label: "Recent tasks", note: sort.key === "status" ? "Latest activity first" : taskSortNote(sort), tasks: within(openTasks, orderTasksByRecency(openTasks)) },
    { id: "completed", label: "Recently completed", note: sort.key === "status" ? "Latest completion first" : taskSortNote(sort), tasks: within(completedTasks, orderTasksByRecency(completedTasks)) },
  ] satisfies TaskSection[]).filter((section) => section.tasks.length > 0);
  return sort.key === "status" && sort.direction === "desc" ? [...sections].reverse() : sections;
}

/**
 * The day-scoped set shared by the dashboard hero and the Tasks workspace
 * (design §27.3): tasks surfaced by today's plan, due today, or attributed to
 * today. Counts on every surface derive from this same list.
 */
export function dayScopedTasks(dayTasks: TaskRow[], planItems: DailyPlanItem[], currentDate: string, history: TaskRow[] = []) {
  const historyById = new Map<string, TaskRow>();
  for (const task of history) {
    historyById.set(String(task.id), task);
    if (task.provider_task_id) historyById.set(String(task.provider_task_id), task);
  }
  const items = planItems.filter((item) => item.task_id && item.disposition !== "removed");
  const surfaced = items.map((item) => historyById.get(String(item.task_id)) ?? {
    id: item.task_id,
    title: item.title_snapshot,
    completed: item.completion_state === "completed",
    workspace_source: item.source,
  });
  const surfacedIds = items.map((item) => String(item.task_id));
  return parentTasks(tasksForDate(uniqueTasks([...dayTasks, ...surfaced]), currentDate, surfacedIds));
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
