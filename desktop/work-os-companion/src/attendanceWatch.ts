import type { DayData } from "./types";

/** Attendance freshness, in one place.
 *
 * Worktivity is the attendance authority: a clock-in or clock-out can be
 * observed from activity without anyone touching Work OS. The companion
 * therefore re-checks the provider on an adaptive cadence — fast while a
 * transition is expected, calm once the state is steady — and refreshes the
 * workspace only when something actually moved. `design.md` §8.7 owns the
 * contract. */
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
  /** Worktivity projection, present on surfaces that load it. */
  attendanceState?: string | null;
  attendanceSource?: string | null;
  attendanceStale?: boolean;
  attendanceClockedOutAt?: string | null;
}

/** Narrow a day payload to the fields the watch reasons about, so the main
 * window and the floating companion share one cadence rule. */
export function attendanceWatchInput(day: Pick<DayData, "session" | "shift" | "attendance"> | null): AttendanceWatchInput | null {
  if (!day) return null;
  return {
    sessionState: day.session?.state ?? null,
    shiftStartsAt: day.shift?.startsAt ?? null,
    shiftEndsAt: day.shift?.endsAt ?? null,
    attendanceState: day.attendance?.state ?? null,
    attendanceSource: day.attendance?.source ?? null,
    attendanceStale: day.attendance?.stale ?? false,
    attendanceClockedOutAt: day.attendance?.clockedOutAt ?? null,
  };
}

export function attendanceWatchExpectation(input: AttendanceWatchInput | null, nowMs: number): AttendanceWatchExpectation {
  if (!input) return null;
  const active = !!input.sessionState && ACTIVE_SESSION_STATES.has(input.sessionState);
  const startsAt = input.shiftStartsAt ? Date.parse(input.shiftStartsAt) : Number.NaN;
  const endsAt = input.shiftEndsAt ? Date.parse(input.shiftEndsAt) : Number.NaN;
  const worktivityActive = input.attendanceSource === "worktivity" && !input.attendanceStale && (input.attendanceState === "active" || input.attendanceState === "paused");
  if (!active) {
    // Provider activity that has not been mirrored yet, or a startable shift
    // window with no session: watch for the activity-driven clock-in.
    if (worktivityActive) return "clock-in";
    if (Number.isFinite(startsAt) && Number.isFinite(endsAt) && nowMs >= startsAt - CLOCK_IN_LOOKAHEAD_MS && nowMs < endsAt) return "clock-in";
    return null;
  }
  // Active session: watch for the activity-driven close at or after the
  // scheduled end, or when the provider has already observed it.
  if (input.attendanceSource === "worktivity" && !input.attendanceStale && input.attendanceState === "off_shift" && input.attendanceClockedOutAt) return "clock-out";
  if (Number.isFinite(endsAt) && nowMs >= endsAt) return "clock-out";
  return null;
}

export function attendanceWatchInterval(input: AttendanceWatchInput | null, nowMs: number): number {
  return attendanceWatchExpectation(input, nowMs) ? ATTENDANCE_PENDING_POLL_MS : ATTENDANCE_SETTLED_POLL_MS;
}
