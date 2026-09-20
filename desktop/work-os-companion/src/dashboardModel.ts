import { formatWorkOsDateTime } from "./dateFormat";
import type { AttendanceProjection, DayData, OnboardingSchedule, WorkSession } from "./types";
import type { ShiftPulse } from "./shiftPulse";
import { isOverdueTask, safeTaskText, type TaskRow } from "./taskWorkspace";

export type DashboardState = "off_shift" | "ready" | "active" | "paused" | "observed";
export type DashboardTone = "signal" | "quiet" | "warning" | "danger";

export interface WorkdayDashboardModel {
  asOf: number;
  state: DashboardState;
  stateLabel: string;
  stateDetail: string;
  stateTone: DashboardTone;
  schedule: {
    startsAt: string | null;
    endsAt: string | null;
    timezone: string | null;
    phase: ShiftPulse["schedulePhase"];
  };
  pulse: ShiftPulse;
  attendance: AttendanceProjection | null;
  focus: { text: string; source: string };
  metrics: {
    planned: number;
    open: number;
    completed: number;
    carryover: number;
    overdue: number;
    reviews: number;
  };
  sync: {
    label: string;
    tone: DashboardTone;
    detail: string;
  };
}

export interface DashboardModelInput {
  active: boolean;
  paused: boolean;
  observedOnly?: boolean;
  currentDate: string;
  shift: DayData["shift"];
  session?: WorkSession | null;
  schedule?: OnboardingSchedule | null;
  timezone?: string | null;
  attendance?: AttendanceProjection | null;
  pulse: ShiftPulse;
  tasks: TaskRow[];
  carryover: TaskRow[];
  reviews: number;
  focus: string;
  focusSource: string;
  niftySync?: DayData["niftySync"];
}

type DashboardShift = NonNullable<DayData["shift"]>;

function validTime(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function addCalendarDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return {
    year: Number(part("year")),
    month: Number(part("month")),
    day: Number(part("day")),
    hour: Number(part("hour")),
    minute: Number(part("minute")),
    second: Number(part("second")),
  };
}

/** Converts a schedule's wall-clock time into the instant used by the rest of
 * the companion. Round-tripping candidates makes spring-forward gaps
 * explicit (no invented instant) and chooses the first occurrence during a
 * fall-back overlap. */
function zonedDateTimeToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour = 0, minute = 0, second = 0] = time.split(":").map(Number);
  if (![year, month, day, hour, minute, second].every(Number.isFinite) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsets = new Set<number>();
  try {
    // Timezone offsets are stable for hours at a time. Sampling the local
    // neighborhood collects both offsets when a fall-back overlap exists.
    for (let sample = desired - 36 * 60 * 60 * 1000; sample <= desired + 36 * 60 * 60 * 1000; sample += 30 * 60 * 1000) {
      const observed = localParts(new Date(sample), timezone);
      const observedWall = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      offsets.add(observedWall - sample);
    }
  } catch {
    return null;
  }
  const matches = [...offsets]
    .map((offset) => desired - offset)
    .filter((candidate) => {
      try {
        const observed = localParts(new Date(candidate), timezone);
        return observed.year === year && observed.month === month && observed.day === day && observed.hour === hour && observed.minute === minute && observed.second === second;
      } catch {
        return false;
      }
    })
    .sort((left, right) => left - right);
  return matches.length ? new Date(matches[0]).toISOString() : null;
}

function profileShift(schedule: OnboardingSchedule | null | undefined, currentDate: string, timezone: string, now: Date): DashboardShift | null {
  if (!schedule?.daysOfWeek?.length || !/^\d{2}:\d{2}/.test(schedule.shiftStart) || !/^\d{2}:\d{2}/.test(schedule.shiftEnd)) return null;
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addCalendarDays(currentDate, offset);
    if (!date) continue;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!schedule.daysOfWeek.includes(weekday)) continue;
    const startsAt = zonedDateTimeToUtc(date, schedule.shiftStart, timezone);
    let endsAt = zonedDateTimeToUtc(date, schedule.shiftEnd, timezone);
    if (!startsAt || !endsAt) continue;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      const nextDate = addCalendarDays(date, 1);
      const nextEnd = nextDate ? zonedDateTimeToUtc(nextDate, schedule.shiftEnd, timezone) : null;
      if (!nextEnd) continue;
      endsAt = nextEnd;
    }
    if (offset === 0 && validTime(endsAt)! <= now.getTime()) continue;
    return { startsAt, endsAt, timezone, breaks: [] };
  }
  return null;
}

/** Returns the server shift first, then an existing session window, then the
 * employee's configured schedule. The fallback is display-only: clock-in and
 * attendance continue to use the server's authoritative state. */
export function resolveDashboardShift({
  shift,
  session,
  schedule,
  currentDate,
  timezone,
  now = new Date(),
}: {
  shift: DayData["shift"];
  session?: WorkSession | null;
  schedule?: OnboardingSchedule | null;
  currentDate: string;
  timezone?: string | null;
  now?: Date;
}): DayData["shift"] {
  if (shift) return shift;
  const sessionStarts = validTime(session?.scheduled_starts_at);
  const sessionEnds = validTime(session?.scheduled_ends_at);
  if (sessionStarts !== null && sessionEnds !== null && sessionEnds > sessionStarts) {
    return { startsAt: session!.scheduled_starts_at!, endsAt: session!.scheduled_ends_at!, timezone: timezone || "UTC", breaks: [] };
  }
  return profileShift(schedule, currentDate, timezone || "UTC", now);
}

function uniqueTaskKey(task: TaskRow) {
  return String(task.provider_task_id ?? task.id ?? "");
}

function remainingLabel(endsAt: string | null, now = Date.now()) {
  if (!endsAt) return "No end time set";
  const milliseconds = Date.parse(endsAt) - now;
  if (!Number.isFinite(milliseconds)) return "End time unavailable";
  if (milliseconds <= 0) return "Scheduled window ended";
  const minutes = Math.ceil(milliseconds / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m remaining` : `${minutes}m remaining`;
}

export function buildWorkdayDashboardModel(input: DashboardModelInput, now = Date.now()): WorkdayDashboardModel {
  const attendance = input.attendance ?? null;
  const state: DashboardState = input.observedOnly
    ? "observed"
    : input.active
      ? input.paused ? "paused" : "active"
      : input.pulse.schedulePhase === "upcoming" ? "ready" : "off_shift";

  const stateMeta: Record<DashboardState, Pick<WorkdayDashboardModel, "stateLabel" | "stateDetail" | "stateTone">> = {
    off_shift: { stateLabel: "Off shift", stateDetail: "Your workday has not started.", stateTone: "quiet" },
    ready: { stateLabel: "Ready to begin", stateDetail: "Your scheduled window is ready when you are.", stateTone: "signal" },
    active: { stateLabel: "On shift", stateDetail: "Work OS is recording the active workday.", stateTone: "signal" },
    paused: { stateLabel: "Shift paused", stateDetail: "Your session is paused until you resume.", stateTone: "warning" },
    observed: { stateLabel: "Activity observed", stateDetail: "Worktivity is separate from a Work OS session.", stateTone: "quiet" },
  };

  const open = input.tasks.filter((task) => task.completed !== true).length;
  const completed = input.tasks.filter((task) => task.completed === true).length;
  const carryoverById = new Map(input.carryover.map((task) => [uniqueTaskKey(task), task]));
  const carryover = [...carryoverById.values()].filter((task) => task.completed !== true);
  const overdueById = new Map<string, TaskRow>();
  for (const task of [...input.tasks, ...carryover]) {
    if (isOverdueTask(task, input.currentDate)) overdueById.set(uniqueTaskKey(task), task);
  }

  const sync = input.niftySync?.error
    ? { label: "Sync delayed", tone: "danger" as const, detail: input.niftySync.error }
    : input.niftySync?.syncing
      ? { label: "Syncing", tone: "warning" as const, detail: "Refreshing task records" }
      : input.niftySync?.fresh
        ? { label: "Synced", tone: "signal" as const, detail: input.niftySync.syncedAt ? `Updated ${formatWorkOsDateTime(input.niftySync.syncedAt, input.timezone ?? input.shift?.timezone ?? undefined, "—", new Date(now))}` : "Task records are current" }
        : { label: "Sync status unknown", tone: "quiet" as const, detail: "Task freshness is unavailable" };

  const focusText = safeTaskText(input.focus, "Your open tasks define today’s work.");
  const focusSource = safeTaskText(input.focusSource, "Task record");
  const meta = stateMeta[state];
  return {
    asOf: now,
    state,
    ...meta,
    schedule: {
      startsAt: input.shift?.startsAt ?? null,
      endsAt: input.shift?.endsAt ?? null,
      timezone: input.shift?.timezone ?? input.timezone ?? null,
      phase: input.pulse.schedulePhase,
    },
    pulse: input.pulse,
    attendance,
    focus: { text: focusText, source: focusSource },
    metrics: {
      planned: input.tasks.length,
      open,
      completed,
      carryover: carryover.length,
      overdue: overdueById.size,
      reviews: Math.max(0, input.reviews),
    },
    sync,
  };
}

export function dashboardRemainingLabel(model: WorkdayDashboardModel, now = model.asOf) {
  const target = model.schedule.phase === "upcoming" ? model.schedule.startsAt : model.schedule.endsAt;
  return remainingLabel(target, now);
}
