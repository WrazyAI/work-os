export type TaskWorkflowStatus = "pending" | "in_progress";
export type TaskDisplayState = "pending" | "in_progress" | "overdue" | "complete";
export type TaskActor = { role: "admin" | "manager" | "employee"; personId: string | null };
export type TaskCapabilities = {
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  canAssign: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canChangeStatus: boolean;
  canMove: boolean;
  statusLocked: boolean;
  overdue: boolean;
};

const datePrefix = /^\d{4}-\d{2}-\d{2}/;

export function isWorkflowStatus(value: unknown): value is TaskWorkflowStatus {
  return value === "pending" || value === "in_progress";
}

export function taskAssignerId(task: Record<string, any>): string | null {
  return typeof task.assigned_by_person_id === "string" ? task.assigned_by_person_id : null;
}

/** A real `YYYY-MM-DD` calendar day. Impossible dates such as `2026-02-30`
 *  and loose values such as `soon` are rejected before any write, so a
 *  malformed due date can never enter the record and silently disable the
 *  overdue lock. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function taskIsOverdue(task: Record<string, any>, today: string): boolean {
  if (task.completed === true || typeof task.due_date !== "string") return false;
  const dueDate = task.due_date.match(datePrefix)?.[0];
  if (dueDate === undefined || !isCalendarDate(dueDate)) return false;
  return dueDate < today;
}

export function taskDisplayState(task: Record<string, any>, today: string): TaskDisplayState {
  if (task.completed === true) return "complete";
  if (taskIsOverdue(task, today)) return "overdue";
  return task.workflow_status === "in_progress" ? "in_progress" : "pending";
}

export function taskCapabilities(task: Record<string, any>, actor: TaskActor, today: string): TaskCapabilities {
  const completed = task.completed === true;
  const admin = actor.role === "admin";
  const isAssignee = actor.personId !== null
    && Array.isArray(task.assignee_person_ids)
    && task.assignee_person_ids.includes(actor.personId);
  const assignerId = taskAssignerId(task);
  // A null assigner means the record has no assigner at all, so only an
  // administrator may manage it. The 0066 single-assignee backfill already
  // gave legacy single-assignee rows their assigner; the old runtime fallback
  // let an unmapped admin's assignment hand management to an assignee.
  const isAssigner = actor.personId !== null && assignerId !== null && assignerId === actor.personId;
  const canEdit = admin || isAssigner;
  const overdue = taskIsOverdue(task, today);
  const statusLocked = !completed && overdue;

  return {
    canEdit,
    canArchive: canEdit,
    canDelete: canEdit,
    canAssign: canEdit,
    canComplete: !completed && (admin || isAssignee),
    canReopen: completed && (admin || isAssignee),
    canChangeStatus: !statusLocked && (admin || isAssigner || isAssignee),
    canMove: canEdit,
    statusLocked,
    overdue,
  };
}
