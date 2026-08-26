import { describe, expect, it } from "vitest";
import { organizeTaskSections, orderTasksByRecency, parentTasks, safeTaskText, suggestDailyGoal, subtaskProgress, taskDateAttribution, taskKind, tasksForDate, unfinishedBefore, uniqueTasks } from "./taskWorkspace";

describe("unified Tasks workspace", () => {
  it("suggests a deterministic goal without persisting authorship", () => {
    const result = suggestDailyGoal([
      { id: "created", title: "Document the release", provider_created_at: "2026-08-21T09:00:00Z", priority: "high", completed: false },
      { id: "due", title: "Repair the pipeline", due_date: "2026-08-21", priority: "low", completed: false },
      { id: "done", title: "Already complete", due_date: "2026-08-21", completed: true },
    ], "2026-08-21");
    expect(result).toEqual({
      text: "Focus on completing Repair the pipeline, while progressing Document the release.",
      taskIds: ["due", "created"],
    });
  });

  it("keeps subtasks nested beneath parent cards", () => {
    expect(parentTasks([
      { id: "parent", title: "Parent" },
      { id: "child-provider", title: "Child", parent_provider_task_id: "parent" },
      { id: "child-local", title: "Child local", parent_task_id: "local-parent" },
    ])).toEqual([{ id: "parent", title: "Parent" }]);
  });

  it("labels task editing from provider parentage rather than modal context", () => {
    expect(taskKind({ id: "parent", parent_provider_task_id: null, parent_task_id: null })).toBe("task");
    expect(taskKind({ id: "child", parent_provider_task_id: "parent" })).toBe("subtask");
  });

  it("attributes old work to due date before provider creation date", () => {
    const task = { id: "old", title: "Old work", due_date: "2026-08-19", provider_created_at: "2026-08-18T10:00:00Z", completed: false };
    expect(taskDateAttribution(task, "2026-08-21")).toEqual({ date: "2026-08-19", reason: "due" });
    expect(unfinishedBefore([task], "2026-08-21")).toHaveLength(1);
  });

  it("deduplicates surfaced tasks by local identifier", () => {
    expect(uniqueTasks([{ id: "one", title: "First" }, { id: "one", title: "Duplicate" }])).toEqual([{ id: "one", title: "First" }]);
  });

  it("selects tasks attributed or explicitly surfaced on a historical date", () => {
    const tasks = [
      { id: "due", due_date: "2026-08-20" },
      { id: "created", provider_created_at: "2026-08-20T09:00:00Z" },
      { id: "other", provider_created_at: "2026-08-19T09:00:00Z" },
    ];
    expect(tasksForDate(tasks, "2026-08-20", ["other"]).map((task) => task.id)).toEqual(["due", "created", "other"]);
  });

  it("normalizes parent task completion progress", () => {
    expect(subtaskProgress({ subtask_total: 4, subtask_completed: 3 })).toEqual({ total: 4, completed: 3 });
    expect(subtaskProgress({ subtask_total: 2, subtask_completed: 8 })).toEqual({ total: 2, completed: 2 });
  });

  it("groups overdue work separately and orders recent work newest first", () => {
    const sections = organizeTaskSections([
      { id: "recent", title: "Recent", provider_updated_at: "2026-08-26T12:00:00Z", completed: false },
      { id: "older", title: "Older", provider_updated_at: "2026-08-25T12:00:00Z", completed: false },
      { id: "late-two", title: "Late two", due_date: "2026-08-24", completed: false },
      { id: "late-one", title: "Late one", due_date: "2026-08-20", completed: false },
      { id: "done", title: "Done", completed_at: "2026-08-26T13:00:00Z", completed: true },
    ], "2026-08-26");
    expect(sections.map((section) => [section.id, section.tasks.map((task) => task.id)])).toEqual([
      ["overdue", ["late-one", "late-two"]],
      ["open", ["recent", "older"]],
      ["completed", ["done"]],
    ]);
    expect(orderTasksByRecency([{ id: "invalid", updated_at: "not-a-date" }, { id: "valid", updated_at: "2026-08-26" }]).map((task) => task.id)).toEqual(["valid", "invalid"]);
  });

  it("replaces provider failure payloads with deliberate fallback copy", () => {
    expect(safeTaskText("TypeError: Failed to fetch", "No description added.")).toBe("No description added.");
    expect(safeTaskText("  A useful task description  ", "No description added.")).toBe("A useful task description");
    expect(safeTaskText({ message: "failure" }, "Untitled Nifty task")).toBe("Untitled Nifty task");
  });
});
