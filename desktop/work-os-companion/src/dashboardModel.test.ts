import { describe, expect, it } from "vitest";
import { buildWorkdayDashboardModel, dashboardRemainingLabel } from "./dashboardModel";
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
    reviews: 2,
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
    expect(model.metrics).toMatchObject({ planned: 2, open: 1, completed: 1, carryover: 1, overdue: 1, reviews: 2 });
    expect(model.sync.label).toBe("Synced");
  });

  it("distinguishes paused sessions and stale provider data", () => {
    const model = buildWorkdayDashboardModel(input({ active: true, paused: true, attendance, niftySync: { fresh: false, syncing: false, syncedAt: null, error: "timeout" } }));
    expect(model.state).toBe("paused");
    expect(model.stateTone).toBe("warning");
    expect(model.sync).toMatchObject({ label: "Sync delayed", tone: "danger" });
  });

  it("uses an explicit observed-only state without converting it to a session", () => {
    const model = buildWorkdayDashboardModel(input({ observedOnly: true, attendance }));
    expect(model.state).toBe("observed");
    expect(model.stateDetail).toContain("separate");
  });

  it("keeps observed-only state authoritative when a session flag is also present", () => {
    const model = buildWorkdayDashboardModel(input({ active: true, observedOnly: true, attendance }));
    expect(model.state).toBe("observed");
    expect(model.stateLabel).toBe("Activity observed");
  });

  it("does not invent a remaining time when a schedule is missing", () => {
    const model = buildWorkdayDashboardModel(input({ shift: null, pulse: { ...pulse, schedulePhase: "unavailable" } }));
    expect(dashboardRemainingLabel(model, Date.parse("2026-09-20T12:00:00Z"))).toBe("No end time set");
  });
});
