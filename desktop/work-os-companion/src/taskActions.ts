import { taskDisplayState, taskCapabilities, type TaskCapabilities, type TaskDisplayState } from "../../../src/lib/work-os-task-permissions";
import type { TaskRow } from "./taskWorkspace";

export type TaskMenuAction = "pending" | "in_progress" | "complete" | "reopen" | "edit" | "assign" | "archive" | "delete";

export function displayTaskState(task: TaskRow, today: string): TaskDisplayState {
  return taskDisplayState(task, today);
}

export function taskStatusLabel(state: TaskDisplayState): string {
  return { pending: "Pending", in_progress: "In progress", overdue: "Overdue", complete: "Done" }[state];
}

function capabilitiesFor(task: TaskRow, today: string): TaskCapabilities {
  if (task.capabilities) return task.capabilities;
  const capabilities = taskCapabilities(task, { role: "employee", personId: null }, today);
  // Older employee-list payloads do not identify the current actor. Assigned
  // rows may retain employee lifecycle controls, never management controls.
  const assigned = Array.isArray(task.assignee_person_ids) && task.assignee_person_ids.length > 0;
  return { ...capabilities, canComplete: assigned && task.completed !== true, canReopen: assigned && task.completed === true, canChangeStatus: assigned && !capabilities.statusLocked };
}

export function taskActionItems(task: TaskRow, today: string): TaskMenuAction[] {
  const caps = capabilitiesFor(task, today);
  return [
    ...(caps.canChangeStatus && !caps.statusLocked ? ["pending", "in_progress"] as const : []),
    ...(caps.canComplete && task.completed !== true ? ["complete"] as const : []),
    ...(caps.canReopen && task.completed === true ? ["reopen"] as const : []),
    ...(caps.canEdit ? ["edit"] as const : []),
    ...(caps.canAssign ? ["assign"] as const : []),
    ...(caps.canArchive ? ["archive"] as const : []),
    ...(caps.canDelete ? ["delete"] as const : []),
  ];
}

export function taskStatusOptions(task: TaskRow, today: string): Array<{ value: "pending" | "in_progress"; label: string; disabled: boolean; note?: string }> {
  const caps = capabilitiesFor(task, today);
  return (["pending", "in_progress"] as const).map((value) => ({ value, label: taskStatusLabel(value), disabled: caps.statusLocked || !caps.canChangeStatus, ...(caps.statusLocked ? { note: "Update the due date first" } : {}) }));
}
