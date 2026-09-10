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
});
