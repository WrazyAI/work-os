/** Shared administration task date, status and default-order rules.
 *
 * This module is intentionally dependency-free: the companion imports it
 * directly, and the server reads and the task record must not drift from the
 * values the operator sees. */
export const ADMIN_TASK_DEFAULT_LIMIT = 50;
export const ADMIN_TASK_MAX_LIMIT = 100;

export type AdminTaskDateFields = {
  createdDate: string | null;
  effectiveDueDate: string | null;
};

const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Explicitly zoned ISO timestamps only. A timezone-less timestamp is
// ambiguous and is rejected rather than interpreted in the host's local zone.
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

function calendarDay(value: string): string | null {
  if (!STRICT_DATE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day
    ? value
    : null;
}

/** The recorded calendar day a date-shaped value states. A bare `YYYY-MM-DD`
 * keeps its validated recorded day. A timestamp must be ISO with an explicit
 * `Z` or numeric offset; it canonicalizes to its stored UTC day. A
 * timezone-less timestamp is rejected instead of using the host's local zone,
 * and a timestamp with an invalid calendar date is rejected before `Date` can
 * normalize it. PostgreSQL `timestamptz` has already lost the provider's
 * original offset, so SQL, pg `Date` and serialized strings agree on UTC
 * rather than guess a viewer-local day. Empty or unreadable values are not
 * recorded. */
export function adminTaskCalendarDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length === 10) return calendarDay(text);
  const match = TIMESTAMP.exec(text);
  if (!match || !calendarDay(match[1])) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function addAdminTaskDays(value: string, amount: number): string | null {
  const day = calendarDay(value);
  if (!day) return null;
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + amount);
  return at.toISOString().slice(0, 10);
}

/** The created date the row states: the provider's own creation stamp first,
 * then the local record. */
export function taskCreatedDate(row: Record<string, unknown>): string | null {
  return adminTaskCalendarDate(row.provider_created_at)
    ?? adminTaskCalendarDate(row.created_at);
}

/** The effective due date: the recorded due date when valid, otherwise one
 * calendar day after the created date. */
export function taskEffectiveDueDate(row: Record<string, unknown>): string | null {
  const recorded = adminTaskCalendarDate(row.due_date);
  if (recorded) return recorded;
  const created = taskCreatedDate(row);
  return created ? addAdminTaskDays(created, 1) : null;
}

export function adminTaskDates(row: Record<string, unknown>): AdminTaskDateFields {
  return {
    createdDate: taskCreatedDate(row),
    effectiveDueDate: taskEffectiveDueDate(row),
  };
}

export function adminTaskTitle(row: Record<string, unknown>): string {
  return String(row.title ?? row.name ?? "").trim();
}

/** 0 = Overdue, 1 = Open, 2 = Done — the same predicate the status pill and
 * the administration record read. A row whose record states no completion
 * flag claims no rank. */
export function adminTaskStatusRank(row: Record<string, unknown>, today: string): 0 | 1 | 2 | null {
  if (typeof row.completed !== "boolean") return null;
  if (row.completed) return 2;
  const due = taskEffectiveDueDate(row);
  return due && due < today ? 0 : 1;
}

function updatedInstant(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareText(left: string, right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullable<T>(
  left: T | null,
  right: T | null,
  direction: 1 | -1,
  compare: (a: T, b: T) => number,
) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction * compare(left, right);
}

/** The administration record's default order: created day newest first, then
 * updated instant newest first, then effective due date newest first, then
 * casefolded title and id ascending. Missing values stay last at every step. */
export function compareAdminTaskDefaultOrder(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const numeric = (a: number, b: number) => a - b;
  const leftDates = adminTaskDates(left);
  const rightDates = adminTaskDates(right);
  return compareNullable(leftDates.createdDate, rightDates.createdDate, -1, (a, b) => a.localeCompare(b))
    || compareNullable(updatedInstant(left.updated_at), updatedInstant(right.updated_at), -1, numeric)
    || compareNullable(leftDates.effectiveDueDate, rightDates.effectiveDueDate, -1, (a, b) => a.localeCompare(b))
    || compareNullable(adminTaskTitle(left) || null, adminTaskTitle(right) || null, 1, compareText)
    || compareNullable(String(left.id ?? "") || null, String(right.id ?? "") || null, 1, compareText);
}
