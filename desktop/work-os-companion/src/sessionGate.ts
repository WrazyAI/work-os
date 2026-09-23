import type { DayData, WorkSession } from "./types";

const ACTIVE_STATES = new Set<WorkSession["state"]>(["clocked_in", "active", "paused", "eod_due"]);

export interface SessionGate {
  active: boolean;
  canClockIn: boolean;
  message: string;
  worktivitySynced: boolean;
  persistentTitle?: string;
  persistentMessage?: string;
}

export function sessionGate(day: DayData | null): SessionGate {
  const state = day?.session?.state;
  if (state && ACTIVE_STATES.has(state)) {
    return { active: true, canClockIn: false, message: "Workday session is active.", worktivitySynced: false };
  }
  const attendance = day?.attendance;
  const worktivitySynced = attendance?.source === "worktivity" && !attendance.stale && (attendance.state === "active" || attendance.state === "paused");
  if (worktivitySynced) {
    return { active: true, canClockIn: false, message: "Worktivity confirms attendance while Work OS mirrors the session.", worktivitySynced: true };
  }
  if (state === "clocked_out") {
    return { active: false, canClockIn: false, message: "Today’s Work OS session is closed.", worktivitySynced: false, persistentTitle: "Workday closed", persistentMessage: "Today’s Work OS session is closed." };
  }
  if (!day?.shift) {
    return { active: false, canClockIn: true, message: "No scheduled shift is active. Start an exception session before sending session-based updates.", worktivitySynced: false, persistentTitle: "No scheduled shift", persistentMessage: "Start an exception session only if you are working outside your configured schedule. Work OS will not invent an end time." };
  }
  return { active: false, canClockIn: true, message: "Clock in with Worktivity before sending session-based updates.", worktivitySynced: false, persistentTitle: "Work OS session not started", persistentMessage: "Clock in with Worktivity from the Windows Companion. Work OS mirrors confirmed status." };
}
