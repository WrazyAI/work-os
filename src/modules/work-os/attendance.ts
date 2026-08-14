export type WorktivityAttendanceState = "active" | "paused" | "off_shift" | "unknown";
export type WorktivityStatusName = "clock_in" | "working" | "break" | "idle" | "clock_out" | "yet_to_start" | "unknown";

export interface AttendanceProjection {
  source: "worktivity" | "work_os_fallback" | "unknown";
  state: WorktivityAttendanceState;
  status: WorktivityStatusName;
  observedAt: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  stale: boolean;
  fallbackAllowed: boolean;
  message: string;
}

export interface WorktivityActivityObservation {
  Status?: number;
  ClockIn?: string | null;
  ClockOut?: string | null;
  CreateDate?: string | null;
}

const names: Record<number, WorktivityStatusName> = {
  0: "clock_in", 1: "working", 2: "break", 3: "idle", 4: "clock_out", 5: "yet_to_start",
};

export function projectWorktivityAttendance(statistics: { Status?: number; ClockIn?: string | null; ClockOut?: string | null } | null | undefined, observedAt: string): AttendanceProjection {
  const status = statistics && Number.isInteger(statistics.Status) ? names[statistics.Status as number] ?? "unknown" : "unknown";
  const base = {
    source: status === "unknown" ? "unknown" as const : "worktivity" as const,
    status, observedAt,
    clockedInAt: statistics?.ClockIn ?? null,
    clockedOutAt: statistics?.ClockOut ?? null,
    stale: false,
  };
  if (["clock_in", "working", "idle"].includes(status)) return { ...base, state: "active", fallbackAllowed: false, message: "Worktivity activity observed; Work OS clock-in is explicit." };
  if (status === "break") return { ...base, state: "paused", fallbackAllowed: false, message: "Worktivity break observed; Work OS pause remains explicit." };
  if (["clock_out", "yet_to_start"].includes(status)) return { ...base, state: "off_shift", fallbackAllowed: false, message: status === "clock_out" ? "Worktivity reports clock-out; Work OS session remains employee-owned." : "Worktivity reports no active attendance; clock in explicitly when you begin." };
  return { ...base, state: "unknown", fallbackAllowed: true, message: "Worktivity attendance is currently unavailable." };
}

/**
 * Employee/List statistics can lag behind the desktop tracker. Prefer a recent,
 * employee-scoped ActivityLogs observation and fall back to roster statistics
 * when no fresh activity exists.
 */
export function projectWorktivityAttendanceWithActivity(
  statistics: { Status?: number; ClockIn?: string | null; ClockOut?: string | null } | null | undefined,
  activity: WorktivityActivityObservation | null | undefined,
  observedAt: string,
  freshnessMs = 5 * 60_000,
): AttendanceProjection {
  const activityAt = activity?.CreateDate ? Date.parse(activity.CreateDate) : Number.NaN;
  const observationAt = Date.parse(observedAt);
  const recent = Number.isFinite(activityAt) && Number.isFinite(observationAt) &&
    activityAt <= observationAt + 60_000 && observationAt - activityAt <= freshnessMs;
  if (!recent) return projectWorktivityAttendance(statistics, observedAt);
  return projectWorktivityAttendance({
    Status: activity?.Status,
    ClockIn: activity?.ClockIn ?? statistics?.ClockIn ?? null,
    ClockOut: activity?.ClockOut ?? statistics?.ClockOut ?? null,
  }, observedAt);
}

export function unknownAttendance(message: string, observedAt = new Date().toISOString()): AttendanceProjection {
  return { source: "unknown", state: "unknown", status: "unknown", observedAt, clockedInAt: null, clockedOutAt: null, stale: false, fallbackAllowed: true, message };
}
