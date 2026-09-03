import { describe, expect, it } from "vitest";
import { filterWorkspaceTasks, organizeTaskSections, orderTasksByRecency, parentTasks, safeTaskText, suggestDailyGoal, subtaskProgress, taskDateAttribution, taskKind, tasksForDate, unfinishedBefore, uniqueTasks } from "./taskWorkspace";

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

  it("orders historical task rows by their most recently added time", () => {
    expect(orderTasksByRecency([
      { id: "older", provider_created_at: "2026-09-02T09:00:00Z" },
      { id: "newer", provider_created_at: "2026-09-02T11:00:00Z" },
    ]).map((task) => task.id)).toEqual(["newer", "older"]);
  });

  it("replaces provider failure payloads with deliberate fallback copy", () => {
    expect(safeTaskText("TypeError: Failed to fetch", "No description added.")).toBe("No description added.");
    expect(safeTaskText("  A useful task description  ", "No description added.")).toBe("A useful task description");
    expect(safeTaskText({ message: "failure" }, "Untitled Nifty task")).toBe("Untitled Nifty task");
  });

  it("filters tasks by case-insensitive task text", () => {
    const tasks = [
      { id: "title", title: "Repair provider sync", description: "Restore the Nifty bridge" },
      { id: "description", title: "Desktop polish", description: "Verify PROVIDER fallback behavior" },
      { id: "other", title: "Write release notes", description: "Summarize the installer" },
    ];

    expect(filterWorkspaceTasks(tasks, "2026-08-26", { query: " provider " }).map((task) => task.id)).toEqual(["title", "description"]);
  });

  it("filters tasks by inclusive attributed date range", () => {
    const tasks = [
      { id: "before", title: "Before", due_date: "2026-08-19" },
      { id: "from", title: "From", due_date: "2026-08-20" },
      { id: "inside", title: "Inside", provider_created_at: "2026-08-21T09:00:00Z" },
      { id: "to", title: "To", dayAttribution: { date: "2026-08-22", reason: "surfaced" } },
      { id: "after", title: "After", due_date: "2026-08-23" },
      { id: "unknown", title: "Unknown" },
    ];

    expect(filterWorkspaceTasks(tasks, "2026-08-26", { from: "2026-08-20", to: "2026-08-22" }).map((task) => task.id)).toEqual(["from", "inside", "to"]);
    expect(filterWorkspaceTasks(tasks, "2026-08-26", { from: "2026-08-21", to: "2026-08-21" }).map((task) => task.id)).toEqual(["inside"]);
  });
});
