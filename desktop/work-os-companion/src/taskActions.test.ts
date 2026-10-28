import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { taskCapabilities } from "../../../src/lib/work-os-task-permissions";
import { completionTaskCapabilities, currentTaskStatus, displayTaskState, hasTaskMenu, taskActionItems, taskCheckboxEnabled, taskDueDateSeed, taskStatusLabel, taskStatusOptions, taskStatusWriteRequired } from "./taskActions";
import { TaskActionMenuItems } from "./taskSurfaces";
import { taskState } from "./taskWorkspace";

const today = "2026-10-27";
const base = { completed: false, due_date: today, assignee_person_ids: ["worker"], assigned_by_person_id: "owner" };
const row = (personId: string, extra = {}, role: "employee" | "admin" = "employee") => {
  const task = { ...base, ...extra };
  return { ...task, capabilities: taskCapabilities(task, { role, personId }, today) };
};
const appSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");
/** The whole status menu markup, so the assertion sees its disabled attribute
 *  rather than only its visible label. */
const menuItemTag = (markup: string, label: string) => [...markup.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)]
  .map((match) => match[0])
  .find((tag) => tag.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() === label) ?? "";

describe("task actions", () => {
  it("labels all four display states and preserves legacy states", () => {
    expect(["pending", "in_progress", "overdue", "complete"].map((state) => taskStatusLabel(state as any))).toEqual(["Pending", "In progress", "Overdue", "Done"]);
    expect(displayTaskState(base, today)).toBe("pending");
    expect(displayTaskState({ ...base, workflow_status: "in_progress" }, today)).toBe("in_progress");
    expect(taskState(base, today)).toBe("open");
    expect(taskState({ ...base, due_date: "2026-10-26" }, today)).toBe("overdue");
    expect(taskState({ ...base, completed: true }, today)).toBe("complete");
  });
  it("offers assignee actions only", () => {
    expect(taskActionItems(row("worker"), today)).toEqual(["pending", "in_progress", "complete"]);
  });
  it("offers assigner management without completion", () => {
    expect(taskActionItems(row("owner"), today)).toEqual(["pending", "in_progress", "edit", "assign", "archive", "delete"]);
  });
  it("keeps completion when the assigner is also an assignee", () => {
    expect(taskActionItems(row("owner", { assignee_person_ids: ["owner", "worker"] }), today)).toEqual(["pending", "in_progress", "complete", "edit", "assign", "archive", "delete"]);
  });
  it("hides the status control from an assignee of an overdue task", () => {
    const task = row("worker", { due_date: "2026-10-26" });
    expect(taskActionItems(task, today)).toEqual(["complete"]);
    expect(taskStatusOptions(task, today)).toEqual([
      { value: "pending", label: "Pending", disabled: true, active: false },
      { value: "in_progress", label: "In progress", disabled: true, active: false },
    ]);
  });
  it("keeps the due-date note for an assigner of an overdue task", () => {
    const task = row("owner", { due_date: "2026-10-26" });
    expect(taskActionItems(task, today)).toEqual(["edit", "assign", "archive", "delete"]);
    expect(taskStatusOptions(task, today)).toEqual([
      { value: "pending", label: "Pending", disabled: true, active: false, note: "Update the due date first" },
      { value: "in_progress", label: "In progress", disabled: true, active: false, note: "Update the due date first" },
    ]);
  });
  it("offers all admin actions and replaces completion with reopen", () => {
    expect(taskActionItems(row("admin", {}, "admin"), today)).toEqual(["pending", "in_progress", "complete", "edit", "assign", "archive", "delete"]);
    expect(taskActionItems(row("admin", { completed: true }, "admin"), today)).toEqual(["reopen", "edit", "assign", "archive", "delete"]);
  });
  it("never offers a status change on a completed task", () => {
    const task = row("worker", { completed: true });
    expect(taskActionItems(task, today)).toEqual(["reopen"]);
    expect(taskStatusOptions(task, today)).toEqual([
      { value: "pending", label: "Pending", disabled: true, active: false },
      { value: "in_progress", label: "In progress", disabled: true, active: false },
    ]);
    expect(hasTaskMenu(task, today)).toBe(true);
  });
  it("marks the status the row displays and makes choosing it a no-op", () => {
    const pending = taskStatusOptions(row("worker"), today);
    expect(pending).toEqual([
      { value: "pending", label: "Pending", disabled: true, active: true },
      { value: "in_progress", label: "In progress", disabled: false, active: false },
    ]);
    const inProgress = taskStatusOptions(row("worker", { workflow_status: "in_progress" }), today);
    expect(inProgress).toEqual([
      { value: "pending", label: "Pending", disabled: false, active: false },
      { value: "in_progress", label: "In progress", disabled: true, active: true },
    ]);
    // An overdue row has no active option to mark: the Overdue pill leads.
    expect(taskStatusOptions(row("worker", { due_date: "2026-10-26" }), today).some((option) => option.active)).toBe(false);
  });
  it("reads the stored workflow status and skips a status write that changes nothing", () => {
    expect(currentTaskStatus({ workflow_status: "in_progress" })).toBe("in_progress");
    expect(currentTaskStatus({ workflow_status: "pending" })).toBe("pending");
    expect(currentTaskStatus({})).toBe("pending");
    expect(currentTaskStatus({ workflow_status: "done" })).toBe("pending");
    expect(taskStatusWriteRequired(row("worker"), "pending")).toBe(false);
    expect(taskStatusWriteRequired({ ...base }, "pending")).toBe(false);
    expect(taskStatusWriteRequired(row("worker", { workflow_status: "in_progress" }), "pending")).toBe(true);
    expect(taskStatusWriteRequired(row("worker"), "in_progress")).toBe(true);
    expect(taskStatusWriteRequired(row("worker", { workflow_status: "in_progress" }), "in_progress")).toBe(false);
  });
  it("returns from the setter before writing a status the task already holds", () => {
    const start = appSource.indexOf("function setTaskStatus(");
    const setter = appSource.slice(start, appSource.indexOf("function submitTaskEdit(", start));
    expect(start).toBeGreaterThan(-1);
    expect(setter).toContain("if (!taskStatusWriteRequired(task, workflow_status)) return;");
    expect(setter.indexOf("taskStatusWriteRequired")).toBeLessThan(setter.indexOf("apiRequest("));
    expect(setter.indexOf("taskStatusWriteRequired")).toBeLessThan(setter.indexOf("syncBypassRef"));
  });
  it("disables the active status option in the row menu", () => {
    const menu = (task: ReturnType<typeof row>) => renderToStaticMarkup(createElement(TaskActionMenuItems, {
      task,
      currentDate: today,
      busy: false,
      onStatus: () => undefined,
      onComplete: () => undefined,
      onEdit: () => undefined,
      onArchive: () => undefined,
      onDelete: () => undefined,
      onClose: () => undefined,
    }));
    const pending = menu(row("worker"));
    expect(menuItemTag(pending, "Pending")).toContain("disabled");
    expect(menuItemTag(pending, "In progress")).not.toContain("disabled");
    const inProgress = menu(row("worker", { workflow_status: "in_progress" }));
    expect(menuItemTag(inProgress, "In progress")).toContain("disabled");
    expect(menuItemTag(inProgress, "Pending")).not.toContain("disabled");
  });
  it("derives the trigger from the shared menu contents", () => {
    expect(hasTaskMenu(row("worker"), today)).toBe(true);
    expect(hasTaskMenu(row("viewer"), today)).toBe(false);
  });
  it("keeps cached payloads menu-free instead of guessing permissions", () => {
    expect(taskActionItems(base, today)).toEqual([]);
    expect(taskStatusOptions(base, today)).toEqual([]);
    expect(hasTaskMenu(base, today)).toBe(false);
    expect(taskActionItems({ ...base, assignee_person_ids: [] }, today)).toEqual([]);
  });
  it("gates the row checkbox on the row's own capabilities", () => {
    const assignee = row("worker");
    expect(taskCheckboxEnabled(assignee)).toBe(true);
    expect(taskCheckboxEnabled({ ...row("worker", { completed: true }) })).toBe(true);
    expect(taskCheckboxEnabled(row("viewer"))).toBe(false);
    // Cached payloads predate capabilities and keep the legacy checkbox.
    expect(taskCheckboxEnabled(base)).toBe(true);
    expect(taskCheckboxEnabled({ ...base, completed: true })).toBe(true);
  });
  it("flips completion capabilities without granting a manager completion", () => {
    const assignee = row("worker");
    const completed = completionTaskCapabilities(assignee.capabilities, true);
    expect(completed.canComplete).toBe(false);
    expect(completed.canReopen).toBe(true);
    expect(completed.canChangeStatus).toBe(true);
    expect(completed.overdue).toBe(false);
    expect(completed.statusLocked).toBe(false);
    const reopened = completionTaskCapabilities(completed, false);
    expect(reopened.canComplete).toBe(true);
    expect(reopened.canReopen).toBe(false);
    // An overdue assignee can complete but may not change status; after the
    // completion the reopened state still carries the overdue lock.
    const overdue = row("worker", { due_date: "2026-10-26" });
    expect(completionTaskCapabilities(overdue.capabilities, false).statusLocked).toBe(true);
    // The assigner may manage but never completes; nothing flips.
    const manager = row("owner");
    expect(completionTaskCapabilities(manager.capabilities, true)).toEqual(manager.capabilities);
  });
  it("keeps the completion capability payload current in every cache patch", () => {
    const start = appSource.indexOf("const taskAfterPatch =");
    expect(start).toBeGreaterThan(-1);
    const block = appSource.slice(start, appSource.indexOf("const patchTaskRow", start));
    expect(block).toContain("completionTaskCapabilities(next.capabilities, next.completed === true)");
    const scenario = appSource.slice(appSource.indexOf("function applyScenarioTaskCompletion("), appSource.indexOf("async function refreshTaskDetailsFor("));
    expect((scenario.match(/completionTaskCapabilities\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("seeds the due-date editor only from a calendar-date prefix", () => {
    expect(taskDueDateSeed("2026-10-30")).toBe("2026-10-30");
    expect(taskDueDateSeed("2026-10-30T09:00:00Z")).toBe("2026-10-30");
    expect(taskDueDateSeed("2026-1-30")).toBe("");
    expect(taskDueDateSeed("soon")).toBe("");
    expect(taskDueDateSeed("")).toBe("");
    expect(taskDueDateSeed(null)).toBe("");
    expect(taskDueDateSeed(undefined)).toBe("");
    expect(taskDueDateSeed(20261030)).toBe("");
  });
});
