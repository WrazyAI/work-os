import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("uses a filterable task table for the in-app presentation", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, presentation: "table", onMarkSelectedDone: () => undefined }));
    expect(markup).toContain('role="table"');
    expect(markup).toContain('aria-label="Filter tasks"');
    expect(markup).toContain("Project");
    expect(markup).toContain("Work OS");
    expect(markup).toContain("is-table");
  });

  it("exposes a collapse toggle and starts expanded", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("chat-task-toggle");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("aria-controls=");
    expect(markup).toContain("show or hide task list");
    expect(markup).not.toContain("is-collapsed");
  });

  it("marks tasks that already have pending proposals and disables their checkbox", () => {
    const markup = renderToStaticMarkup(createElement(TaskSelectionCard, { tasks, proposedTaskIds: ["pending"], onMarkSelectedDone: () => undefined }));
    expect(markup).toContain("Proposed");
    expect(markup).toContain("already has a pending proposal");
    expect(markup).toContain("disabled");
  });
});

describe("taskSelectionSummaryText", () => {
  it("summarizes pending, selected, and proposed counts", () => {
    expect(taskSelectionSummaryText({ pending: 3, selected: 0, proposed: 0, sentCount: 0, approvalLocation: "in Chat" })).toBe("3 pending");
    expect(taskSelectionSummaryText({ pending: 3, selected: 2, proposed: 1, sentCount: 0, approvalLocation: "in Chat" })).toBe("3 pending · 2 selected · 1 proposed");
  });

  it("writes a singular and plural receipt for the approval location", () => {
    expect(taskSelectionSummaryText({ pending: 1, selected: 1, proposed: 0, sentCount: 1, approvalLocation: "in Chat" })).toBe("1 completion proposal created — review and approve in Chat.");
    expect(taskSelectionSummaryText({ pending: 2, selected: 2, proposed: 0, sentCount: 2, approvalLocation: "below" })).toBe("2 completion proposals created — review and approve below.");
  });
});
