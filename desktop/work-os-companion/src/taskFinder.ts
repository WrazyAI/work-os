import { validateTaskFinderFilters, type TaskFinderFilters } from "../../../src/modules/work-os/task-finder";
import { taskDisplayState } from "../../../src/lib/work-os-task-permissions";
import { parentTasks, safeTaskText, taskDateAttribution, type TaskRow } from "./taskWorkspace";

export function taskFinderDatePreset(preset: "today" | "this_week" | "last_week", currentDate: string) {
  validateTaskFinderFilters({ from: currentDate });
  const start = new Date(`${currentDate}T12:00:00Z`);
  if (preset === "today") return { from: currentDate, to: currentDate };
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - (preset === "last_week" ? 7 : 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function taskFinderRangeError(from: string, to: string) {
  try { validateTaskFinderFilters({ from, to }); return ""; }
  catch (error) { return error instanceof Error ? error.message : "Choose a valid date range"; }
}

/** Adapter for local/offline sources; remote results are filtered in SQL. */
export function filterFinderTasks(rows: TaskRow[], filters: TaskFinderFilters, currentDate: string) {
  const { search, status, from, to } = validateTaskFinderFilters(filters);
  return parentTasks(rows).filter(task => {
    if (task.status === "archived" || task.status === "deleted") return false;
    const display = taskDisplayState(task, currentDate);
    if (status !== "all" && (display === "complete" ? "completed" : display) !== status) return false;
    if (search && ![task.title, task.description, task.project?.name].map(value => safeTaskText(value, "")).join(" ").toLowerCase().includes(search.toLowerCase())) return false;
    const date = taskDateAttribution(task, currentDate).date;
    return (!from || (date !== null && date >= from)) && (!to || (date !== null && date <= to));
  });
}
