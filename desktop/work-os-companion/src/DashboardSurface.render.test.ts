import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActiveWorkdayDashboard, OffShiftDashboard } from "./DashboardSurface";
import { buildWorkdayDashboardModel } from "./dashboardModel";
import { shiftPulse } from "./shiftPulse";

const shift = { startsAt: "2026-08-26T15:00:00Z", endsAt: "2026-08-26T20:00:00Z", timezone: "UTC", breaks: [] };
const attendance = { source: "worktivity" as const, state: "off_shift" as const, status: "yet_to_start" as const, observedAt: "2026-08-26T12:08:00Z", clockedInAt: null, clockedOutAt: null, stale: false, fallbackAllowed: false, message: "No activity observed yet" };
const task = { id: "task-1", title: "Make the first task visible", description: "Turn the next move into a record.", due_date: "2026-08-26", priority: "high", completed: false };
const noop = () => undefined;

function baseActions() {
  return {
    onOpenTasks: noop,
    onOpenReviews: noop,
    onOpenCarryover: noop,
    onOpenFocus: noop,
    onOpenTask: noop,
    onToggleTask: noop,
  };
}

describe("dashboard surfaces", () => {
  it("renders a ready command center with a truthful remaining label", () => {
    const now = Date.parse("2026-08-26T12:08:00Z");
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [task], carryover: [], reviews: 0, focus: "Make the first task visible", focusSource: "Written by you", niftySync: { fresh: true, syncedAt: "2026-08-26T12:06:00Z" } }, now);
    const markup = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model, tasks: [task], currentDate: "2026-08-26", onClockIn: noop }));

    expect(markup).toContain("dashboard-readiness-panel");
    expect(markup).toContain("Start the day with one clear move.");
    expect(markup).toContain("2h 52m remaining");
    expect(markup.match(/Your scheduled window is ready when you are\./g)?.length).toBe(1);
    expect(markup).toContain("Clock in");
    expect(markup).toContain("Clock in with Worktivity from the Windows Companion");
    expect(markup).toContain("Updated August 26, 12:06 PM");
    expect(markup).not.toContain("Scheduled window");
    expect(markup).not.toContain("Observed context");
  });

  it("renders the active workday around a queue and real controls", () => {
    const now = Date.parse("2026-08-26T13:46:00Z");
    const activeShift = { startsAt: "2026-08-26T09:00:00Z", endsAt: "2026-08-26T17:00:00Z", timezone: "UTC", breaks: [] };
    const activeAttendance = { ...attendance, state: "active" as const, status: "working" as const, clockedInAt: activeShift.startsAt, message: "Activity observed" };
    const activeSession = { id: "session-1", state: "active" as const, scheduled_starts_at: activeShift.startsAt, scheduled_ends_at: activeShift.endsAt, clocked_in_at: activeShift.startsAt, clocked_out_at: null, paused_seconds: 0 };
    const model = buildWorkdayDashboardModel({ active: true, paused: false, currentDate: "2026-08-26", shift: activeShift, attendance: activeAttendance, pulse: shiftPulse(activeSession, activeShift, new Date(now), false, activeAttendance), tasks: [task], carryover: [{ id: "carry-1", title: "Resolve carryover", due_date: "2026-08-25", completed: false }], reviews: 2, focus: "Make the first task visible", focusSource: "Your focus note", niftySync: { fresh: true, syncedAt: "2026-08-26T13:40:00Z" } }, now);
    const markup = renderToStaticMarkup(createElement(ActiveWorkdayDashboard, { ...baseActions(), model, tasks: [task], previousTasks: [{ id: "carry-1", title: "Resolve carryover", due_date: "2026-08-25", completed: false }], otherTasks: [], currentDate: "2026-08-26", canPause: true, canClockOut: true, taskFlight: new Map([["task-1", "completing" as const]]), onPause: noop, onClockOut: noop, onAddTask: noop }));

    expect(markup).toContain("active-command-panel");
    expect(markup).toContain("4:46");
    expect(markup).toContain("3h 14m");
    expect(markup).toContain("Today’s queue");
    expect(markup).toContain("Yesterday");
    expect(markup).toContain("Clock out");
    expect(markup).toContain("Worktivity confirms you are working; Work OS mirrors this session.");
    expect(markup).toContain("Mirrored Worktivity time");
    expect(markup).toContain("Make the first task visible");
    expect(markup).toContain("active-summary-action");
    expect(markup).toContain('aria-label="Completing Make the first task visible"');
    expect(markup).toContain('aria-busy="true"');

    const observedAttendance = { ...activeAttendance, clockedInAt: "2026-08-26T10:00:00Z" };
    const observedModel = buildWorkdayDashboardModel({ active: true, observedOnly: true, paused: false, currentDate: "2026-08-26", shift: activeShift, attendance: observedAttendance, pulse: shiftPulse(activeSession, activeShift, new Date(now), false, observedAttendance), tasks: [task], carryover: [], reviews: 0, focus: "Make the first task visible", focusSource: "Observed context", niftySync: { fresh: true, syncedAt: "2026-08-26T13:40:00Z" } }, now);
    const observedMarkup = renderToStaticMarkup(createElement(ActiveWorkdayDashboard, { ...baseActions(), model: observedModel, tasks: [task], previousTasks: [], otherTasks: [], currentDate: "2026-08-26", observedOnly: true, canPause: false, canClockOut: false, onAddTask: noop }));
    expect(observedMarkup).toContain("03:46");
  });
});
