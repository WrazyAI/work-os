import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasksWorkspace } from "./App";

describe("Tasks workspace filters", () => {
  it("renders accessible search and date-range controls", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      currentDate: "2026-08-26",
      historyDate: "2026-08-26",
      currentPlan: null,
      historicalPlan: null,
      historicalTasks: [],
      goal: "",
      goalProvenance: null,
      suggestion: null,
      saveState: "saved",
      taskView: "all",
      todayTasks: [],
      taskHistory: [{ id: "task-1", title: "Repair provider sync", due_date: "2026-08-26", completed: false }],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      initialFiltersOpen: true,
      onTaskView: () => undefined,
      onDate: async () => undefined,
      onEditFocus: () => undefined,
      onAddTask: () => undefined,
      onOpenTask: () => undefined,
      onEditTask: () => undefined,
      onArchiveTask: () => undefined,
      onDeleteTask: () => undefined,
      onSurfaceTask: () => undefined,
      onTaskCompletion: () => undefined,
      onCarryOverOpen: () => undefined,
      onLoadMore: () => undefined,
    }));

    expect(markup).toContain('aria-label="Task search and date filters"');
    expect(markup).toContain('aria-label="Search tasks"');
    expect(markup).toContain('aria-label="Filter from date"');
    expect(markup).toContain('aria-label="Filter to date"');
  });

  it("shows a skeleton while a view is loading and only then the empty state", () => {
    const base = {
      currentDate: "2026-08-26",
      historyDate: "2026-08-26",
      currentPlan: null,
      historicalPlan: null,
      historicalTasks: [],
      goal: "",
      goalProvenance: null,
      suggestion: null,
      saveState: "saved" as const,
      taskView: "unfinished" as const,
      todayTasks: [],
      taskHistory: [],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      onTaskView: () => undefined,
      onDate: async () => undefined,
      onEditFocus: () => undefined,
      onAddTask: () => undefined,
      onOpenTask: () => undefined,
      onEditTask: () => undefined,
      onArchiveTask: () => undefined,
      onDeleteTask: () => undefined,
      onSurfaceTask: () => undefined,
      onTaskCompletion: () => undefined,
      onCarryOverOpen: () => undefined,
      onLoadMore: () => undefined,
    };
    const loading = renderToStaticMarkup(createElement(TasksWorkspace, { ...base, loading: true }));
    expect(loading).toContain('aria-label="Loading tasks"');
    expect(loading).not.toContain("No unfinished work");

    const loadedEmpty = renderToStaticMarkup(createElement(TasksWorkspace, { ...base, loading: false }));
    expect(loadedEmpty).not.toContain('aria-label="Loading tasks"');
    expect(loadedEmpty).toContain("No unfinished work");
  });

  it("renders optimistic tasks with a sync spinner, then retry and discard on failure", () => {
    const base = {
      currentDate: "2026-08-26",
      historyDate: "2026-08-26",
      currentPlan: null,
      historicalPlan: null,
      historicalTasks: [],
      goal: "",
      goalProvenance: null,
      suggestion: null,
      saveState: "saved" as const,
      taskView: "today" as const,
      todayTasks: [{ id: "pending-1", title: "Adding now", completed: false, due_date: "2026-08-26", pending_status: "syncing" }],
      taskHistory: [],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      onTaskView: () => undefined,
      onDate: async () => undefined,
      onEditFocus: () => undefined,
      onAddTask: () => undefined,
      onOpenTask: () => undefined,
      onEditTask: () => undefined,
      onArchiveTask: () => undefined,
      onDeleteTask: () => undefined,
      onSurfaceTask: () => undefined,
      onTaskCompletion: () => undefined,
      onCarryOverOpen: () => undefined,
      onLoadMore: () => undefined,
      onRetryPendingTask: () => undefined,
      onDismissPendingTask: () => undefined,
    };
    const syncing = renderToStaticMarkup(createElement(TasksWorkspace, base));
    expect(syncing).toContain("Adding now");
    expect(syncing).toContain('title="Adding to your workspace…"');
    expect(syncing).toContain("loading-arc");
    expect(syncing).not.toContain("pending-retry");

    const failed = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...base,
      todayTasks: [{ id: "pending-2", title: "Failed add", completed: false, due_date: "2026-08-26", pending_status: "failed", pending_error: "Nifty timed out" }],
    }));
    expect(failed).toContain('aria-label="Retry adding this task"');
    expect(failed).toContain('aria-label="Discard this failed task"');
    expect(failed).toContain("Nifty timed out");
  });
});

describe("Tasks workspace ordering contract", () => {
  const props = {
    currentDate: "2026-08-26",
    historyDate: "2026-08-26",
    currentPlan: null,
    historicalPlan: null,
    historicalTasks: [],
    goal: "",
    goalProvenance: null,
    suggestion: null,
    saveState: "saved" as const,
    taskView: "all" as const,
    todayTasks: [],
    taskHistory: [
      { id: "late", title: "Late work", due_date: "2026-08-20", completed: false },
      { id: "soon", title: "Soon work", due_date: "2026-08-28", completed: false },
      { id: "finished", title: "Finished work", completed: true, completed_at: "2026-08-26T10:00:00Z" },
    ],
    carryOver: [],
    carryOverOpen: false,
    loadingMore: false,
    hasMore: false,
    busy: false,
    onTaskView: () => undefined,
    onDate: async () => undefined,
    onEditFocus: () => undefined,
    onAddTask: () => undefined,
    onOpenTask: () => undefined,
    onEditTask: () => undefined,
    onArchiveTask: () => undefined,
    onDeleteTask: () => undefined,
    onSurfaceTask: () => undefined,
    onTaskCompletion: () => undefined,
    onCarryOverOpen: () => undefined,
    onLoadMore: () => undefined,
  };

  it("renders a real sort header row and applies the default status-then-due order", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, props));

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Status, sorted ascending.");
    expect(markup).toContain("Sort by due, ascending.");
    expect(markup).toContain("Oldest due first");

    const overdueIndex = markup.indexOf("Late work");
    const openIndex = markup.indexOf("Soon work");
    const doneIndex = markup.indexOf("Finished work");
    expect(overdueIndex).toBeGreaterThan(-1);
    expect(overdueIndex).toBeLessThan(openIndex);
    expect(openIndex).toBeLessThan(doneIndex);
  });

  it("states every view chip count from the rows that view renders", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, props));
    expect(markup).toContain("Unfinished<em>2</em>");
    expect(markup).toContain("Completed<em>1</em>");
    expect(markup).toContain("All tasks<em>3</em>");
    expect(markup).not.toContain("All tasks<em>3</em><em>");
  });
});
