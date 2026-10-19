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
    onOpenCarryover: noop,
    onOpenFocus: noop,
    onOpenTask: noop,
    onToggleTask: noop,
  };
}

describe("dashboard surfaces", () => {
  it("keeps Mac attendance visible without advertising unsupported clock controls", () => {
    const now = Date.parse("2026-08-26T12:08:00Z");
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [task], carryover: [], focus: "Make the first task visible", focusSource: "Written by you" }, now);
    const markup = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model, tasks: [task], currentDate: "2026-08-26", attendanceControlsSupported: false, onClockIn: noop }));
    expect(markup).toContain("Use Worktivity on your Mac to clock in, pause, resume, or clock out.");
    expect(markup).not.toContain("Windows Companion");
    expect(markup).not.toMatch(/<button[^>]*>.*?Clock in<\/button>/);
    expect(markup).toContain("Set focus");
    expect(markup).toContain("Make the first task visible");
  });
  it("renders a ready command center with a truthful remaining label", () => {
    const now = Date.parse("2026-08-26T12:08:00Z");
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [task], carryover: [], focus: "Make the first task visible", focusSource: "Written by you", niftySync: { fresh: true, syncedAt: "2026-08-26T12:06:00Z" } }, now);
    const markup = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model, tasks: [task], currentDate: "2026-08-26", onClockIn: noop }));

    expect(markup).toContain("workday-band");
    expect(markup).toContain("Starts in");
    expect(markup).toContain("2h 52m");
    expect(markup.match(/Your scheduled window is ready when you are\./g)?.length).toBe(1);
    expect(markup).toContain("Clock in");
    expect(markup).toContain("Clock in with Worktivity from the Windows Companion");
    expect(markup).toContain("Updated August 26, 12:06 PM");
    expect(markup).not.toContain("Scheduled window");
    expect(markup).not.toContain("dashboard-readiness");
    expect(markup).not.toContain("dashboard-metric");
    // One owner per count, and the queue states what it is previewing.
    expect(markup).toContain('aria-label="1 planned. Review today’s tasks"');
    expect(markup).toContain("Showing 1 of 1 open");
    expect(markup).not.toContain("workday-band-footer");
    expect(markup).not.toContain("Observed context");
  });

  it("renders the active workday around a queue and real controls", () => {
    const now = Date.parse("2026-08-26T13:46:00Z");
    const activeShift = { startsAt: "2026-08-26T09:00:00Z", endsAt: "2026-08-26T17:00:00Z", timezone: "UTC", breaks: [] };
    const activeAttendance = { ...attendance, state: "active" as const, status: "working" as const, clockedInAt: activeShift.startsAt, message: "Activity observed" };
    const activeSession = { id: "session-1", state: "active" as const, scheduled_starts_at: activeShift.startsAt, scheduled_ends_at: activeShift.endsAt, clocked_in_at: activeShift.startsAt, clocked_out_at: null, paused_seconds: 0 };
    const model = buildWorkdayDashboardModel({ active: true, paused: false, currentDate: "2026-08-26", shift: activeShift, attendance: activeAttendance, pulse: shiftPulse(activeSession, activeShift, new Date(now), false, activeAttendance), tasks: [task], carryover: [{ id: "carry-1", title: "Resolve carryover", due_date: "2026-08-25", completed: false }], focus: "Make the first task visible", focusSource: "Your focus note", niftySync: { fresh: true, syncedAt: "2026-08-26T13:40:00Z" } }, now);
    const markup = renderToStaticMarkup(createElement(ActiveWorkdayDashboard, { ...baseActions(), model, tasks: [task], previousTasks: [{ id: "carry-1", title: "Resolve carryover", due_date: "2026-08-25", completed: false }], otherTasks: [], currentDate: "2026-08-26", canPause: true, canClockOut: true, taskFlight: new Map([["task-1", "completing" as const]]), onPause: noop, onClockOut: noop, onAddTask: noop }));

    expect(markup).toContain("workday-band");
    expect(markup).toContain("4:46");
    expect(markup).toContain("3h 14m");
    // The tabs are the panel's title; there is no second heading restating the
    // selected view.
    expect(markup).toContain("work-queue-tabs");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain("Today’s queue");
    expect(markup).toContain("Yesterday");
    expect(markup).toContain("Clock out");
    // A confirmed session is already carried by the state line, the Worktivity
    // chip, and the mirrored-time label, so the long mechanism sentence is not
    // rendered again.
    expect(markup).not.toContain("Worktivity confirms you are working; Work OS mirrors this session.");
    expect(markup).toContain("Mirrored Worktivity time");
    // The axis names the scheduled window; the reader's own clock supplies now.
    expect(markup).not.toContain("<small>Now</small>");
    // The band footer only exists when it has a notice to carry.
    expect(markup).not.toContain("workday-band-footer");
    expect(markup).toContain("Make the first task visible");
    // One owner per count, and each fact names where it goes.
    expect(markup).toContain("0</strong><small>completed");
    expect(markup).toContain('aria-label="1 open today. Review open tasks for today"');
    expect(markup).toContain('aria-label="1 overdue. Review overdue work"');
    expect(markup).toContain('aria-label="1 carried over. Review tasks carried over from earlier workdays"');
    expect(markup).toContain("Showing 1 of 1 open");
    expect(markup).toContain('aria-label="Completing Make the first task visible"');
    expect(markup).toContain('aria-busy="true"');

    const observedAttendance = { ...activeAttendance, clockedInAt: "2026-08-26T10:00:00Z" };
    const observedModel = buildWorkdayDashboardModel({ active: true, observedOnly: true, paused: false, currentDate: "2026-08-26", shift: activeShift, attendance: observedAttendance, pulse: shiftPulse(activeSession, activeShift, new Date(now), false, observedAttendance), tasks: [task], carryover: [], focus: "Make the first task visible", focusSource: "Observed context", niftySync: { fresh: true, syncedAt: "2026-08-26T13:40:00Z" } }, now);
    const observedMarkup = renderToStaticMarkup(createElement(ActiveWorkdayDashboard, { ...baseActions(), model: observedModel, tasks: [task], previousTasks: [], otherTasks: [], currentDate: "2026-08-26", observedOnly: true, canPause: false, canClockOut: false, onAddTask: noop }));
    expect(observedMarkup).toContain("03:46");
    // Un-mirrored observation is the one case where the mechanism sentence
    // still earns its place, because it says what has not happened yet.
    expect(observedMarkup).toContain("Worktivity confirms active attendance; Work OS has not mirrored its session yet.");
    // A confirmed provider observation keeps the dashboard's Otto awake even
    // before Work OS mirrors the session.
    expect(observedMarkup).toContain('data-workday="active"');
    expect(observedMarkup).not.toContain("studio-sleep-zs");
  });

  it("shows a quiet activity-watch note while a clock-in is expected and keeps the manual control", () => {
    const now = Date.parse("2026-08-26T15:30:00Z");
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, activityWatch: "clock-in", pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [task], carryover: [], focus: "Make the first task visible", focusSource: "Written by you" }, now);
    const markup = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model, tasks: [task], currentDate: "2026-08-26", onClockIn: noop }));

    expect(markup).toContain('class="dashboard-activity-watch"');
    expect(markup).toContain("Checking your activity… Work OS will clock you in as soon as Worktivity sees you working.");
    expect(markup).toContain("Clock in");
  });

  it("notes the provider-pending clock-out on the active dashboard", () => {
    const now = Date.parse("2026-08-26T17:10:00Z");
    const activeShift = { startsAt: "2026-08-26T09:00:00Z", endsAt: "2026-08-26T17:00:00Z", timezone: "UTC", breaks: [] };
    const activeAttendance = { ...attendance, state: "active" as const, status: "working" as const, clockedInAt: activeShift.startsAt, message: "Activity observed" };
    const activeSession = { id: "session-1", state: "active" as const, scheduled_starts_at: activeShift.startsAt, scheduled_ends_at: activeShift.endsAt, clocked_in_at: activeShift.startsAt, clocked_out_at: null, paused_seconds: 0 };
    const model = buildWorkdayDashboardModel({ active: true, paused: false, currentDate: "2026-08-26", shift: activeShift, attendance: activeAttendance, activityWatch: "clock-out", pulse: shiftPulse(activeSession, activeShift, new Date(now), false, activeAttendance), tasks: [task], carryover: [], focus: "Make the first task visible", focusSource: "Your focus note" }, now);
    const markup = renderToStaticMarkup(createElement(ActiveWorkdayDashboard, { ...baseActions(), model, tasks: [task], previousTasks: [], otherTasks: [], currentDate: "2026-08-26", canPause: true, canClockOut: true, onPause: noop, onClockOut: noop, onAddTask: noop }));

    expect(markup).toContain("Checking your activity… Work OS will close the day when Worktivity observes your clock-out.");
    expect(markup).toContain("Clock out");
  });
});
