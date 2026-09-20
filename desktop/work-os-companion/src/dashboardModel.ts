import type { AttendanceProjection, DayData } from "./types";
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
  attendance?: AttendanceProjection | null;
  pulse: ShiftPulse;
  tasks: TaskRow[];
  carryover: TaskRow[];
  reviews: number;
  focus: string;
  focusSource: string;
  niftySync?: DayData["niftySync"];
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
        ? { label: "Synced", tone: "signal" as const, detail: input.niftySync.syncedAt ? `Updated ${input.niftySync.syncedAt}` : "Task records are current" }
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
      timezone: input.shift?.timezone ?? null,
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
