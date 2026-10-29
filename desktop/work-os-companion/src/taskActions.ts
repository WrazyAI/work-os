import { taskDisplayState, taskIsOverdue, type TaskCapabilities, type TaskDisplayState } from "../../../src/lib/work-os-task-permissions";
import type { TaskRow } from "./taskWorkspace";

export type TaskMenuAction = "pending" | "in_progress" | "complete" | "reopen" | "edit" | "assign" | "archive" | "delete";

/** The reason a capability-gated checkbox is inert. */
export const COMPLETION_BLOCKED_LABEL = "Only this task's assignee can change completion.";

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

/** The stored manual status a payload carries. A missing value is the pending
 *  default the server writes, so a cached row and a fresh row agree. */
export function currentTaskStatus(task: TaskRow): "pending" | "in_progress" {
  return task.workflow_status === "in_progress" ? "in_progress" : "pending";
}

/** Whether a status request would change anything. Rewriting the status a task
 *  already holds is a no-op write and an extra audit row, so callers skip it. */
export function taskStatusWriteRequired(task: TaskRow, status: "pending" | "in_progress"): boolean {
  return currentTaskStatus(task) !== status;
}

export function taskStatusOptions(task: TaskRow, today: string): Array<{ value: "pending" | "in_progress"; label: string; disabled: boolean; active: boolean; note?: string }> {
  const caps = capabilitiesFor(task);
  if (!caps) return [];
  const completed = task.completed === true;
  const allowed = canRequestStatus(caps);
  // The option that carries the check mark is the status the row displays, so
  // the mark and the disabled state can never disagree. Choosing it would write
  // the value the task already holds, so it is inert.
  const displayed = displayTaskState(task, today);
  // The due-date note is only truthful for someone who can actually move the
  // due date. An assignee of an overdue task may not, so they get no status
  // control at all rather than a note they cannot act on. A completed task has
  // no status path at all: the server refuses to change a done task's status.
  const note = !completed && caps.statusLocked && caps.canEdit ? "Update the due date first" : undefined;
  return (["pending", "in_progress"] as const).map((value) => {
    const active = displayed === value;
    return {
      value,
      label: taskStatusLabel(value),
      disabled: completed || !allowed || caps.statusLocked || active,
      active,
      ...(note ? { note } : {}),
    };
  });
}

/** Whether a row's completion checkbox is an allowed action. A cached payload
 *  without capabilities keeps the legacy behavior; a live payload never offers
 *  a write the server would refuse. */
export function taskCheckboxEnabled(task: TaskRow): boolean {
  const caps = capabilitiesFor(task);
  if (!caps) return true;
  return task.completed === true ? caps.canReopen : caps.canComplete;
}

/** The accessible name (and reason) for a row's completion checkbox. A
 *  checkbox disabled by capabilities says why, so a greyed check is not a dead
 *  end; every other state keeps the action verb it performs. */
export function taskCheckboxA11y(task: TaskRow, completing: boolean, title: string): { "aria-label": string; title?: string } {
  const blocked = taskCheckboxEnabled(task) ? null : COMPLETION_BLOCKED_LABEL;
  return {
    "aria-label": blocked ?? (completing ? `Completing ${title}` : task.completed === true ? `Reopen ${title}` : `Complete ${title}`),
    ...(blocked ? { title: blocked } : {}),
  };
}

/** Rebuild the derived capability flags after a confirmed write. Both a
 *  completion flip and a due-date edit move the overdue lock, so a cached
 *  payload must be recomputed from the merged row instead of waiting for the
 *  next refetch. Completion rights flip with `completed`; the overdue lock and
 *  `canChangeStatus` follow the due date. */
export function patchedTaskCapabilities(task: TaskRow, today: string): TaskCapabilities | null {
  const capabilities = task.capabilities ?? null;
  if (!capabilities) return null;
  const completed = task.completed === true;
  const overdue = taskIsOverdue({ ...task, completed }, today);
  const statusLocked = !completed && overdue;
  // `canChangeStatus` folds the lock into itself, so recover the actor's
  // underlying permission from the flags that outlive it: an editor, completer,
  // or reopener could change status once the due date moves.
  const canRequestStatus = capabilities.canChangeStatus
    || (capabilities.statusLocked && (capabilities.canEdit || capabilities.canComplete || capabilities.canReopen));
  const canFinish = capabilities.canComplete || capabilities.canReopen;
  return {
    ...capabilities,
    canComplete: !completed && canFinish,
    canReopen: completed && canFinish,
    canChangeStatus: !statusLocked && canRequestStatus,
    statusLocked,
    overdue,
  };
}

/** The capability payload after a confirmed completion flip, so a just-
 *  completed row offers Reopen without waiting for the next refetch. A manager
 *  who may only edit keeps its management flags untouched; completing never
 *  grants an action the actor did not already hold. The overdue lock is
 *  recomputed from the row's due date, because the completed payload it was
 *  restored from had already cleared it. */
export function completionTaskCapabilities(task: TaskRow, completed: boolean, today: string): TaskCapabilities | null {
  return patchedTaskCapabilities({ ...task, completed }, today);
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
