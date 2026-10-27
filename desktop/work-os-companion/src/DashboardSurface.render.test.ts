import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActiveWorkdayDashboard, OffShiftDashboard } from "./DashboardSurface";
import { buildWorkdayDashboardModel } from "./dashboardModel";
import { shiftPulse } from "./shiftPulse";
import { TaskActionMenuItems } from "./taskSurfaces";
import { taskCapabilities } from "../../../src/lib/work-os-task-permissions";

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
  it("offers off-shift task actions without changing the row controls", () => {
    const now = Date.parse("2026-08-26T12:08:00Z");
    const assigned = { ...task, assignee_person_ids: ["worker"], assigned_by_person_id: "owner" };
    const workerRow = { ...assigned, capabilities: taskCapabilities(assigned, { role: "employee", personId: "worker" }, "2026-08-26") };
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [workerRow], carryover: [], focus: "First move", focusSource: "Written by you" }, now);
    const markup = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model, tasks: [workerRow], currentDate: "2026-08-26" }));
    expect(markup).toContain('aria-label="Actions for Make the first task visible"');
    expect(markup).toContain('aria-label="Complete Make the first task visible"');
    const unassigned = renderToStaticMarkup(createElement(OffShiftDashboard, { ...baseActions(), model: buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [task], carryover: [], focus: "First move", focusSource: "Written by you" }, now), tasks: [task], currentDate: "2026-08-26" }));
    expect(unassigned).not.toContain('aria-label="Actions for Make the first task visible"');
    const menu = (personId: string, extra = {}) => renderToStaticMarkup(createElement(TaskActionMenuItems, {
      task: { ...assigned, ...extra, capabilities: taskCapabilities({ ...assigned, ...extra }, { role: "employee", personId }, "2026-08-26") },
      currentDate: "2026-08-26", busy: false, onStatus: noop, onComplete: noop, onEdit: noop, onAssign: noop, onArchive: noop, onDelete: noop, onClose: noop,
    }));
    const assigner = menu("owner");
    for (const label of ["Pending", "In progress", "Edit task", "Assign", "Archive", "reversible", "Delete permanently"]) expect(assigner).toContain(label);
    expect(assigner).not.toContain("Mark task done");
    const assignee = menu("worker");
    expect(assignee).toContain("Mark task done");
    for (const label of ["Edit task", ">Assign", "Archive", "Delete permanently"]) expect(assignee).not.toContain(label);
    const overdueAssignee = menu("worker", { due_date: "2026-08-25" });
    expect(overdueAssignee).toContain("Mark task done");
    expect(overdueAssignee).not.toContain("Update the due date first");
    expect(overdueAssignee).not.toContain(">Pending");
    expect(overdueAssignee).not.toContain(">In progress");
    const overdueAssigner = menu("owner", { due_date: "2026-08-25" });
    expect(overdueAssigner.match(/disabled=""/g)).toHaveLength(2);
    expect(overdueAssigner.match(/Update the due date first/g)).toHaveLength(2);
    const completed = menu("worker", { completed: true });
    expect(completed).toContain("Reopen task");
    expect(completed).not.toContain("Mark task done");
    expect(completed).not.toContain(">Pending");
    expect(completed).not.toContain(">In progress");
    expect(completed).not.toContain("Update the due date first");
    expect(menu("viewer")).toBe("");
  });

  it("wires the off-shift management actions and keeps their order", () => {
    const now = Date.parse("2026-08-26T12:08:00Z");
    const assigned = { ...task, assignee_person_ids: ["worker"], assigned_by_person_id: "owner" };
    const manager = { ...assigned, capabilities: taskCapabilities(assigned, { role: "employee", personId: "owner" }, "2026-08-26") };
    const selfOwned = { ...task, assignee_person_ids: ["owner"], assigned_by_person_id: "owner", completed: false };
    const selfOwnedRow = { ...selfOwned, capabilities: taskCapabilities(selfOwned, { role: "employee", personId: "owner" }, "2026-08-26") };
    const onEdit = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    const onAssign = vi.fn();
    const onClose = vi.fn();
    const onStatus = vi.fn();
    const onComplete = vi.fn();
    const handlers = { busy: false, currentDate: "2026-08-26", onStatus, onComplete, onEdit, onAssign, onArchive, onDelete, onClose };

    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, pulse: shiftPulse(null, shift, new Date(now), true, attendance), tasks: [manager], carryover: [], focus: "First move", focusSource: "Written by you" }, now);
    const dashboard = renderToStaticMarkup(createElement(OffShiftDashboard, {
      ...baseActions(), model, tasks: [manager], currentDate: "2026-08-26",
      onEditTask: onEdit, onArchiveTask: onArchive, onDeleteTask: onDelete, onStatusTask: onStatus,
    }));
    expect(dashboard).toContain('aria-label="Actions for Make the first task visible"');

    const menuElement = TaskActionMenuItems({ task: manager, ...handlers }) as ReactElement<{ children: ReactNode }>;
    const managerMarkup = renderToStaticMarkup(menuElement);
    for (const label of ["Edit task", "Archive", "Delete permanently"]) expect(managerMarkup).toContain(label);
    const buttons = Children.toArray(menuElement.props.children)
      .filter((node) => isValidElement(node)) as Array<ReactElement<{ onClick: () => void }>>;
    const buttonFor = (label: string) => {
      const found = buttons.find((node) => renderToStaticMarkup(node).includes(label));
      expect(found).toBeDefined();
      return found!;
    };

    buttonFor("Edit task").props.onClick();
    buttonFor("Archive").props.onClick();
    buttonFor("Delete permanently").props.onClick();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onEdit.mock.invocationCallOrder[0]);

    // Order contract: status, then complete/reopen, then management, archive, delete.
    const ordered = renderToStaticMarkup(TaskActionMenuItems({ task: selfOwnedRow, ...handlers }));
    const labels = ["Pending", "In progress", "Mark task done", "Edit task", "Assign", "Archive", "Delete permanently"];
    labels.slice(1).forEach((label, index) => {
      expect(ordered.indexOf(label)).toBeGreaterThan(ordered.indexOf(labels[index]));
    });
  });
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
    // A confirmed session is already carried by the state line and the
    // Worktivity chip, so the long mechanism sentence and the mirrored-time
    // label are not rendered again.
    expect(markup).not.toContain("Worktivity confirms you are working; Work OS mirrors this session.");
    expect(markup).not.toContain("Mirrored Worktivity time");
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
