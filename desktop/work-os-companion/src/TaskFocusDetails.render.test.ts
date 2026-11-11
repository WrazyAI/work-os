import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FocusPlanList, TaskFocusDetails } from "./TaskFocusDetails";
import { buildFocusPlan } from "./focusPlan";
import type { DailyPlan } from "./types";

const plan: DailyPlan = {
  id: "plan",
  status: "confirmed",
  freeform_intent: "Ship the workspace",
  shift_date: "2026-11-11",
  revision: 2,
  items: [
    {
      id: "item-one", task_id: "parent-1", source: "due_today", disposition: "selected", rank: 0,
      title_snapshot: "Ship the workspace", blocker: null, item_kind: "nifty_task", completion_state: "open",
    },
    {
      id: "item-two", task_id: "parent-2", source: "carry_over", disposition: "selected", rank: 1,
      title_snapshot: "Review provider sync", blocker: null, item_kind: "nifty_task", completion_state: "completed",
    },
  ],
};
const tasks = [
  {
    id: "parent-1", title: "Ship the workspace", subtask_total: 2, subtask_completed: 1,
    subtasks: [
      { id: "child-open", parent_task_id: "parent-1", title: "Trim the header", completed: false },
      { id: "child-done", parent_task_id: "parent-1", title: "Move the tabs", completed: true },
    ],
  },
  { id: "parent-2", title: "Review provider sync", subtask_total: 0, subtask_completed: 0 },
];

describe("focus plan disclosure", () => {
  it("renders parent items collapsed by default with their subtasks announced", () => {
    const focus = buildFocusPlan(plan, tasks);
    const markup = renderToStaticMarkup(React.createElement(FocusPlanList, { groups: focus.groups, expandedIds: new Set<string>(), onToggle: () => undefined }));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="');
    expect(markup).toContain("1 of 2 subtasks done");
    expect(markup).toContain("Recorded open");
    expect(markup).toContain("Recorded done");
    expect(markup).toContain("Trim the header");
    expect(markup).toContain("Move the tabs");
    expect(markup).toMatch(/class="task-focus-subtasks"[^>]*aria-hidden="true"/);
    expect(markup).not.toContain('data-open="true"');
    // A parent without subtasks is a plain row, not a dead disclosure.
    expect(markup).toContain("task-focus-plan-row is-static");
  });

  it("exposes the subtask region when a parent is expanded", () => {
    const focus = buildFocusPlan(plan, tasks);
    const markup = renderToStaticMarkup(React.createElement(FocusPlanList, { groups: focus.groups, expandedIds: new Set<string>([focus.groups[0].id]), onToggle: () => undefined }));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('data-open="true"');
    expect(markup).toContain("task-focus-plan-chevron is-open");
    expect(markup).not.toMatch(/class="task-focus-subtasks"[^>]*aria-hidden="true"/);
  });

  it("states when the compact payload carries only part of the subtask list", () => {
    const truncatedPlan: DailyPlan = {
      ...plan,
      items: [{ ...plan.items[0], id: "item-truncated", task_id: "parent-truncated", rank: 0 }],
    };
    const focus = buildFocusPlan(truncatedPlan, [{
      id: "parent-truncated", title: "Ship the workspace", subtask_total: 12, subtask_completed: 5,
      subtasks: Array.from({ length: 8 }, (_, index) => ({ id: `child-${index}`, title: `Child ${index + 1}`, completed: index < 3 })),
    }]);
    const markup = renderToStaticMarkup(React.createElement(FocusPlanList, {
      groups: focus.groups, expandedIds: new Set<string>([focus.groups[0].id]), onToggle: () => undefined,
    }));
    expect(markup).toContain("Showing 8 of 12 subtasks.");
    expect(markup).toContain("5 of 12 subtasks done");
  });

  it("keeps the strip trigger visible and does not mount the dialog until it opens", () => {
    const markup = renderToStaticMarkup(React.createElement(TaskFocusDetails, {
      text: "Ship the workspace", provenance: "Written by you", date: "Nov 11", historical: false, plan, tasks, onEdit: () => undefined,
    }, React.createElement("span", null, "Focus content")));
    expect(markup).toContain('aria-label="Open focus details"');
    expect(markup).toContain("Focus content");
    expect(markup).not.toContain("<dialog");
  });
});
