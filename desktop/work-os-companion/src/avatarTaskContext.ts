/** Pure helpers that turn the avatar's already-fetched task options into a
 * truthful pending/overdue summary. No fetching, no mutation, no throwing on
 * malformed provider dates — an invalid date simply means "no due date". */

export interface AvatarTaskOption {
  id: string;
  title: string;
  dueDate: string | null;
  completed: boolean;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  subtasks?: Array<{ id: string; title: string; completed?: boolean }>;
}

export interface AvatarTaskCardItem extends AvatarTaskOption {
  overdue: boolean;
}

export interface AvatarTaskContext {
  /** Overdue-first visible slice for the card (bounded). */
  visible: AvatarTaskCardItem[];
  pendingCount: number;
  overdueCount: number;
}

function dateOnly(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1]! : null;
}

/** Splits open tasks into overdue (due before the shift date) and pending.
 * Completed tasks are excluded from the card but reported separately by the
 * existing shift signals. */
export function deriveTaskContext(
  tasks: AvatarTaskOption[],
  shiftDate: string,
  maxVisible = 8,
): AvatarTaskContext {
  const open = tasks.filter((task) => !task.completed && !!task.id);
  const overdue = open
    .filter((task) => {
      const due = dateOnly(task.dueDate);
      return due !== null && shiftDate !== "" && due < shiftDate;
    })
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const overdueIds = new Set(overdue.map((task) => task.id));
  const pending = open
    .filter((task) => !overdueIds.has(task.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const visible: AvatarTaskCardItem[] = [
    ...overdue.map((task) => ({ ...task, overdue: true })),
    ...pending.map((task) => ({ ...task, overdue: false })),
  ].slice(0, Math.max(0, maxVisible));
  return { visible, pendingCount: pending.length, overdueCount: overdue.length };
}

/** Compact card title that always states both counts, e.g.
 * "Today's tasks · 3 pending · 1 overdue". */
export function taskContextTitle(context: AvatarTaskContext): string {
  const pending = `${context.pendingCount} pending`;
  const overdue = `${context.overdueCount} overdue`;
  return `Today's tasks · ${pending} · ${overdue}`;
}
