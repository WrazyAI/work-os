import { validateWorkOsBreakWindows, validateWorkOsTime } from "../../lib/work-os-schedule-validation";

export type WorkArrangement = "scheduled" | "flexible";
export interface WorkArrangementProposal {
  arrangement: WorkArrangement;
  daysOfWeek: number[];
  shiftStart: string | null;
  shiftEnd: string | null;
  breaks: Array<{ start: string; end: string }>;
}

/** Strip hidden shift fields and any unrecognized quotas from flexible drafts. */
export function normalizeWorkArrangement(value: unknown): WorkArrangementProposal {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const arrangement = input.arrangement == null ? "scheduled" : input.arrangement;
  if (arrangement !== "scheduled" && arrangement !== "flexible") throw new Error("arrangement must be scheduled or flexible");
  // Legacy clients sent numeric strings; preserve that compatibility without
  // accepting arbitrary text.
  const rawDays = Array.isArray(input.daysOfWeek)
    ? input.daysOfWeek.map((day) => typeof day === "string" && /^\d$/.test(day) ? Number(day) : day)
    : [];
  if (!rawDays.length || rawDays.some((day) => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new Error("daysOfWeek must include at least one day from Sunday through Saturday");
  }
  const daysOfWeek = [...new Set(rawDays as number[])].sort();
  if (arrangement === "flexible") return { arrangement, daysOfWeek, shiftStart: null, shiftEnd: null, breaks: [] };
  const shiftStart = validateWorkOsTime(input.shiftStart, "shift start");
  const shiftEnd = validateWorkOsTime(input.shiftEnd, "shift end");
  if (shiftStart === shiftEnd) throw new Error("shift start and end must be different");
  return { arrangement, daysOfWeek, shiftStart, shiftEnd, breaks: validateWorkOsBreakWindows(input.breaks, shiftStart, shiftEnd) };
}
