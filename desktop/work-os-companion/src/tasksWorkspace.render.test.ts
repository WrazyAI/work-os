import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { taskCapabilities } from "../../../src/lib/work-os-task-permissions";
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

  it("puts the views, search, and date range in the panel header and Add task in the list header", () => {
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
    const header = markup.match(/<header class="task-list-header">[\s\S]*?<\/header>/)?.[0] ?? "";

    expect(header).toContain('aria-label="Task views"');
    expect(header).toContain('aria-label="Task search and date filters"');
    expect(header).toContain('aria-label="Search tasks"');
    expect(header).toContain("Date range");
    // The action belongs to the list itself, not to the panel title row.
    expect(header).not.toContain("Add task");
    const selectedTab = header.match(/<button[^>]*aria-selected="true"[^>]*>/)?.[0] ?? "";
    expect(selectedTab).toContain('tabindex="0"');
    expect(header.match(/tabindex="-1"/g)?.length).toBe(3);
    expect(header).toContain('aria-selected="true"');
    expect(header).toContain('aria-controls="task-list-panel"');
    expect(markup).toContain('id="task-list-panel"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-labelledby="task-list-tab-all"');
    expect(markup).not.toContain("tasks-toolbar");
    expect(markup).not.toContain("task-search-toolbar");
    // The list's own header row carries the action, below the panel header.
    const headerEnd = markup.indexOf(header) + header.length;
    expect(markup.indexOf("sort-header-row")).toBeGreaterThan(headerEnd);
    expect(markup.indexOf("task-add-button")).toBeGreaterThan(markup.indexOf("sort-header-row"));
    expect(markup).toMatch(/sort-header-row[\s\S]*?task-add-button/);
  });

  it("keeps Add task available when the list has no rows", () => {
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
      taskHistory: [],
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
    }));

    expect(markup).toContain("task-add-button");
    expect(markup).toContain("Add task");
  });

  it("keeps search and date filters on a historical day without tabs or Add task", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      currentDate: "2026-08-26",
      historyDate: "2026-08-25",
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
      taskHistory: [],
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
    }));

    expect(markup).toContain('aria-label="Task search and date filters"');
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain('role="tabpanel"');
    expect(markup).not.toContain("Add task");
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

  it("preserves the server-provided canonical due-latest-first order", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      historyOrder: "server",
      taskHistory: [props.taskHistory[1], props.taskHistory[0], props.taskHistory[2]],
    }));

    expect(markup).toContain('role="toolbar"');
    expect(markup).toContain("Name");
    expect(markup).toContain("Date Due");
    expect(markup).toContain("Status");
    expect(markup).not.toContain("Task queue");
    expect(markup).not.toContain("Scheduled today");
    expect(markup).toContain("Date Due, sorted descending.");
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

  it("keeps shared history intact while Completed renders its dedicated page", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskView: "completed",
      completedHistory: [props.taskHistory[2]],
    }));
    expect(markup).toContain("Finished work");
    expect(markup).not.toContain(">Late work</h3>");
    expect(markup).not.toContain(">Soon work</h3>");
    expect(markup).toContain("Unfinished<em>2</em>");
    expect(markup).toContain("All tasks<em>3</em>");
  });

  it("sorts local preview history by Name before rendering", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskSort: { key: "title", direction: "asc" },
      taskHistory: [props.taskHistory[2], props.taskHistory[1], props.taskHistory[0]],
    }));

    expect(markup.indexOf("Finished work")).toBeLessThan(markup.indexOf("Late work"));
    expect(markup.indexOf("Late work")).toBeLessThan(markup.indexOf("Soon work"));
  });

  it("preserves the server-provided Name sort and keeps an explicit Pending status cell", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      historyOrder: "server",
      taskSort: { key: "title", direction: "asc" },
      taskHistory: [props.taskHistory[1], props.taskHistory[0], props.taskHistory[2]],
    }));
    expect(markup.indexOf("Soon work")).toBeLessThan(markup.indexOf("Late work"));
    expect(markup.indexOf("Late work")).toBeLessThan(markup.indexOf("Finished work"));
    expect(markup).toContain('class="task-state pending">Pending</span>');
  });

  it("renders the four-state pill vocabulary with derived overdue", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      historyOrder: "server",
      taskHistory: [
        { id: "pending", title: "Pending work", due_date: "2026-08-28", completed: false },
        { id: "progress", title: "In-progress work", due_date: "2026-08-28", completed: false, workflow_status: "in_progress" },
        { id: "overdue", title: "Overdue work", due_date: "2026-08-20", completed: false, workflow_status: "in_progress" },
        { id: "done", title: "Done work", completed: true },
      ],
    }));
    expect(markup).toContain('class="task-state pending">Pending</span>');
    expect(markup).toContain('class="task-state in_progress">In progress</span>');
    // Overdue is derived: it wins over a stored in-progress status.
    expect(markup).toContain('class="task-state overdue">Overdue</span>');
    expect(markup).toContain('class="task-state complete">Done</span>');
    expect(markup).not.toContain(">Open</span>");
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

it("keeps paged Unfinished rows visible if the dashboard summary is unavailable", () => {
    const markup = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      taskView: "unfinished",
      backlogError: true,
      unfinishedHistory: [{ id: "paged", title: "Paged unfinished task", due_date: "2026-08-20", completed: false }],
      taskHistory: [props.taskHistory[0]],
    }));
    expect(markup).toContain("Paged unfinished task");
    expect(markup).not.toContain("The full backlog could not be loaded");
  });

  it("shows a retryable history failure without presenting an empty result", () => {
    const initialFailure = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      workspaceHistory: [],
      taskHistory: [],
      historyError: true,
      historyHasData: false,
      onRetryHistory: () => undefined,
    }));
    expect(initialFailure).toContain('role="alert"');
    expect(initialFailure).toContain("Task history could not be loaded.");
    expect(initialFailure).toContain("Try again");
    expect(initialFailure).not.toContain('class="task-empty"');

    const staleFailure = renderToStaticMarkup(createElement(TasksWorkspace, {
      ...props,
      workspaceHistory: [{ id: "saved", title: "Saved task", completed: false }],
      historyError: true,
      historyHasData: true,
      onRetryHistory: () => undefined,
    }));
    expect(staleFailure).toContain("Task history could not be refreshed. Showing saved results.");
    expect(staleFailure).toContain("Saved task");
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

describe("Tasks workspace cursor paging", () => {
  it("shows an append-only Load more action and exact loaded-versus-total count", () => {
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
      taskHistory: [{ id: "page-1", title: "First page task", completed: false }],
      workspaceHistory: [{ id: "page-1", title: "First page task", completed: false }],
      pageTotal: 51,
      pageCounts: { total: 51, open: 41, completed: 10 },
      carryOver: [],
      carryOverOpen: false,
      loadingMore: false,
      hasMore: true,
      busy: false,
      onTaskView: () => undefined,
      onTaskSort: () => undefined,
      onDate: async () => undefined,
      onEditFocus: () => undefined,
      onAddTask: () => undefined,
      onOpenTask: () => undefined,
      onEditTask: () => undefined,
      onArchiveTask: () => undefined,
      onSurfaceTask: () => undefined,
      onTaskCompletion: () => undefined,
      onCarryOverOpen: () => undefined,
      onLoadMore: () => undefined,
    }));
    expect(markup).toContain("Showing 1 of 51");
    expect(markup).toContain(">Load more</button>");
    expect(markup).not.toContain("Load older tasks");
  });

  it("disables a row checkbox the payload's capabilities forbid and says why", () => {
    const assigned = { id: "task-1", title: "Repair provider sync", due_date: "2026-08-26", completed: false, assignee_person_ids: ["worker"], assigned_by_person_id: "owner" };
    const render = (personId: string) => renderToStaticMarkup(createElement(TasksWorkspace, {
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
      taskHistory: [{ ...assigned, capabilities: taskCapabilities(assigned, { role: "employee", personId }, "2026-08-26") }],
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
      onAssignTask: () => undefined,
      onSurfaceTask: () => undefined,
      onTaskCompletion: () => undefined,
      onCarryOverOpen: () => undefined,
      onLoadMore: () => undefined,
    }));
    const blocked = render("viewer").match(/<button[^>]*aria-label="Only this task[^>]*>/)?.[0] ?? "";
    expect(blocked).toContain("task-check");
    expect(blocked).toContain("disabled");
    expect(blocked).toContain('title="Only this task');
    // The assignee keeps the plain action label on an enabled checkbox.
    const allowed = render("worker").match(/<button[^>]*aria-label="Complete Repair provider sync"[^>]*>/)?.[0] ?? "";
    expect(allowed).toContain("task-check");
    expect(allowed).not.toContain("disabled");
    expect(allowed).not.toContain("title=");
  });
});
