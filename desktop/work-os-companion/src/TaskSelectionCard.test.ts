import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TaskSelectionCard, taskSelectionSummaryText } from "./TaskSelectionCard";

const tasks = [
  { id: "pending", title: "Finish release notes", description: "Capture the verified changes.", dueDate: "2026-09-03", projectName: "Work OS", state: "pending" as const },
  { id: "overdue", title: "Repair provider sync", dueDate: "2026-09-02", state: "overdue" as const },
];

describe("TaskSelectionCard", () => {
  it("renders accessible pending and overdue task selection without a mutation control", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, onMarkSelectedDone: () => undefined }));

    expect(markup).toContain('aria-label="Select Finish release notes"');
    expect(markup).toContain('aria-label="Select Repair provider sync"');
    expect(markup).toContain('data-workos-tool-surface="task-selection"');
    expect(markup).toContain("Mark selected done");
    expect(markup).toContain("Overdue");
    expect(markup).toContain("disabled");
  });

  it("renders loading, empty, error, and degraded states with stable local copy", () => {
    const loading = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, status: "loading", onMarkSelectedDone: () => undefined }));
    const empty = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks: [], onMarkSelectedDone: () => undefined }));
    const error = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks: [], status: "error", onRetry: () => undefined, onMarkSelectedDone: () => undefined }));
    const degraded = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, degraded: true, dense: true, onMarkSelectedDone: () => undefined }));

    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Loading tasks");
    expect(empty).toContain("No pending tasks");
    expect(error).toContain("Tasks are unavailable");
    expect(error).toContain("Try again");
    expect(degraded).toContain("Showing the last available task details.");
    expect(degraded).toContain("is-dense");
  });

  it("asks for confirmation before filing completions", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("Select one or more tasks to continue.");
    expect(markup).not.toContain("Confirm Done");
  });

  it("keeps long compact titles readable with an ellipsis tooltip", () => {
    const title = "Today's tasks · 5 pending · 1 overdue";
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, dense: true, title, onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("is-dense");
    expect(markup).not.toContain("is-confirming");
    expect(markup).toContain("5 pending · 1 overdue");
    expect(markup).toContain("<h2");
    expect(markup).toContain("title=");
  });

  it("reveals clipped task and subtask titles with the shared pan line", () => {
    const withSubtasks = [{ ...tasks[0], subtasks: [{ id: "sub-1", title: "Write the verification notes" }], subtaskTotal: 1, subtaskCompleted: 0 }];
    const card = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks: withSubtasks, onMarkSelectedDone: () => undefined }));
    // Main title, subtask title, and the row that owns the hover target.
    expect(card).toContain('class="overflow-pan"');
    expect(card).toContain('<span class="overflow-pan-line">Finish release notes</span>');
    expect(card).toContain('<span class="overflow-pan-line">Write the verification notes</span>');
    expect(card).toContain('data-pan-row="true"');
    const table = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, presentation: "table", onMarkSelectedDone: () => undefined }));
    expect(table).toContain('<span class="overflow-pan-line">Repair provider sync</span>');
    expect(table).toContain('data-pan-row="true"');
  });

  it("fades a clipped description without moving it", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, onMarkSelectedDone: () => undefined }));
    // The description is the static variant: measured fade, no slide.
    expect(markup).toContain('class="overflow-pan is-static"');
    expect(markup).toContain('<span class="overflow-pan-line">Capture the verified changes.</span>');
    // The title stays pannable.
    expect(markup).toContain('<span class="overflow-pan-line">Finish release notes</span>');
  });

  it("uses a filterable task table for the in-app presentation", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, presentation: "table", onMarkSelectedDone: () => undefined }));
    expect(markup).toContain('role="table"');
    expect(markup).toContain('aria-label="Filter tasks"');
    expect(markup).toContain("Project");
    expect(markup).toContain("Work OS");
    expect(markup).toContain("is-table");
  });

  it("keeps the disclosure on the far right of a compact header", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, onMarkSelectedDone: () => undefined }));
    // Header carries the title plus the right-side disclosure; the old kicker
    // and the duplicated count sentence are gone.
    expect(markup).toContain("chat-task-heading");
    expect(markup).toContain("chat-task-disclosure");
    expect(markup).not.toContain("chat-task-toggle");
    expect(markup).not.toContain("Task selection");
    expect(markup).not.toContain("TASK SELECTION");
    expect(markup).not.toContain("0 overdue");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain('title="Collapse tasks"');
    expect(markup).toContain("chat-task-chevron is-open");
    expect(markup).not.toContain("is-collapsed");
  });

  it("collapses to a one-line summary when it loses thread focus", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, collapseWhenInactive: true, onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("is-collapsed");
    expect(markup).toContain("1 pending · 1 overdue");
    expect(markup).toContain('title="Expand tasks"');
    expect(markup).toContain('aria-expanded="false"');
    // The list and the confirmation action are hidden with the body.
    expect(markup).toMatch(/id="[^"]*-content"[^>]*hidden/);
  });

  it("expands a parent into its subtasks with an accordion panel", () => {
    const parent = {
      id: "parent",
      title: "Ship the companion shell",
      state: "pending" as const,
      subtaskTotal: 2,
      subtaskCompleted: 1,
      subtasks: [
        { id: "child-open", title: "Trim the header", completed: false },
        { id: "child-done", title: "Move the tabs", completed: true },
      ],
    };
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks: [parent], onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("1/2 subtasks");
    expect(markup).toContain("chat-task-row-head");
    expect(markup).toContain('aria-controls="');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain("Trim the header");
    expect(markup).toContain("Move the tabs");
    expect(markup).toContain("Select subtask Trim the header");
    expect(markup).toContain("is already complete");
    // No parent suggestion until every open subtask is checked.
    expect(markup).not.toContain("Also mark");
  });

  it("marks tasks that already have pending proposals and disables their checkbox", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, proposedTaskIds: ["pending"], onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("Proposed");
    expect(markup).toContain("already has a pending proposal");
    expect(markup).toContain("disabled");
  });

  it("remembers the whole-card collapse for a keyed host", () => {
    const values = new Map([["work-os.avatar.tasks-collapsed.v1", "true"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
    });
    try {
      const markup = renderToStaticMarkup(createElement(TaskSelectionCard, {
        tasks,
        onMarkSelectedDone: () => undefined,
        collapsePersistenceKey: "work-os.avatar.tasks-collapsed.v1",
      }));
      expect(markup).toContain("is-collapsed");
      expect(markup).toContain('aria-expanded="false"');
      // The collapsed header keeps a one-line account of the open work, and the
      // card body is hidden rather than re-rendered away.
      expect(markup).toContain("1 pending · 1 overdue");
      expect(markup).toContain('class="chat-task-body" hidden=""');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("taskSelectionSummaryText", () => {
  it("summarizes selected and proposed counts, and stays empty when there is nothing to add", () => {
    expect(taskSelectionSummaryText({ selected: 0, proposed: 0, sentCount: 0, approvalLocation: "in Chat" })).toBe("");
    expect(taskSelectionSummaryText({ selected: 2, proposed: 1, sentCount: 0, approvalLocation: "in Chat" })).toBe("2 selected · 1 proposed");
  });

  it("writes a singular and plural receipt for the approval location", () => {
    expect(taskSelectionSummaryText({ selected: 1, proposed: 0, sentCount: 1, approvalLocation: "in Chat" })).toBe("1 completion proposal created — review and approve in Chat.");
    expect(taskSelectionSummaryText({ selected: 2, proposed: 0, sentCount: 2, approvalLocation: "below" })).toBe("2 completion proposals created — review and approve below.");
  });
});
