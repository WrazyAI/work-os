import type { AttendanceProjection, DayData, WorkSession } from "./types";

export interface ShiftPulse {
  elapsedLabel: string;
  breakLabel: string;
  breakSeconds: number;
  progressPercent: number;
  observedElapsedLabel: string;
  observedBreakLabel: string;
  schedulePhase: "unavailable" | "upcoming" | "in_progress" | "complete";
}

function validTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function shiftPulse(
  session: WorkSession | null | undefined,
  shift: DayData["shift"],
  now = new Date(),
  worktivityAuthoritativeBreaks = false,
  attendance?: AttendanceProjection | null,
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
  const observedBreakSeconds = Math.max(0, worktivityAuthoritativeBreaks ? attendance?.providerBreakSeconds || 0 : 0);
  const observedEnd = observedClockedOutAt ?? now.getTime();
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
    ? session.provider_break_seconds || 0
    : session.paused_seconds || 0);
  const elapsedMs = Math.max(0, end - clockedInAt - breakSeconds * 1000);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedLabel = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  const breakMinutes = Math.floor(breakSeconds / 60);
  const breakLabel = `${String(Math.floor(breakMinutes / 60)).padStart(2, "0")}:${String(breakMinutes % 60).padStart(2, "0")}`;
  return { elapsedLabel, breakLabel, breakSeconds, progressPercent, observedElapsedLabel, observedBreakLabel, schedulePhase };
}
