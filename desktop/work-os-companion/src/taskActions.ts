import { taskDisplayState, type TaskCapabilities, type TaskDisplayState } from "../../../src/lib/work-os-task-permissions";
import type { TaskRow } from "./taskWorkspace";

export type TaskMenuAction = "pending" | "in_progress" | "complete" | "reopen" | "edit" | "assign" | "archive" | "delete";

export function displayTaskState(task: TaskRow, today: string): TaskDisplayState {
  return taskDisplayState(task, today);
}

export function taskStatusLabel(state: TaskDisplayState): string {
  return { pending: "Pending", in_progress: "In progress", overdue: "Overdue", complete: "Done" }[state];
}

function capabilitiesFor(task: TaskRow): TaskCapabilities | null {
  // Cached payloads predate the capability seam. Guessing from assignees can
  // advertise actions the server rejects, so show no menu until the refresh.
  return task.capabilities ?? null;
}

/** Whether the actor may ever change the workflow status. The pure helper
 *  folds the overdue lock into `canChangeStatus`, so an actor who could change
 *  status once the due date moves still reads as false; recover their
 *  underlying permission from the other capability flags. */
function canRequestStatus(capabilities: TaskCapabilities): boolean {
  return capabilities.canChangeStatus
    || (capabilities.statusLocked && (capabilities.canEdit || capabilities.canComplete || capabilities.canReopen));
}

export function taskActionItems(task: TaskRow, today: string): TaskMenuAction[] {
  const caps = capabilitiesFor(task);
  if (!caps) return [];
  const completed = task.completed === true;
  return [
    ...(!completed && caps.canChangeStatus && !caps.statusLocked ? ["pending", "in_progress"] as const : []),
    ...(caps.canComplete && !completed ? ["complete"] as const : []),
    ...(caps.canReopen && completed ? ["reopen"] as const : []),
    ...(caps.canEdit ? ["edit"] as const : []),
    ...(caps.canAssign ? ["assign"] as const : []),
    ...(caps.canArchive ? ["archive"] as const : []),
    ...(caps.canDelete ? ["delete"] as const : []),
  ];
}

export function taskStatusOptions(task: TaskRow, today: string): Array<{ value: "pending" | "in_progress"; label: string; disabled: boolean; note?: string }> {
  const caps = capabilitiesFor(task);
  if (!caps) return [];
  const completed = task.completed === true;
  const allowed = canRequestStatus(caps);
  // The due-date note is only truthful for someone who can actually move the
  // due date. An assignee of an overdue task may not, so they get no status
  // control at all rather than a note they cannot act on. A completed task has
  // no status path at all: the server refuses to change a done task's status.
  const note = !completed && caps.statusLocked && caps.canEdit ? "Update the due date first" : undefined;
  return (["pending", "in_progress"] as const).map((value) => ({ value, label: taskStatusLabel(value), disabled: completed || !allowed || caps.statusLocked, ...(note ? { note } : {}) }));
}

/** One predicate for "this row has a menu", shared by every trigger so a row
 *  can never open an empty popover. */
export function hasTaskMenu(task: TaskRow, today: string): boolean {
  return taskActionItems(task, today).length > 0
    || taskStatusOptions(task, today).some((option) => !option.disabled || option.note);
}

/** The value the due-date editor starts from: only a real `YYYY-MM-DD` prefix
 *  seeds it, so a malformed payload opens empty instead of letting a bad string
 *  reach the PATCH. */
export function taskDueDateSeed(value: unknown): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}
