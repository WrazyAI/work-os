import { describe, expect, it } from "vitest";
import { buildWorkdayDashboardModel, dashboardRemainingLabel, resolveDashboardShift } from "./dashboardModel";
import type { AttendanceProjection } from "./types";
import type { ShiftPulse } from "./shiftPulse";

const pulse: ShiftPulse = {
  elapsedLabel: "03:00",
  breakLabel: "00:00",
  breakSeconds: 0,
  progressPercent: 37.5,
  observedElapsedLabel: "02:54",
  observedBreakLabel: "00:00",
  schedulePhase: "in_progress",
};

const attendance: AttendanceProjection = {
  source: "worktivity",
  state: "active",
  status: "working",
  observedAt: "2026-09-20T12:00:00Z",
  clockedInAt: "2026-09-20T09:00:00Z",
  clockedOutAt: null,
  stale: false,
  fallbackAllowed: false,
  message: "Activity observed",
};

function input(overrides: Partial<Parameters<typeof buildWorkdayDashboardModel>[0]> = {}) {
  return {
    active: false,
    paused: false,
    currentDate: "2026-09-20",
    shift: { startsAt: "2026-09-20T09:00:00Z", endsAt: "2026-09-20T17:00:00Z", timezone: "UTC", breaks: [] },
    attendance: null,
    pulse,
    tasks: [
      { id: "open", title: "Open task", completed: false, due_date: "2026-09-20" },
      { id: "done", title: "Done task", completed: true, due_date: "2026-09-20" },
    ],
    carryover: [{ id: "old", title: "Old task", completed: false, due_date: "2026-09-19" }],
    focus: "Finish the release",
    focusSource: "Your focus note",
    niftySync: { fresh: true, syncing: false, syncedAt: "2026-09-20T12:00:00Z" },
    ...overrides,
  };
}

describe("buildWorkdayDashboardModel", () => {
  it("projects truthful task flow metrics across dashboard surfaces", () => {
    const model = buildWorkdayDashboardModel(input());
    expect(model.state).toBe("off_shift");
    expect(model.metrics).toMatchObject({ planned: 2, open: 1, completed: 1, carryover: 1, overdue: 1 });
    expect(model.sync.label).toBe("Synced");
  });

  it("distinguishes paused sessions and stale provider data", () => {
    const pausedAttendance = { ...attendance, state: "paused" as const, status: "break" as const };
    const model = buildWorkdayDashboardModel(input({ active: true, paused: true, attendance: pausedAttendance, niftySync: { fresh: false, syncing: false, syncedAt: null, error: "timeout" } }));
    expect(model.state).toBe("paused");
    expect(model.stateTone).toBe("warning");
    expect(model.stateDetail).toContain("Worktivity confirms your break");
    expect(model.sync).toMatchObject({ label: "Save delayed", tone: "danger" });
  });

  it("uses an explicit observed-only state without converting it to a session", () => {
    const model = buildWorkdayDashboardModel(input({ observedOnly: true, attendance }));
    expect(model.state).toBe("observed");
    expect(model.stateLabel).toBe("Worktivity status");
    expect(model.stateDetail).toContain("Worktivity confirms active attendance");
    expect(model.stateDetail).toContain("has not mirrored its session yet");
  });

  it("keeps observed-only state authoritative when a session flag is also present", () => {
    const model = buildWorkdayDashboardModel(input({ active: true, observedOnly: true, attendance }));
    expect(model.state).toBe("observed");
    expect(model.stateLabel).toBe("Worktivity status");
  });

  it("does not describe a stale provider session as confirmed", () => {
    const staleAttendance = { ...attendance, stale: true };
    const model = buildWorkdayDashboardModel(input({ active: true, attendance: staleAttendance }));
    expect(model.stateDetail).toContain("has not confirmed the current session");
    expect(model.stateTone).toBe("warning");
  });

  it("does not invent a remaining time when a schedule is missing", () => {
    const model = buildWorkdayDashboardModel(input({ shift: null, pulse: { ...pulse, schedulePhase: "unavailable" } }));
    expect(dashboardRemainingLabel(model, Date.parse("2026-09-20T12:00:00Z"))).toBe("No end time set");
  });

  it("formats provider freshness for people and keeps the schedule timezone", () => {
    const model = buildWorkdayDashboardModel(input({ timezone: "UTC" }));
    expect(model.sync.detail).toBe("Updated September 20, 12:00 PM");
  });

  it("uses the configured next window when the day endpoint has no resolved shift", () => {
    const shift = resolveDashboardShift({
      shift: null,
      currentDate: "2026-09-20",
      timezone: "UTC",
      now: new Date("2026-09-20T12:00:00Z"),
      schedule: { daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [] },
    });
    expect(shift).toMatchObject({ startsAt: "2026-09-21T09:00:00.000Z", endsAt: "2026-09-21T17:00:00.000Z", timezone: "UTC" });
  });

  it("does not invent a spring-forward shift and picks the first fall-back occurrence", () => {
    const springGap = resolveDashboardShift({
      shift: null,
      currentDate: "2026-03-08",
      timezone: "America/New_York",
      now: new Date("2026-03-08T00:00:00Z"),
      schedule: { daysOfWeek: [0], shiftStart: "02:30", shiftEnd: "03:30", breaks: [] },
    });
    expect(springGap?.startsAt).toBe("2026-03-15T06:30:00.000Z");

    const fallOverlap = resolveDashboardShift({
      shift: null,
      currentDate: "2026-11-01",
      timezone: "America/New_York",
      now: new Date("2026-11-01T00:00:00Z"),
      schedule: { daysOfWeek: [0], shiftStart: "01:30", shiftEnd: "02:30", breaks: [] },
    });
    expect(fallOverlap?.startsAt).toBe("2026-11-01T05:30:00.000Z");
  });

  it("carries the attendance watch expectation into the model", () => {
    expect(buildWorkdayDashboardModel(input({ activityWatch: "clock-in" }), Date.parse("2026-09-20T12:00:00Z")).activityWatch).toBe("clock-in");
    expect(buildWorkdayDashboardModel(input(), Date.parse("2026-09-20T12:00:00Z")).activityWatch).toBeNull();
  });
});
