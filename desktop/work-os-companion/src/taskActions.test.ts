import { describe, expect, it } from "vitest";
import { taskCapabilities } from "../../../src/lib/work-os-task-permissions";
import { displayTaskState, taskActionItems, taskStatusLabel, taskStatusOptions } from "./taskActions";
import { taskState } from "./taskWorkspace";

const today = "2026-10-27";
const base = { completed: false, due_date: today, assignee_person_ids: ["worker"], assigned_by_person_id: "owner" };
const row = (personId: string, extra = {}, role: "employee" | "admin" = "employee") => {
  const task = { ...base, ...extra };
  return { ...task, capabilities: taskCapabilities(task, { role, personId }, today) };
};

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
      { value: "pending", label: "Pending", disabled: true },
      { value: "in_progress", label: "In progress", disabled: true },
    ]);
  });
  it("keeps the due-date note for an assigner of an overdue task", () => {
    const task = row("owner", { due_date: "2026-10-26" });
    expect(taskActionItems(task, today)).toEqual(["edit", "assign", "archive", "delete"]);
    expect(taskStatusOptions(task, today)).toEqual([
      { value: "pending", label: "Pending", disabled: true, note: "Update the due date first" },
      { value: "in_progress", label: "In progress", disabled: true, note: "Update the due date first" },
    ]);
  });
  it("offers all admin actions and replaces completion with reopen", () => {
    expect(taskActionItems(row("admin", {}, "admin"), today)).toEqual(["pending", "in_progress", "complete", "edit", "assign", "archive", "delete"]);
    expect(taskActionItems(row("admin", { completed: true }, "admin"), today)).toEqual(["pending", "in_progress", "reopen", "edit", "assign", "archive", "delete"]);
  });
  it("keeps cached payload fallback free of management permissions", () => {
    expect(taskActionItems(base, today)).toEqual(["pending", "in_progress", "complete"]);
    expect(taskActionItems({ ...base, assignee_person_ids: [] }, today)).toEqual([]);
  });
});
