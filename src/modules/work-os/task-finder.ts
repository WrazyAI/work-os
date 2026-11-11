export type TaskFinderStatus = "all" | "pending" | "in_progress" | "overdue" | "completed";
export type TaskFinderFilters = { search: string; status: TaskFinderStatus; from: string; to: string };

export const TASK_FINDER_STATUSES: ReadonlyArray<{ value: TaskFinderStatus; label: string }> = [
  { value: "all", label: "All" }, { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In progress" }, { value: "overdue", label: "Overdue" },
  { value: "completed", label: "Completed" },
];

function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Pure validation shared by the route, the query and offline preview. */
export function validateTaskFinderFilters(input: { search?: string; status?: string; from?: string; to?: string }): TaskFinderFilters {
  const search = input.search?.trim() ?? "";
  const status = input.status ?? "all";
  const from = input.from ?? "";
  const to = input.to ?? "";
  if (!TASK_FINDER_STATUSES.some(item => item.value === status)) throw new Error("Invalid task status");
  if (search.length > 200) throw new Error("Search must be 200 characters or fewer");
  if ((from && !calendarDate(from)) || (to && !calendarDate(to))) throw new Error("Choose a valid date");
  if (from && to && from > to) throw new Error("The date range must end on or after it starts");
  return { search, status: status as TaskFinderStatus, from, to };
}
