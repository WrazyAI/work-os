import type { DayData, WorkSession } from "./types";

const ACTIVE_STATES = new Set<WorkSession["state"]>(["clocked_in", "active", "paused", "eod_due"]);

export interface SessionGate {
  active: boolean;
  canClockIn: boolean;
  message: string;
}

export function sessionGate(day: DayData | null): SessionGate {
  const state = day?.session?.state;
  if (state && ACTIVE_STATES.has(state)) {
    return { active: true, canClockIn: false, message: "Workday session is active." };
  }
  if (state === "clocked_out") {
    return { active: false, canClockIn: false, message: "Today’s Work OS session is closed." };
  }
  if (!day?.shift) {
    return { active: false, canClockIn: true, message: "No scheduled shift is active. Clock in explicitly for an exception session; Work OS will not invent an EOD time." };
  }
  return { active: false, canClockIn: true, message: "Clock in explicitly to confirm a plan or send work updates." };
}
