import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TasksWorkspace } from "./App";
import { DEFAULT_TASK_SORT } from "./taskWorkspace";

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
      taskSort: DEFAULT_TASK_SORT,
      todayTasks: [],
      taskHistory: [{ id: "task-1", title: "Repair provider sync", due_date: "2026-08-26", completed: false }],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      initialFiltersOpen: true,
      onTaskView: () => undefined,
    onTaskSort: () => undefined,
      onTaskSort: () => undefined,
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
      taskSort: DEFAULT_TASK_SORT,
      todayTasks: [],
      taskHistory: [],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      onTaskView: () => undefined,
    onTaskSort: () => undefined,
      onTaskSort: () => undefined,
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
      taskSort: DEFAULT_TASK_SORT,
      todayTasks: [{ id: "pending-1", title: "Adding now", completed: false, due_date: "2026-08-26", pending_status: "syncing" }],
      taskHistory: [],
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: false,
      busy: false,
      onTaskView: () => undefined,
    onTaskSort: () => undefined,
      onTaskSort: () => undefined,
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
    taskSort: DEFAULT_TASK_SORT,
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
    onTaskSort: () => undefined,
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

  it("keeps one flat list with the canonical due-latest-first order", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, props));

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain("Name");
    expect(markup).toContain("Date due");
    expect(markup).toContain("Status");
    expect(markup).not.toContain("Task queue");
    expect(markup).not.toContain("Scheduled today");
    expect(markup).toContain("Date due, sorted descending.");
    expect(markup).toContain("Add task");

    const latestDueIndex = markup.indexOf("Soon work");
    const olderDueIndex = markup.indexOf("Late work");
    const doneIndex = markup.indexOf("Finished work");
    expect(latestDueIndex).toBeGreaterThan(-1);
    expect(latestDueIndex).toBeLessThan(olderDueIndex);
    expect(olderDueIndex).toBeLessThan(doneIndex);
  });

  it("states every view chip count from the rows that view renders", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, props));
    expect(markup).toContain("Unfinished<em>2</em>");
    expect(markup).toContain("Completed<em>1</em>");
    expect(markup).toContain("All tasks<em>3</em>");
    expect(markup).not.toContain("All tasks<em>3</em><em>");
  });

  it("applies the requested Name sort and keeps an explicit Open status cell", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskSort: { key: "title", direction: "asc" },
    }));
    expect(markup.indexOf("Finished work")).toBeLessThan(markup.indexOf("Late work"));
    expect(markup.indexOf("Late work")).toBeLessThan(markup.indexOf("Soon work"));
    expect(markup).toContain('class="task-state open">Open</span>');
  });
});

describe("Tasks workspace backlog reconciliation", () => {
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
    taskSort: DEFAULT_TASK_SORT,
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
    onTaskSort: () => undefined,
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

  it("renders Unfinished from the full backlog instead of the loaded history window", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskView: "unfinished",
      taskHistory: [props.taskHistory[0]],
      backlog: {
        tasks: [
          { id: "late", title: "Late work", due_date: "2026-08-20", completed: false },
          { id: "beyond-window", title: "Beyond the loaded window", due_date: "2026-07-01", completed: false },
        ],
        counts: { total: 12, open: 2, completed: 10 },
      },
    }));
    expect(markup).toContain("Beyond the loaded window");
    expect(markup).toContain("Unfinished<em>2</em>");
    expect(markup).toContain('role="toolbar"');
  });

it("discloses a backlog failure instead of silently using the loaded window", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskView: "unfinished",
      backlogError: true,
      taskHistory: [props.taskHistory[0]],
    }));
    expect(markup).toContain("The full backlog could not be loaded");
  });

  it("counts All tasks from the server total and says how much is on screen", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      backlog: { tasks: [], counts: { total: 12, open: 2, completed: 10 } },
    }));
    expect(markup).toContain("All tasks<em>12</em>");
    expect(markup).toContain("Completed<em>10</em>");
    expect(markup).toContain("Showing 3 of 12");
  });
});
