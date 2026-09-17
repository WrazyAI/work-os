import { describe, expect, it } from "vitest";
import { DEFAULT_TASK_SORT, dayScopedTasks, filterWorkspaceTasks, isOverdueTask, organizeTaskSections, orderTasksByRecency, parentTasks, safeTaskText, sortTaskList, suggestDailyGoal, subtaskProgress, taskDateAttribution, taskKind, taskSortNote, taskState, tasksForDate, unfinishedBefore, uniqueTasks } from "./taskWorkspace";
import { nextSortState } from "./SortHeaderRow";

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

describe("canonical task ordering, overdue meaning, and shared day scope", () => {
  const today = "2026-09-17";

  it("treats only dated, unfinished work before today as overdue", () => {
    expect(isOverdueTask({ id: "past", due_date: "2026-09-16", completed: false }, today)).toBe(true);
    expect(isOverdueTask({ id: "today", due_date: "2026-09-17", completed: false }, today)).toBe(false);
    expect(isOverdueTask({ id: "undated", completed: false }, today)).toBe(false);
    expect(isOverdueTask({ id: "done", due_date: "2026-09-16", completed: true }, today)).toBe(false);
    expect(isOverdueTask({ id: "malformed", due_date: "16/09/2026", completed: false }, today)).toBe(false);
    expect(taskState({ id: "past", due_date: "2026-09-16", completed: false }, today)).toBe("overdue");
    expect(taskState({ id: "done", completed: true }, today)).toBe("complete");
  });

  it("defaults to status then due date with completed work last", () => {
    const ordered = sortTaskList([
      { id: "done", title: "Done", completed: true, completed_at: "2026-09-16T10:00:00Z" },
      { id: "open-undated", title: "Open undated", completed: false },
      { id: "open-later", title: "Open later", due_date: "2026-09-20", completed: false },
      { id: "overdue-newer", title: "Overdue newer", due_date: "2026-09-15", completed: false },
      { id: "open-today", title: "Open today", due_date: "2026-09-17", completed: false },
      { id: "overdue-older", title: "Overdue older", due_date: "2026-09-10", completed: false },
    ], DEFAULT_TASK_SORT, today).map((task) => task.id);
    expect(ordered).toEqual(["overdue-older", "overdue-newer", "open-today", "open-later", "open-undated", "done"]);
  });

  it("keeps undated work last in both due-date directions", () => {
    const tasks = [
      { id: "dated-early", title: "Early", due_date: "2026-09-10", completed: false },
      { id: "dated-late", title: "Late", due_date: "2026-09-20", completed: false },
      { id: "undated", title: "Undated", completed: false },
    ];
    expect(sortTaskList(tasks, { key: "due", direction: "asc" }, today).map((task) => task.id)).toEqual(["dated-early", "dated-late", "undated"]);
    expect(sortTaskList(tasks, { key: "due", direction: "desc" }, today).map((task) => task.id)).toEqual(["dated-late", "dated-early", "undated"]);
  });

  it("sorts by priority and activity and names every order", () => {
    const tasks = [
      { id: "low", title: "Low", priority: "low", completed: false, provider_updated_at: "2026-09-16T09:00:00Z" },
      { id: "high", title: "High", priority: "high", completed: false, provider_updated_at: "2026-09-15T09:00:00Z" },
    ];
    expect(sortTaskList(tasks, { key: "priority", direction: "asc" }, today).map((task) => task.id)).toEqual(["high", "low"]);
    expect(sortTaskList(tasks, { key: "activity", direction: "desc" }, today).map((task) => task.id)).toEqual(["low", "high"]);
    expect(taskSortNote({ key: "status", direction: "asc" })).toBe("Overdue first, then due date");
    expect(taskSortNote({ key: "due", direction: "desc" })).toBe("Due date · latest first");
    expect(taskSortNote({ key: "activity", direction: "desc" })).toBe("Latest activity first");
  });

  it("cycles sort columns through ascending, descending, and the default", () => {
    const due = { key: "due" as const, label: "Due", initialDirection: "asc" as const };
    const first = nextSortState(DEFAULT_TASK_SORT, due, DEFAULT_TASK_SORT);
    expect(first).toEqual({ key: "due", direction: "asc" });
    const second = nextSortState(first, due, DEFAULT_TASK_SORT);
    expect(second).toEqual({ key: "due", direction: "desc" });
    expect(nextSortState(second, due, DEFAULT_TASK_SORT)).toEqual(DEFAULT_TASK_SORT);
  });

  it("orders groups by the status direction and rows inside groups by the active column", () => {
    const tasks = [
      { id: "done", title: "Done", completed: true, completed_at: "2026-09-16T10:00:00Z" },
      { id: "late-a", title: "Late A", due_date: "2026-09-10", completed: false },
      { id: "late-b", title: "Late B", due_date: "2026-09-15", completed: false },
      { id: "open", title: "Open", due_date: "2026-09-20", completed: false },
    ];
    const descending = organizeTaskSections(tasks, today, { key: "status", direction: "desc" });
    expect(descending.map((section) => [section.id, section.tasks.map((task) => task.id)])).toEqual([
      ["completed", ["done"]],
      ["open", ["open"]],
      ["overdue", ["late-a", "late-b"]],
    ]);
    const byDue = organizeTaskSections(tasks, today, { key: "due", direction: "desc" });
    expect(byDue.map((section) => section.id)).toEqual(["overdue", "open", "completed"]);
    expect(byDue[0].tasks.map((task) => task.id)).toEqual(["late-b", "late-a"]);
    expect(byDue[0].note).toBe("Due date · latest first");
  });

  it("shares one day scope between the dashboard hero and the tasks workspace", () => {
    const scope = dayScopedTasks(
      [{ id: "bucket", title: "Bucket", dayAttribution: { date: "2026-09-17", reason: "subtask_activity" } }],
      [{ id: "item-1", task_id: "surfaced", title_snapshot: "Surfaced snapshot", disposition: "selected", source: "carry_over", rank: 0, blocker: null, item_kind: "nifty_task", completion_state: "open" }],
      today,
      [{ id: "surfaced", title: "Surfaced real", due_date: "2026-09-01" }],
    );
    expect(scope.map((task) => task.id)).toEqual(["bucket", "surfaced"]);
    expect(scope.map((task) => task.title)).toEqual(["Bucket", "Surfaced real"]);
  });
});
