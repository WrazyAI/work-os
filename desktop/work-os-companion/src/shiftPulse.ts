import type { DayData, WorkSession } from "./types";

export interface ShiftPulse {
  elapsedLabel: string;
  progressPercent: number;
}

function validTime(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function shiftPulse(
  session: WorkSession | null | undefined,
  shift: DayData["shift"],
  now = new Date(),
): ShiftPulse {
  const clockedInAt = validTime(session?.clocked_in_at);
  if (!session || clockedInAt === null || session.state === "clocked_out") {
    return { elapsedLabel: "00:00", progressPercent: 0 };
  }
  const clockedOutAt = validTime(session.clocked_out_at);
  const end = clockedOutAt ?? now.getTime();
  const elapsedMs = Math.max(0, end - clockedInAt - Math.max(0, session.paused_seconds || 0) * 1000);
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const elapsedLabel = `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  const startsAt = validTime(shift?.startsAt);
  const endsAt = validTime(shift?.endsAt);
  const progressPercent = startsAt !== null && endsAt !== null && endsAt > startsAt
    ? Math.max(0, Math.min(100, ((now.getTime() - startsAt) / (endsAt - startsAt)) * 100))
    : 0;
  return { elapsedLabel, progressPercent };
}
