/** Attendance freshness for the employee dashboard.
 *
 * Worktivity is the attendance authority: activity alone can clock someone in
 * or out. The dashboard re-checks the provider on the same adaptive cadence as
 * the desktop companion — 30s while a transition is expected, 60s once steady —
 * and refreshes the day only when the tracked state actually moved. */
export type AttendanceWatchExpectation = "clock-in" | "clock-out" | null;

export const ATTENDANCE_PENDING_POLL_MS = 30_000;
export const ATTENDANCE_SETTLED_POLL_MS = 60_000;
/** Begin watching for the activity-driven clock-in just before the shift. */
const CLOCK_IN_LOOKAHEAD_MS = 2 * 60_000;
const ACTIVE_SESSION_STATES = new Set(["clocked_in", "active", "paused", "eod_due"]);

export interface AttendanceWatchInput {
  sessionState: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  attendanceState?: string | null;
  attendanceSource?: string | null;
  attendanceStale?: boolean;
  attendanceClockedOutAt?: string | null;
}

interface WatchDayShape {
  session?: { state?: unknown } | null;
  shift?: { startsAt?: unknown; endsAt?: unknown } | null;
  attendance?: { state?: unknown; source?: unknown; stale?: unknown; clockedOutAt?: unknown } | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);

export function attendanceWatchInput(day: WatchDayShape | null | undefined): AttendanceWatchInput | null {
  if (!day) return null;
  return {
    sessionState: text(day.session?.state),
    shiftStartsAt: text(day.shift?.startsAt),
    shiftEndsAt: text(day.shift?.endsAt),
    attendanceState: text(day.attendance?.state),
    attendanceSource: text(day.attendance?.source),
    attendanceStale: day.attendance?.stale === true,
    attendanceClockedOutAt: text(day.attendance?.clockedOutAt),
  };
}

export function attendanceWatchExpectation(input: AttendanceWatchInput | null, nowMs: number): AttendanceWatchExpectation {
  if (!input) return null;
  const active = !!input.sessionState && ACTIVE_SESSION_STATES.has(input.sessionState);
  const startsAt = input.shiftStartsAt ? Date.parse(input.shiftStartsAt) : Number.NaN;
  const endsAt = input.shiftEndsAt ? Date.parse(input.shiftEndsAt) : Number.NaN;
  const worktivityActive = input.attendanceSource === "worktivity" && !input.attendanceStale && (input.attendanceState === "active" || input.attendanceState === "paused");
  if (!active) {
    if (worktivityActive) return "clock-in";
    if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && nowMs >= startsAt - CLOCK_IN_LOOKAHEAD_MS && nowMs < endsAt) return "clock-in";
    return null;
  }
  if (input.attendanceSource === "worktivity" && !input.attendanceStale && input.attendanceState === "off_shift" && input.attendanceClockedOutAt) return "clock-out";
  if (Number.isFinite(endsAt) && nowMs >= endsAt) return "clock-out";
  return null;
}

export function attendanceWatchInterval(input: AttendanceWatchInput | null, nowMs: number): number {
  return attendanceWatchExpectation(input, nowMs) ? ATTENDANCE_PENDING_POLL_MS : ATTENDANCE_SETTLED_POLL_MS;
}
