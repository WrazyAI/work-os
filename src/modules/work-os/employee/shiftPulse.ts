/** Shift-time instrument shared with the companion (shiftPulse parity).
 *
 * Elapsed and remaining time are attendance data, not a score: the progress
 * percent bounds the scheduled window only, and paused time is subtracted from
 * the working clock exactly as the provider reports it. */

export interface ShiftPulse {
  elapsedLabel: string;
  breakLabel: string;
  breakSeconds: number;
  progressPercent: number;
  observedElapsedLabel: string;
  observedBreakLabel: string;
  schedulePhase: "unavailable" | "upcoming" | "in_progress" | "complete";
}

export interface ShiftPulseSession {
  state?: unknown;
  clocked_in_at?: unknown;
  clocked_out_at?: unknown;
  paused_seconds?: unknown;
  provider_break_seconds?: unknown;
}

export interface ShiftPulseShift {
  startsAt?: unknown;
  endsAt?: unknown;
}

export interface ShiftPulseAttendance {
  state?: unknown;
  stale?: unknown;
  clockedInAt?: unknown;
  clockedOutAt?: unknown;
  activityObservedAt?: unknown;
  providerBreakSeconds?: unknown;
}

function validTime(value?: unknown) {
  const parsed = typeof value === "string" && value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function shiftPulse(
  session: ShiftPulseSession | null | undefined,
  shift: ShiftPulseShift | null | undefined,
  now = new Date(),
  worktivityAuthoritativeBreaks = false,
  attendance?: ShiftPulseAttendance | null,
): ShiftPulse {
  const startsAt = validTime(shift?.startsAt);
  const endsAt = validTime(shift?.endsAt);
  const schedulePhase = startsAt === null || endsAt === null || endsAt <= startsAt
    ? "unavailable"
    : now.getTime() < startsAt
      ? "upcoming"
      : now.getTime() >= endsAt
        ? "complete"
        : "in_progress";
  const progressPercent = startsAt !== null && endsAt !== null && endsAt > startsAt
    ? Math.max(0, Math.min(100, ((now.getTime() - startsAt) / (endsAt - startsAt)) * 100))
    : 0;
  const observedClockedInAt = validTime(attendance?.clockedInAt);
  const observedClockedOutAt = validTime(attendance?.clockedOutAt);
  const activityObservedAt = validTime(attendance?.activityObservedAt);
  const observedBreakSeconds = Math.max(0, worktivityAuthoritativeBreaks ? (Number(attendance?.providerBreakSeconds) || 0) : 0);
  const providerCurrentlyActive = !attendance?.stale && (attendance?.state === "active" || attendance?.state === "paused");
  const observedEnd = observedClockedOutAt ?? (providerCurrentlyActive ? now.getTime() : activityObservedAt ?? observedClockedInAt ?? now.getTime());
  const observedElapsedMs = observedClockedInAt === null ? 0 : Math.max(0, observedEnd - observedClockedInAt - observedBreakSeconds * 1000);
  const observedMinutes = Math.floor(observedElapsedMs / 60_000);
  const observedBreakMinutes = Math.floor(observedBreakSeconds / 60);
  const observedElapsedLabel = `${String(Math.floor(observedMinutes / 60)).padStart(2, "0")}:${String(observedMinutes % 60).padStart(2, "0")}`;
  const observedBreakLabel = `${String(Math.floor(observedBreakMinutes / 60)).padStart(2, "0")}:${String(observedBreakMinutes % 60).padStart(2, "0")}`;
  const clockedInAt = validTime(session?.clocked_in_at);
  if (!session || clockedInAt === null || session.state === "clocked_out") {
    return { elapsedLabel: "00:00", breakLabel: "00:00", breakSeconds: 0, progressPercent, observedElapsedLabel, observedBreakLabel, schedulePhase };
  }
  const clockedOutAt = validTime(session.clocked_out_at);
  const end = clockedOutAt ?? now.getTime();
  const breakSeconds = Math.max(0, worktivityAuthoritativeBreaks
    ? (Number(session.provider_break_seconds) || 0)
    : (Number(session.paused_seconds) || 0));
  const elapsedMs = Math.max(0, end - clockedInAt - breakSeconds * 1000);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedLabel = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  const breakMinutes = Math.floor(breakSeconds / 60);
  const breakLabel = `${String(Math.floor(breakMinutes / 60)).padStart(2, "0")}:${String(breakMinutes % 60).padStart(2, "0")}`;
  return { elapsedLabel, breakLabel, breakSeconds, progressPercent, observedElapsedLabel, observedBreakLabel, schedulePhase };
}

/** Remaining scheduled time as a compact label, or null when unavailable. */
export function remainingShiftLabel(shift: ShiftPulseShift | null | undefined, now = new Date()): string | null {
  const endsAt = validTime(shift?.endsAt);
  if (endsAt === null) return null;
  const remainingMs = endsAt - now.getTime();
  if (remainingMs <= 0) return null;
  const minutes = Math.floor(remainingMs / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m remaining` : `${minutes}m remaining`;
}

/** Time until the scheduled start as a compact label, or null when underway. */
export function untilShiftLabel(shift: ShiftPulseShift | null | undefined, now = new Date()): string | null {
  const startsAt = validTime(shift?.startsAt);
  if (startsAt === null) return null;
  const upcomingMs = startsAt - now.getTime();
  if (upcomingMs <= 0) return null;
  const minutes = Math.max(1, Math.round(upcomingMs / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m until your shift` : `${minutes}m until your shift`;
}
